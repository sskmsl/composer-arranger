import type { MelodyNote } from "@/core/melody"
import type { GenerationParams } from "./generationParams"
import type { ReferenceMelodyTraits, ResolvedReferenceTarget } from "@/core/referenceProfile"

/**
 * 旋律の「一般化された特徴」を、Reference Profile と同じ物差し(0〜1)で測る。
 * 参考曲の音列とは比べない(持っていない)。比べるのは密度・余白・リズムの個性・反復・頂点の位置だけ。
 * tools/reference-analysis/analyze_reference.py も同じ定義で参考曲を測る。
 */
export type MelodyReferenceFeatures = Omit<ReferenceMelodyTraits, "motifLength">

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

/** 1拍あたりの音数 → 0〜1(0.25音/拍で0、3音/拍で1) */
export const noteDensityScale = (notesPerBeat: number) => clamp01((notesPerBeat - .25) / 2.75)
/** 休符の割合 → 0〜1(60%で1) */
export const restDensityScale = (restRatio: number) => clamp01(restRatio / .6)
/** 動機の長さ(拍) → 0〜1(1拍で0、8拍で1) */
export const motifLengthScale = (beats: number) => clamp01((beats - 1) / 7)

function rhythmicIdentityOf(sorted: readonly MelodyNote[]): number {
  if (sorted.length < 2) return 0
  const offbeat = sorted.filter((note) => Math.abs(note.startBeat - Math.round(note.startBeat)) > .05).length / sorted.length
  const gaps = sorted.slice(1).map((note, index) => Math.round((note.startBeat - sorted[index].startBeat) * 4) / 4)
  const gapTypes = new Set(gaps.filter((gap) => gap > 0)).size
  return clamp01(offbeat / .6 * .6 + clamp01((gapTypes - 1) / 4) * .4)
}

/** 音程を(向き × 同音/順次/3度/4〜5度/それ以上)にまとめる。細部が違っても同じ形の戻りを反復とみなす */
function intervalClass(interval: number): number {
  const size = Math.abs(interval)
  const step = size === 0 ? 0 : size <= 2 ? 1 : size <= 4 ? 2 : size <= 7 ? 3 : 4
  return interval >= 0 ? step : -step
}

function repetitionOf(sorted: readonly MelodyNote[]): number {
  const intervals = sorted.slice(1).map((note, index) => intervalClass(note.pitch - sorted[index].pitch))
  if (intervals.length < 4) return 0
  const grams = intervals.slice(2).map((_, index) => intervals.slice(index, index + 3).join(","))
  const counts = new Map<string, number>()
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1)
  return clamp01(grams.filter((gram) => (counts.get(gram) ?? 0) > 1).length / grams.length)
}

export function measureMelodyReferenceFeatures(notes: readonly MelodyNote[], totalBeats: number): MelodyReferenceFeatures {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const beats = Math.max(1, totalBeats)
  if (sorted.length === 0) {
    return { repetition: 0, noteDensity: 0, restDensity: 1, rhythmicIdentity: 0, registerExpansion: .5, climaxTiming: .5 }
  }
  const sounding = sorted.reduce((sum, note, index) => {
    const next = sorted[index + 1]?.startBeat ?? beats
    return sum + Math.max(0, Math.min(note.durationBeats, next - note.startBeat))
  }, 0)
  const half = beats / 2
  const rangeOf = (part: MelodyNote[]) => part.length ? Math.max(...part.map((n) => n.pitch)) - Math.min(...part.map((n) => n.pitch)) : 0
  const first = sorted.filter((note) => note.startBeat < half)
  const second = sorted.filter((note) => note.startBeat >= half)
  const peak = Math.max(...sorted.map((note) => note.pitch))
  const peakNote = sorted.find((note) => note.pitch === peak)!
  return {
    repetition: repetitionOf(sorted),
    noteDensity: noteDensityScale(sorted.length / beats),
    restDensity: restDensityScale(1 - sounding / beats),
    rhythmicIdentity: rhythmicIdentityOf(sorted),
    registerExpansion: clamp01(.5 + (rangeOf(second) - rangeOf(first)) / 12),
    climaxTiming: clamp01(peakNote.startBeat / beats),
  }
}

