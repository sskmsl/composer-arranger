import type { SeededRandom } from "@/core/rng"
import type { Density, GenerationParams, RangeSetting } from "./generationParams"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { nearestAllowedPitch, withKeyBias } from "./pitchUtils"

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

/**
 * densityNoteMultiplierに応じて音価パレットの重みを短い方(または長い方)へ寄せる。
 * multiplier>1(Active寄り)ほど短い音価を、<1(Outro等)ほど長い音価を選びやすくすることで、
 * 同じフレーズ長でも実際のノート数が変化するようにする(以前はDensity Note Multiplierが
 * 計算されるだけで生成処理のどこからも参照されておらず、常に無効だった)。
 */
function pickDuration(rng: SeededRandom, palette: number[], densityNoteMultiplier: number): number {
  const bias = Math.max(0.35, Math.min(2.8, densityNoteMultiplier))
  const n = palette.length
  const weights = palette.map((_, i) => Math.pow(bias, 1 - (2 * i) / Math.max(1, n - 1)))
  return rng.weightedPick(palette, weights)
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
    const rawDuration = pickDuration(rng, palette, params.densityNoteMultiplier)
    const isRest = i > 0 && i < noteCount - 1 && rng.chance(params.restRatioTarget * 0.35)
    // syncopationAmountに応じて、拍頭に揃っている場合に限り開始位置を半拍だけ後ろへ食い込ませる
    // (durationも半拍削るため、次イベントのcursor位置は変えない=はみ出し・重なりは発生しない)
    const onBeat = Math.abs(cursor - Math.round(cursor)) < 0.01
    let offset = cursor
    let duration = rawDuration
    if (!isRest && onBeat && rawDuration > 0.5 && rng.chance(params.syncopationAmount * 0.6)) {
      offset = cursor + 0.5
      duration = rawDuration - 0.5
    }
    events.push({ offsetBeats: offset, durationBeats: duration, isRest })
    cursor += rawDuration
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
    const allowed = useTension ? withKeyBias(usable, params.keyScalePitchClasses) : chordTones
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
