/**
 * Incantatory Generator Profile (Melody Candidate Diversity v1.2 §5)
 *
 * 生成順序: core motif → repetition cycle → mutation schedule → harmonic adaptation
 * (Minimal/Rhythmic/Speech-Rhythmicのパラメータ変更版として実装しない。短い核モチーフを
 * 反復の中心に置き、周期的な位置だけで一要素を変異させ、輪郭の同一性を保ったまま
 * 和声変化へ追従させる専用パイプライン)
 */
import type { SeededRandom } from "@/core/rng"
import type { MelodyNote } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { allUsablePitchClasses, chordTonePitchClasses, hasSemitoneRisk } from "@/core/chord"
import { pitchClass } from "@/core/note"
import { nearestAllowedPitch } from "./pitchUtils"
import type { RangeSetting } from "./generationParams"
import type { CandidateMelodyDNA, MelodyOpeningPlan, SongMotifDNA } from "@/core/melody"
import { openingDirectionSign, openingStartMidi } from "./openingIntent"

const STEP_CHOICES = [0, 0, 1, -1, 1, -1, 3, -3] // 同音反復・半音・短3度を優先した重み付け

type MutationKind = "endingNote" | "rhythm" | "accent" | "highestNote" | "nonHarmonicTone"
const MUTATION_KINDS: MutationKind[] = ["endingNote", "rhythm", "accent", "highestNote", "nonHarmonicTone"]

export interface CoreMotif {
  /** 先頭音からの半音差(先頭は常に0) */
  intervals: number[]
  durations: number[]
  lengthBeats: number
}

export interface IncantatoryPatternPlan {
  motifNoteCount: number
  mutationPeriod: number
  coreMotif: CoreMotif
}

/** core motif: 2〜5音、同音反復・半音・短3度中心の短い核を作る。openingで核の輪郭を計画へ寄せる */
function generateCoreMotif(
  rng: SeededRandom,
  durationPalette: number[],
  opening?: MelodyOpeningPlan,
  candidateMelodyDNA?: CandidateMelodyDNA,
): CoreMotif {
  const noteCount = rng.intBetween(2, 5)
  const intervals = [0]

  if (opening) {
    const sign = openingDirectionSign(opening) || 1
    for (let i = 1; i < noteCount; i++) {
      let step: number
      switch (opening.openingContour) {
        case "repeated-note":
          step = i === 1 ? 0 : rng.pick([0, 0, 1, -1])
          break
        case "leap-then-recover":
          step = i === 1 ? sign * rng.pick([3, 4]) : -sign * rng.pick([1, 1, 2])
          break
        case "suspension-entry":
          step = i === 1 ? -1 : rng.pick([0, 1, -1])
          break
        default: // stepwise / pickup-resolution
          step = sign * rng.pick([1, 1, 2, 0])
      }
      intervals.push(intervals[i - 1] + step)
    }
  } else if (candidateMelodyDNA) {
    for (let i = 1; i < noteCount; i++) {
      const previous = intervals[i - 1]
      const step =
        candidateMelodyDNA.motifIdentity === "repeated-cell"
          ? rng.pick([0, 0, 0, 1, -1])
          : candidateMelodyDNA.motifIdentity === "chromatic-cell"
            ? rng.pick([1, -1, 1, -1])
            : candidateMelodyDNA.motifIdentity === "leap-recovery"
              ? i === 1
                ? rng.pick([3, -3, 4, -4])
                : rng.pick([1, -1])
              : rng.pick(STEP_CHOICES)
      intervals.push(previous + step)
    }
  } else {
    for (let i = 1; i < noteCount; i++) {
      intervals.push(intervals[i - 1] + rng.pick(STEP_CHOICES))
    }
  }

  const durations = Array.from({ length: noteCount }, (_, i) =>
    opening && i === 0 ? opening.firstNoteDuration : rng.pick(durationPalette),
  )
  return { intervals, durations, lengthBeats: durations.reduce((a, b) => a + b, 0) }
}

interface MutatedCopy {
  intervals: number[]
  durations: number[]
  nonHarmonicIndex: number | null
  velocityBoostIndex: number | null
}