/** 候補全体が参考曲の傾向にどれだけ近いか(0〜100)。候補選びの小さな重みとしてだけ使う */
export function melodyReferenceFitScore(
  notes: readonly MelodyNote[],
  totalBeats: number,
  reference: ResolvedReferenceTarget<ReferenceMelodyTraits>,
): number {
  const features = measureMelodyReferenceFeatures(notes, totalBeats)
  const target = reference.traits
  const weights: Record<keyof MelodyReferenceFeatures, number> = {
    noteDensity: .24, restDensity: .2, rhythmicIdentity: .18, repetition: .16, climaxTiming: .12, registerExpansion: .1,
  }
  const distance = (Object.keys(weights) as (keyof MelodyReferenceFeatures)[])
    .reduce((sum, key) => sum + Math.abs(features[key] - target[key]) * weights[key], 0)
  return Math.round((1 - distance) * 1000) / 10
}

/** 核になる短い動機が参考曲の傾向にどれだけ近いか(0〜1) */
export function coreReferenceFit(
  judgment: { rhythmicIdentity: number; repeatability: number },
  notes: readonly MelodyNote[],
  lengthBeats: number,
  target: ReferenceMelodyTraits,
): number {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const sounding = sorted.reduce((sum, note) => sum + note.durationBeats, 0)
  const breathing = restDensityScale(clamp01((lengthBeats - sounding) / Math.max(1, lengthBeats)))
  const distance =
    Math.abs(motifLengthScale(lengthBeats) - target.motifLength) * .22
    + Math.abs(noteDensityScale(sorted.length / Math.max(1, lengthBeats)) - target.noteDensity) * .24
    + Math.abs(breathing - target.restDensity) * .2
    + Math.abs(judgment.rhythmicIdentity - target.rhythmicIdentity) * .2
    + Math.abs(judgment.repeatability - target.repetition) * .14
  return clamp01(1 - distance)
}

/**
 * 旋律への参考値の効き。いまの曲にすでに核の動機(Motif DNA)があるときは、
 * 参考曲を理由に旋律を大きく変えないよう弱める。
 */
export function melodyReferenceStrength(
  reference: ResolvedReferenceTarget<ReferenceMelodyTraits> | undefined,
  songHasEstablishedMotif: boolean,
): number {
  if (!reference) return 0
  return reference.strength * (songHasEstablishedMotif ? .35 : 1)
}

/**
 * 既存の旋律生成パラメータを、参考曲の傾向へ少しだけ寄せる(最大で半分の距離まで)。
 * 新しい生成器は作らず、余白・シンコペーション・動機の反復・音数・頂点の置き方の重みだけを動かす。
 */
export function applyMelodyReferenceToParams(
  params: GenerationParams,
  reference: ResolvedReferenceTarget<ReferenceMelodyTraits> | undefined,
): GenerationParams {
  if (!reference || reference.strength <= 0) return params
  const { traits, strength } = reference
  const pull = (current: number, target: number) => current + (target - current) * strength * .5
  const densityTarget = Math.max(.75, Math.min(1.3, 1 + (traits.noteDensity - .35) * .8))
  return {
    ...params,
    restRatioTarget: pull(params.restRatioTarget, traits.restDensity * .6),
    syncopationAmount: pull(params.syncopationAmount, traits.rhythmicIdentity * .7),
    motifRepeatTarget: pull(params.motifRepeatTarget, .2 + traits.repetition * .7),
    densityNoteMultiplier: pull(params.densityNoteMultiplier, densityTarget),
    climaxBias: strength >= .35
      ? traits.climaxTiming < .4 ? "early" : traits.climaxTiming > .85 ? "end" : "late"
      : params.climaxBias,
  }
}
