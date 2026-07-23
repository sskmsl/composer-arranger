import type { SeededRandom } from "@/core/rng"
import type { Density, GenerationParams, RangeSetting } from "./generationParams"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { nearestAllowedPitch } from "./pitchUtils"

export interface MotifEvent {
  offsetBeats: number
  durationBeats: number
  isRest: boolean
}

export interface MotifCore {
  events: MotifEvent[]
  /** 非休符イベントに対応するピッチ(絶対MIDI) */
  pitches: number[]
  lengthBeats: number
}

const DURATION_PALETTE: Record<Density, number[]> = {
  sparse: [1, 1.5, 2, 2, 3],
  balanced: [0.5, 1, 1, 1.5, 2],
  active: [0.25, 0.5, 0.5, 0.5, 1, 1.5],
}

/** 9.3 Rhythm Motif: 音程より先にリズムの核(2〜5音)を作る */
export function generateRhythmMotif(rng: SeededRandom, density: Density, params: GenerationParams): MotifEvent[] {
  const palette = DURATION_PALETTE[density]
  const noteCount = rng.intBetween(2, 5)
  const events: MotifEvent[] = []
  let cursor = 0
  // 小節頭の休符(9.3)を稀に許容し、フレーズの食い込みを演出する
  if (rng.chance(params.restRatioTarget * 0.3)) {
    const leadRest = rng.pick([0.5, 1])
    events.push({ offsetBeats: 0, durationBeats: leadRest, isRest: true })
    cursor = leadRest
  }
  for (let i = 0; i < noteCount; i++) {
    const duration = rng.pick(palette)
    const isRest = i > 0 && i < noteCount - 1 && rng.chance(params.restRatioTarget * 0.35)
    events.push({ offsetBeats: cursor, durationBeats: duration, isRest })
    cursor += duration
  }
  return events
}

/** 9.4 Pitch Motif: 2〜5音の核へピッチを割り当てる */
export function generatePitchMotif(
  rng: SeededRandom,
  events: MotifEvent[],
  motifStartBeat: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
): number[] {
  const effectiveHigh = range.high - params.peakHeadroomSemitones
  const effectiveRange = { low: range.low, high: Math.max(range.low + 4, effectiveHigh) }
  const midRange = Math.round((effectiveRange.low + effectiveRange.high) / 2)

  const pitches: number[] = []
  let prev: number | null = null

  for (const event of events) {
    if (event.isRest) continue
    const beat = motifStartBeat + event.offsetBeats
    const entry = chordAtBeat(harmonicMap, beat)
    const chordTones = entry ? chordTonePitchClasses(entry.parsed) : [0, 4, 7]
    const usable = entry ? allUsablePitchClasses(entry.parsed) : chordTones

    if (prev === null) {
      // 開始音: コードトーンの中からレンジ中央に最も近いもの(9.4 歌いやすさ・音域内での位置)
      let best = chordTones[0]
      let bestDist = Infinity
      for (const pc of chordTones) {
        const cand = nearestAllowedPitch(midRange - 6 + (pc - (midRange % 12) + 24) % 12, [pc], effectiveRange)
        const dist = Math.abs(cand - midRange)
        if (dist < bestDist) {
          bestDist = dist
          best = cand
        }
      }
      pitches.push(best)
      prev = best
      continue
    }

    const useTension = rng.chance(params.tensionUsageTarget)
    const allowed = useTension ? usable : chordTones
    const wantsLeap = rng.chance(params.leapWidthBias)
    const direction = rng.chance(0.5) ? 1 : -1
    const magnitude = wantsLeap ? rng.intBetween(3, 7) : rng.intBetween(1, 2)
    const candidate = prev + direction * magnitude
    const snapped = nearestAllowedPitch(candidate, allowed, effectiveRange)
    pitches.push(snapped)
    prev = snapped
  }

  return pitches
}