function applyMutation(rng: SeededRandom, motif: CoreMotif, kind: MutationKind): MutatedCopy {
  const intervals = [...motif.intervals]
  const durations = [...motif.durations]
  let nonHarmonicIndex: number | null = null
  let velocityBoostIndex: number | null = null

  switch (kind) {
    case "endingNote": {
      const last = intervals.length - 1
      intervals[last] += rng.pick([1, -1, 2, -2])
      break
    }
    case "rhythm": {
      const idx = rng.intBetween(0, durations.length - 1)
      const neighbor = idx === durations.length - 1 ? idx - 1 : idx + 1
      if (neighbor >= 0 && durations[idx] > 0.25) {
        const shift = Math.min(0.25, durations[idx] - 0.25)
        durations[idx] -= shift
        durations[neighbor] += shift
      }
      break
    }
    case "accent": {
      velocityBoostIndex = rng.intBetween(0, intervals.length - 1)
      break
    }
    case "highestNote": {
      const maxIdx = intervals.indexOf(Math.max(...intervals))
      intervals[maxIdx] += 12
      break
    }
    case "nonHarmonicTone": {
      nonHarmonicIndex = rng.intBetween(0, intervals.length - 1)
      break
    }
  }

  return { intervals, durations, nonHarmonicIndex, velocityBoostIndex }
}

function realizeCopy(
  rng: SeededRandom,
  copy: MutatedCopy,
  startBeat: number,
  anchorPitch: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
): MelodyNote[] {
  const notes: MelodyNote[] = []
  let cursor = startBeat
  copy.intervals.forEach((interval, i) => {
    const duration = copy.durations[i]
    const entry = chordAtBeat(harmonicMap, cursor)
    let pitch = anchorPitch + interval

    if (i === copy.nonHarmonicIndex) {
      // harmonic adaptation: あえてコードトーンへスナップさせず、経過的な緊張を残す
      pitch = Math.max(range.low, Math.min(range.high, pitch))
    } else if (entry && hasSemitoneRisk(entry.parsed, pitch)) {
      // 輪郭を保ったまま、半音衝突のみ最小限の和声適応で回避する
      const tones = chordTonePitchClasses(entry.parsed)
      pitch = nearestAllowedPitch(pitch, tones, range)
    } else {
      pitch = Math.max(range.low, Math.min(range.high, pitch))
    }

    notes.push({
      id: crypto.randomUUID(),
      startBeat: cursor,
      durationBeats: duration,
      pitch,
      velocity: 74 + (i === copy.velocityBoostIndex ? 16 : 0) + rng.intBetween(-3, 3),
      locks: [],
    })
    cursor += duration
  })
  return notes
}

/**
 * 核モチーフの輪郭を優先しつつ、和声的に説明できない音だけを整える。
 * 短い順次非和声音は直後の解決計画を付けて保持し、それ以外は
 * コードのusable toneへ最小移動する。
 */
function harmonizeIncantatoryNotes(
  notes: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
): void {
  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index]
    const next = notes[index + 1]
    const entry = chordAtBeat(harmonicMap, note.startBeat)
    if (!entry) continue
    const chordTones = chordTonePitchClasses(entry.parsed)
    const usable = allUsablePitchClasses(entry.parsed)
    const pc = pitchClass(note.pitch)
    if (chordTones.includes(pc)) {
      note.plannedToneRole = "chord-tone"
      note.plannedResolution = undefined
      continue
    }
    if (usable.includes(pc)) {
      note.plannedToneRole = "tension-hold"
      note.plannedResolution = undefined
      continue
    }

    const nextEntry = next ? chordAtBeat(harmonicMap, next.startBeat) : undefined
    const nextUsable = nextEntry ? allUsablePitchClasses(nextEntry.parsed) : []
    const resolvesByStep =
      Boolean(next) &&
      next!.startBeat - (note.startBeat + note.durationBeats) <= 0.8 &&
      Math.abs(next!.pitch - note.pitch) <= 2 &&
      nextUsable.includes(pitchClass(next!.pitch))
    if (note.durationBeats <= 1 && resolvesByStep) {
      note.plannedToneRole = "passing-tone"
      note.plannedResolution = {
        targetPitchClass: pitchClass(next!.pitch),
        targetBeat: next!.startBeat,
        maximumDelayBeats: Math.max(0.5, next!.startBeat - note.startBeat),
      }
      continue
    }

    note.pitch = nearestAllowedPitch(note.pitch, usable, range)
    note.plannedToneRole = chordTones.includes(pitchClass(note.pitch)) ? "chord-tone" : "tension-hold"
    note.plannedResolution = undefined
  }
}

