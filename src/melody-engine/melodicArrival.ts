import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import { chordTonePitchClasses } from "@/core/chord"
import { pitchClass } from "@/core/note"
import type { Drama, RangeSetting } from "./generationParams"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"

/**
 * Standardの既存の頂点に、短い間・滞在・近接した着地を与える。
 * 音数や全体の最高音は増やさない。冒頭の核・終止・ロック・専用Profileは保持する。
 * 感情の評価ではなく、聴き比べ可能な構造上の表現操作。
 */
export function applyMelodicArrival(
  source: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
  drama: Drama,
  profile: MelodyGeneratorProfile = "standard",
): MelodyNote[] {
  const notes = source.map(note => ({ ...note, plannedResolution: note.plannedResolution ? { ...note.plannedResolution } : undefined }))
    .sort((a, b) => a.startBeat - b.startBeat)
  if (profile !== "standard" || drama === "restrained" || notes.length < 7) return notes
  const peakIndex = notes.reduce((best, note, index) => note.pitch > notes[best].pitch ? index : best, 0)
  // 最初の3音を核として保持。最後の音はEnding Strategyへ委ねる。
  if (peakIndex < 4 || peakIndex >= notes.length - 2) return notes
  const before = notes[peakIndex - 1]
  const peak = notes[peakIndex]
  const after = notes[peakIndex + 1]
  if ([before, peak, after].some(note => note.locks.length > 0)) return notes
  // 既存の解決先を動かすと関係が壊れるため、計画済みの音対はそのままにする。
  if ([before, peak, after].some(note => note.plannedResolution) || notes.some(note =>
    note.plannedResolution && [before, peak, after].some(target => Math.abs(target.startBeat - note.plannedResolution!.targetBeat) < 0.01))) return notes
  const peakEntry = chordAtBeat(harmonicMap, peak.startBeat)
  const afterEntry = chordAtBeat(harmonicMap, after.startBeat)
  if (!peakEntry || !afterEntry) return notes

  // 頂点への最後の一歩を、その拍の和声に合う音から選ぶ。
  const beforeEntry = chordAtBeat(harmonicMap, before.startBeat)
  if (beforeEntry && peak.startBeat - before.startBeat <= 2) {
    const allowed = chordTonePitchClasses(beforeEntry.parsed)
    const options: number[] = []
    for (let pitch = Math.max(range.low, peak.pitch - 5); pitch <= Math.min(range.high, peak.pitch - 2); pitch++) {
      if (allowed.includes(pitchClass(pitch))) options.push(pitch)
    }
    const preceding = notes[peakIndex - 2]
    const reachable = options.filter(pitch => Math.abs(pitch - preceding.pitch) <= 5)
    if (reachable.length > 0) {
      before.pitch = reachable.reduce((best, pitch) => Math.abs(pitch - before.pitch) < Math.abs(best - before.pitch) ? pitch : best)
      before.plannedToneRole = "chord-tone"
    }
  }
  const breath = drama === "open" ? 0.5 : 0.25
  const space = peak.startBeat - before.startBeat - breath
  if (space >= 0.25) before.durationBeats = Math.min(before.durationBeats, space)

  // 後続音の半拍以上を残し、同じ和声内でのみ頂点の滞在を延ばす。
  const afterEnd = after.startBeat + after.durationBeats
  if (peakEntry === afterEntry) {
    const chordEnd = peakEntry.chord.startBeat + peakEntry.chord.durationBeats
    const maximumShift = Math.min(drama === "open" ? 0.75 : 0.5, after.durationBeats - 0.5,
      chordEnd - after.startBeat - 0.5, totalBeats - after.startBeat - 0.5)
    if (maximumShift > 0 && after.startBeat - peak.startBeat < 1.5) {
      after.startBeat += maximumShift
      after.durationBeats = afterEnd - after.startBeat
    }
    peak.durationBeats = Math.max(peak.durationBeats,
      Math.min(1.5, after.startBeat - peak.startBeat, chordEnd - peak.startBeat, totalBeats - peak.startBeat))
  }

  // 頂点の後を1〜3半音下のコードトーンへ。次のフレーズへ無理な跳躍を作らない。
  const resolutionTones = chordTonePitchClasses(afterEntry.parsed)
  const landing = [peak.pitch - 1, peak.pitch - 2, peak.pitch - 3].find(pitch =>
    pitch >= range.low && pitch <= range.high && resolutionTones.includes(pitchClass(pitch)) &&
    Math.abs(pitch - notes[peakIndex + 2].pitch) <= 5)
  if (landing !== undefined) {
    after.pitch = landing
    after.plannedToneRole = "chord-tone"
    if (!chordTonePitchClasses(peakEntry.parsed).includes(pitchClass(peak.pitch)) && peak.pitch - landing <= 2 && after.startBeat - peak.startBeat <= 2) {
      peak.plannedToneRole = "appoggiatura"
      peak.plannedResolution = { targetPitchClass: pitchClass(landing), targetBeat: after.startBeat, maximumDelayBeats: after.startBeat - peak.startBeat }
    }
  }
  peak.velocity = Math.max(peak.velocity, drama === "open" ? 98 : 92)
  after.velocity = Math.min(after.velocity, peak.velocity - 10)
  return notes
}
