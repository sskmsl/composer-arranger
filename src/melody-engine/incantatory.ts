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
import { chordTonePitchClasses, hasSemitoneRisk } from "@/core/chord"
import { nearestAllowedPitch } from "./pitchUtils"
import type { RangeSetting } from "./generationParams"

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

/** core motif: 2〜5音、同音反復・半音・短3度中心の短い核を作る */
function generateCoreMotif(rng: SeededRandom, durationPalette: number[]): CoreMotif {
  const noteCount = rng.intBetween(2, 5)
  const intervals = [0]
  for (let i = 1; i < noteCount; i++) {
    intervals.push(intervals[i - 1] + rng.pick(STEP_CHOICES))
  }
  const durations = Array.from({ length: noteCount }, () => rng.pick(durationPalette))
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

export function generateIncantatoryPattern(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  intensity: number,
  noteDensity: number,
): { notes: MelodyNote[]; plan: IncantatoryPatternPlan } {
  const durationPalette = noteDensity > 0.6 ? [0.25, 0.5, 0.5, 0.75] : [0.5, 0.5, 0.75, 1]
  const coreMotif = generateCoreMotif(rng, durationPalette)
  const mutationPeriod = rng.pick([4, 8])

  const firstChord = chordAtBeat(harmonicMap, 0)
  const startMid = Math.round((range.low + range.high) / 2)
  let anchorPitch = firstChord ? nearestAllowedPitch(startMid, chordTonePitchClasses(firstChord.parsed), range) : startMid

  const notes: MelodyNote[] = []
  let cursor = 0
  let repeatIndex = 0
  let currentCopy: MutatedCopy = { intervals: coreMotif.intervals, durations: coreMotif.durations, nonHarmonicIndex: null, velocityBoostIndex: null }

  while (cursor < totalBeats - 0.2) {
    const isMutationPoint = repeatIndex > 0 && repeatIndex % mutationPeriod === 0
    if (isMutationPoint && rng.chance(0.6 * intensity + 0.2)) {
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

  return { notes, plan: { motifNoteCount: coreMotif.intervals.length, mutationPeriod, coreMotif } }
}