export function generateIncantatoryPattern(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  intensity: number,
  noteDensity: number,
  dna?: SongMotifDNA,
  opening?: MelodyOpeningPlan,
  candidateMelodyDNA?: CandidateMelodyDNA,
): { notes: MelodyNote[]; plan: IncantatoryPatternPlan } {
  const durationPalette = noteDensity > 0.6 ? [0.25, 0.5, 0.5, 0.75] : [0.5, 0.5, 0.75, 1]
  const coreMotif = generateCoreMotif(rng, durationPalette, opening, candidateMelodyDNA)
  // Song Motif DNA(任意): 反復傾向が高いほど変異周期を長く(=反復をより長く保つ)、
  // 変異そのものも起きにくくする。noteDensityの閾値のように丸めで消えない、
  // 連続的な効き方をする箇所へ反映する。
  const repeatedTendency = dna?.repeatedNoteTendency
  const mutationPeriod =
    candidateMelodyDNA?.developmentStrategy === "literal-return"
      ? 8
      : candidateMelodyDNA?.developmentStrategy === "fragmentation"
        ? 4
        : repeatedTendency !== undefined
          ? rng.weightedPick([4, 8], [1 - repeatedTendency * 0.7, 1 + repeatedTendency * 0.7])
          : rng.pick([4, 8])
  const mutationChanceBase = repeatedTendency !== undefined ? 0.6 * (1 - repeatedTendency * 0.5) : 0.6

  const firstChord = chordAtBeat(harmonicMap, 0)
  const startMid = Math.round((range.low + range.high) / 2)
  // 冒頭設計: アンカー(核モチーフの起点)の音域・開始音を計画で分ける
  let anchorPitch = opening
    ? openingStartMidi(opening, range)
    : firstChord
      ? nearestAllowedPitch(startMid, chordTonePitchClasses(firstChord.parsed), range)
      : startMid

  const notes: MelodyNote[] = []
  // 冒頭設計: 詠唱の入りを計画したオフセットだけ遅らせる(休符後の開始)
  let cursor = opening ? opening.startBeatOffset : 0
  const openingVariationGate = cursor + (opening?.openingPhraseLengthBeats ?? 0)
  let repeatIndex = 0
  let openingGateReached = !opening
  let currentCopy: MutatedCopy = { intervals: coreMotif.intervals, durations: coreMotif.durations, nonHarmonicIndex: null, velocityBoostIndex: null }

  while (cursor < totalBeats - 0.2) {
    const firstCycleAfterOpeningGate = !openingGateReached && cursor >= openingVariationGate - 1e-6
    if (firstCycleAfterOpeningGate) openingGateReached = true
    const isMutationPoint =
      repeatIndex > 0 &&
      (firstCycleAfterOpeningGate || (openingGateReached && repeatIndex % mutationPeriod === 0))
    if (isMutationPoint && rng.chance(mutationChanceBase * intensity + 0.2)) {
      currentCopy = applyMutation(rng, coreMotif, rng.pick(MUTATION_KINDS))
    } else if (repeatIndex > 0) {
      // 変異周期外は同一性を保つ(輪郭retentionを高く保つ)
      currentCopy = { intervals: coreMotif.intervals, durations: coreMotif.durations, nonHarmonicIndex: null, velocityBoostIndex: null }
    }

    // 和声適応: このサイクル先頭のアンカーだけをコード変化へ緩やかに追従させる(モチーフ全体は再スナップしない)
    const entry = chordAtBeat(harmonicMap, cursor)
    if (entry) anchorPitch = nearestAllowedPitch(anchorPitch, chordTonePitchClasses(entry.parsed), range)

    const remaining = totalBeats - cursor
    const copyLength = currentCopy.durations.reduce((a, b) => a + b, 0)
    if (copyLength > remaining) {
      // 最後のサイクルは収まる音だけ残す(セクション終端をはみ出さない)
      let acc = 0
      const clipIdx = currentCopy.durations.findIndex((d) => {
        acc += d
        return acc > remaining
      })
      if (clipIdx <= 0) break
      currentCopy = {
        intervals: currentCopy.intervals.slice(0, clipIdx),
        durations: currentCopy.durations.slice(0, clipIdx),
        nonHarmonicIndex: currentCopy.nonHarmonicIndex,
        velocityBoostIndex: currentCopy.velocityBoostIndex,
      }
    }
    if (currentCopy.intervals.length === 0) break

    notes.push(...realizeCopy(rng, currentCopy, cursor, anchorPitch, harmonicMap, range))
    cursor += currentCopy.durations.reduce((a, b) => a + b, 0)
    repeatIndex++
  }

  harmonizeIncantatoryNotes(notes, harmonicMap, range)
  return { notes, plan: { motifNoteCount: coreMotif.intervals.length, mutationPeriod, coreMotif } }
}
