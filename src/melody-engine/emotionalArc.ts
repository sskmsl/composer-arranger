import type { MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { allUsablePitchClasses, isChordTone, isTensionTone } from "@/core/chord"
import { pitchClass } from "@/core/note"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"
import { computeHookStrength } from "./hookStrength"

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
const isChorus = (role: SectionRole): boolean => role === "chorus" || role === "grand-chorus"
export const emotionalTargetFraction = (role: SectionRole): number =>
  isChorus(role) ? .72 : role === "pre-chorus" ? .68 : .58

export interface EmotionalArcAssessment {
  score: number
  peakPosition: number
  climaxTiming: number
  registerDevelopment: number
  expectationSurprise: number
  delayedResolution: number
  phraseBreathing: number
  harmonyInteraction: number
  afterglow: number
  motifRetention: number
  /** フレーズごとの最高音が、頂点まで少しずつ上がっていくか(一度に跳ね上がらない) */
  gradualGrowth: number
}

function harmonicRole(note: MelodyNote, map: HarmonicMapEntry[]): string {
  const chord = chordAtBeat(map, note.startBeat)?.parsed
  if (!chord) return "unknown"
  const pc = pitchClass(note.pitch)
  return chord.tones.find((tone) => tone.pitchClass === pc)?.role ??
    (chord.tensions.some((tone) => tone.pitchClass === pc) ? "tension" : "outside")
}

function peakIndexOf(notes: MelodyNote[], target: number): number {
  return notes.reduce((best, note, index) =>
    note.pitch > notes[best].pitch ||
    note.pitch === notes[best].pitch &&
      Math.abs(note.startBeat - target) < Math.abs(notes[best].startBeat - target)
      ? index : best, 0)
}

/**
 * 小さな素材が時間とともに大きくなる(Sibelius 的な長い弧)。フレーズごとの最高音が、頂点のフレーズまで
 * 下がらずに少しずつ(5半音以内ずつ)上がっていくほど高い。頂点が早すぎる場合は伸ばしきれていないとみなす。
 */
export function measureGradualGrowth(notes: readonly MelodyNote[], totalBeats: number, phraseBeats: number, peakBeat: number): number {
  const peaks: number[] = []
  for (let start = 0; start < totalBeats; start += phraseBeats) {
    const phrase = notes.filter((note) => note.startBeat >= start && note.startBeat < start + phraseBeats)
    if (phrase.length) peaks.push(Math.max(...phrase.map((note) => note.pitch)))
  }
  const top = Math.min(peaks.length - 1, Math.floor(peakBeat / phraseBeats))
  if (peaks.length < 3 || top <= 0) return 0
  const steps = peaks.slice(1, top + 1).map((peak, index) => peak - peaks[index])
  const rising = steps.filter((step) => step >= 0 && step <= 5).length / steps.length
  return clamp01(rising * Math.min(1, top / Math.max(1, peaks.length - 1) / .6))
}

/** 聴感の代理指標。量ではなく、反復後に一度だけ緊張し、到達後に引く時間配置を測る。 */
export function assessEmotionalArc(
  source: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  role: SectionRole,
  coreLengthBeats: number,
): EmotionalArcAssessment {
  const empty: EmotionalArcAssessment = {
    score: 0, peakPosition: 0, climaxTiming: 0, registerDevelopment: 0,
    expectationSurprise: 0, delayedResolution: 0, phraseBreathing: 0,
    harmonyInteraction: 0, afterglow: 0, motifRetention: 0, gradualGrowth: 0,
  }
  if (source.length < 6 || totalBeats <= 0) return empty
  const notes = [...source].sort((a, b) => a.startBeat - b.startBeat)
  const target = totalBeats * emotionalTargetFraction(role)
  const peakIndex = peakIndexOf(notes, target)
  const peak = notes[peakIndex]
  const peakPosition = peak.startBeat / totalBeats
  const earliest = isChorus(role) ? .57 : role === "pre-chorus" ? .52 : .36
  const latest = isChorus(role) ? .86 : role === "pre-chorus" ? .88 : .82
  const climaxTiming = peakPosition < earliest
    ? clamp01(1 - (earliest - peakPosition) / .32)
    : peakPosition > latest
      ? clamp01(1 - (peakPosition - latest) / .25)
      : 1 - Math.abs(peakPosition - target / totalBeats) * .65

  const early = notes.filter((note) => note.startBeat < Math.max(coreLengthBeats, totalBeats * .28))
  const later = notes.filter((note) => note.startBeat >= totalBeats * .48 && note.startBeat <= peak.startBeat)
  const earlyHigh = early.length ? Math.max(...early.map((note) => note.pitch)) : notes[0].pitch
  const rise = later.length ? Math.max(...later.map((note) => note.pitch)) - earlyHigh : 0
  // 2〜6半音の成長を評価し、無理な高音・大跳躍そのものは報酬にしない。
  const registerDevelopment = rise <= 0 ? 0 : rise < 2 ? rise / 2 : rise <= 6 ? 1 : clamp01(1 - (rise - 6) / 7)

  const motifRetention = computeHookStrength(notes)
  const importantChanges = notes.slice(1).filter((note, index) =>
    note.startBeat >= coreLengthBeats &&
    note.startBeat <= peak.startBeat &&
    (Math.abs(note.pitch - notes[index].pitch) >= 5 ||
      note.plannedToneRole === "appoggiatura" ||
      note.plannedToneRole === "tension-hold")).length
  const restraint = importantChanges === 1 ? 1 : importantChanges === 0 ? .55
    : clamp01(1 - (importantChanges - 1) * .22)
  const expectationSurprise = motifRetention * .6 + restraint * .4

  const deliberateDelays = notes.filter((note, index) => {
    if (note.startBeat < coreLengthBeats || note.startBeat > peak.startBeat || index === notes.length - 1) return false
    const next = notes[index + 1]
    const distance = next.startBeat - note.startBeat
    if (distance < .5 || distance > 3 || Math.abs(next.pitch - note.pitch) > 2) return false
    const currentChord = chordAtBeat(harmonicMap, note.startBeat)
    const nextChord = chordAtBeat(harmonicMap, next.startBeat)
    return Boolean(note.plannedResolution) ||
      Boolean(currentChord && nextChord &&
        !isChordTone(currentChord.parsed, pitchClass(note.pitch)) &&
        isChordTone(nextChord.parsed, pitchClass(next.pitch)))
  }).length
  const delayedResolution = deliberateDelays === 1 ? 1 : deliberateDelays === 0 ? .35
    : clamp01(1 - (deliberateDelays - 1) * .3)

  const before = notes[peakIndex - 1]
  const after = notes[peakIndex + 1]
  const beforeGap = before ? peak.startBeat - before.startBeat - before.durationBeats : 0
  const afterGap = after ? after.startBeat - peak.startBeat - peak.durationBeats : 0
  const phraseBreathing = beforeGap >= .25 && beforeGap <= 1.5 ? 1 :
    afterGap >= .25 && afterGap <= 1.5 ? .8 : .2

  let changedMeaning = false
  for (let index = 1; index < notes.length; index++) {
    const previous = notes[index - 1]
    const current = notes[index]
    if (current.startBeat < coreLengthBeats || current.startBeat > peak.startBeat ||
      current.pitch !== previous.pitch) continue
    const beforeChord = chordAtBeat(harmonicMap, previous.startBeat)
    const afterChord = chordAtBeat(harmonicMap, current.startBeat)
    if (beforeChord !== afterChord && harmonicRole(previous, harmonicMap) !== harmonicRole(current, harmonicMap)) {
      changedMeaning = true
      break
    }
  }
  if (!changedMeaning) {
    for (const boundary of harmonicMap.slice(1)) {
      const beat = boundary.chord.startBeat
      if (beat < coreLengthBeats || beat > peak.startBeat) continue
      const previousChord = chordAtBeat(harmonicMap, beat - .01)
      if (!previousChord) continue
      const held = notes.find((note) => note.startBeat < beat && note.startBeat + note.durationBeats > beat + .1)
      if (!held) continue
      const pc = pitchClass(held.pitch)
      const beforeRole = previousChord.parsed.tones.find((tone) => tone.pitchClass === pc)?.role ??
        (isTensionTone(previousChord.parsed, pc) ? "tension" : "outside")
      const afterRole = boundary.parsed.tones.find((tone) => tone.pitchClass === pc)?.role ??
        (isTensionTone(boundary.parsed, pc) ? "tension" : "outside")
      if (beforeRole !== afterRole && beforeRole !== "outside" && afterRole !== "outside") {
        changedMeaning = true
        break
      }
    }
  }
  const harmonyInteraction = changedMeaning ? 1 : .4

  const tail = notes.filter((note) => note.startBeat > peak.startBeat)
  const lowerTail = tail.length > 0 &&
    tail.reduce((sum, note) => sum + note.pitch, 0) / tail.length <= peak.pitch - 2
  const longLanding = notes.at(-1)!.durationBeats >= 1
  const lighterTail = tail.length > 0 &&
    tail.filter((note) => note.startBeat >= totalBeats * .82).length <=
      notes.filter((note) => note.startBeat >= totalBeats * .55 && note.startBeat < totalBeats * .73).length + 1
  const afterglow = (lowerTail ? .45 : 0) + (longLanding ? .3 : 0) + (lighterTail ? .25 : 0)
  const gradualGrowth = measureGradualGrowth(notes, totalBeats, Math.max(4, coreLengthBeats * 2), peak.startBeat)
  const score = clamp01(
    climaxTiming * .16 + registerDevelopment * .13 + expectationSurprise * .13 +
    delayedResolution * .1 + phraseBreathing * .1 + harmonyInteraction * .08 +
    afterglow * .14 + motifRetention * .1 + gradualGrowth * .06,
  )
  return {
    score, peakPosition, climaxTiming, registerDevelopment, expectationSurprise,
    delayedResolution, phraseBreathing, harmonyInteraction, afterglow, motifRetention, gradualGrowth,
  }
}

/** 既存の音を最大1音だけ再解釈し、頂点前後の長さを整える。Core内の音高・発音位置は触らない。 */
export function shapeEmotionalArc(
  source: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
  role: SectionRole,
  coreLengthBeats: number,
): MelodyNote[] {
  const notes = source.map((note) => ({
    ...note, plannedResolution: note.plannedResolution ? { ...note.plannedResolution } : undefined,
  })).sort((a, b) => a.startBeat - b.startBeat)
  if (notes.length < 10 || totalBeats < 16) return notes
  const target = totalBeats * emotionalTargetFraction(role)
  const peakIndex = peakIndexOf(notes, target)
  const peak = notes[peakIndex]
  if (peak.startBeat < Math.max(coreLengthBeats + 2, totalBeats * .4) || peakIndex >= notes.length - 2) return notes
  const before = notes[peakIndex - 1]
  if (before && before.startBeat >= coreLengthBeats && before.locks.length === 0 && !before.plannedResolution) {
    const maximum = peak.startBeat - before.startBeat - .25
    if (maximum >= .25) before.durationBeats = Math.min(before.durationBeats, maximum)
  }

  let reinterpreted = false
  for (let index = 1; index < peakIndex; index++) {
    const prior = notes[index - 1]
    const current = notes[index]
    if (current.startBeat < Math.max(coreLengthBeats + 2, totalBeats * .42) ||
      current.locks.length || current.plannedResolution ||
      Math.abs(current.pitch - prior.pitch) > 2) continue
    const firstChord = chordAtBeat(harmonicMap, prior.startBeat)
    const secondChord = chordAtBeat(harmonicMap, current.startBeat)
    if (!firstChord || !secondChord || firstChord === secondChord) continue
    const oldPc = pitchClass(prior.pitch)
    if (prior.pitch < range.low || prior.pitch > range.high ||
      !allUsablePitchClasses(secondChord.parsed).includes(oldPc)) continue
    const oldRole = harmonicRole(prior, harmonicMap)
    const newRole = secondChord.parsed.tones.find((tone) => tone.pitchClass === oldPc)?.role ??
      (isTensionTone(secondChord.parsed, oldPc) ? "tension" : "outside")
    if (oldRole === newRole || newRole === "outside") continue
    current.pitch = prior.pitch
    current.plannedToneRole = newRole === "tension" ? "tension-hold" : "common-tone"
    reinterpreted = true
    break
  }

  const peakChord = chordAtBeat(harmonicMap, peak.startBeat)
  if (!reinterpreted && before && before.startBeat >= coreLengthBeats && before.locks.length === 0 &&
    !before.plannedResolution && !peak.plannedResolution && peak.startBeat - before.startBeat <= 2 &&
    peakChord && isChordTone(peakChord.parsed, pitchClass(peak.pitch))) {
    const chord = chordAtBeat(harmonicMap, before.startBeat)
    if (chord) {
      const choices = [before.pitch - 1, before.pitch + 1].filter((pitch) =>
        pitch >= range.low && pitch <= range.high && pitch !== peak.pitch &&
        Math.abs(pitch - peak.pitch) <= 2 &&
        allUsablePitchClasses(chord.parsed).includes(pitchClass(pitch)) &&
        !isChordTone(chord.parsed, pitchClass(pitch)))
      if (choices.length) {
        before.pitch = choices.reduce((best, pitch) =>
          Math.abs(pitch - before.pitch) < Math.abs(best - before.pitch) ? pitch : best)
        before.plannedToneRole = "appoggiatura"
        before.plannedResolution = {
          targetPitchClass: pitchClass(peak.pitch),
          targetBeat: peak.startBeat,
          maximumDelayBeats: peak.startBeat - before.startBeat,
        }
      }
    }
  }
  const last = notes.at(-1)!
  if (last.startBeat > peak.startBeat && last.locks.length === 0 && !last.plannedResolution) {
    last.durationBeats = Math.min(totalBeats - last.startBeat, Math.max(last.durationBeats, 1.25))
  }
  for (const note of notes.slice(peakIndex + 1)) note.velocity = Math.min(note.velocity, Math.max(55, peak.velocity - 10))
  return notes
}
