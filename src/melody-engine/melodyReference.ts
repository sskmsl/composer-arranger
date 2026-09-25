import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import type { MelodyCraftMetrics } from "./melodyCraftMetrics"

/**
 * 実在曲(music21 同梱のパブリックドメイン楽譜)を、アプリと同じ物差しで測った値の集計。
 * tools/melody-reference/extract_corpus.py で旋律と拍ごとの和音を取り出し、
 * melodyReference.calibration.test.ts で measureMelodyCraft をかけて作る。
 */

/** 1つの物差しの分布(10・25・50・75・90パーセンタイルと平均) */
export interface MetricDistribution {
  count: number
  mean: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export type ReferenceMetricKey =
  | "repeatedPitch"
  | "stepwise"
  | "leapRate"
  | "leapRecovery"
  | "distinctPitches"
  | "top3Share"
  | "range"
  | "notesPerBeat"
  | "outOfScale"
  | "skeletonSmoothness"
  | "antecedentOpen"
  | "strongBeatChordTone"
  | "parallelPerfectRate"
  | "leadingToneResolution"
  | "seventhResolution"
  | "sighsPerUnit"
  | "endsOnTonic"
  | "endsOnChordTone"

export interface ReferenceCorpusStats {
  label: string
  description: string
  pieces: number
  units: number
  metrics: Partial<Record<ReferenceMetricKey, MetricDistribution>>
}

export interface MelodyReferenceStats {
  source: string
  unitBeats: number
  corpora: Record<string, ReferenceCorpusStats>
}

/** 実在曲の1単位(4/4で8小節)。extract_corpus.py の出力1行 */
export interface ReferenceUnit {
  corpus: string
  piece: string
  unit: number
  key: string
  final: boolean
  totalBeats: number
  notes: Array<[startBeat: number, durationBeats: number, pitch: number]>
  chords: Array<[startBeat: number, durationBeats: number, symbol: string, bass: string | null]>
}

export function referenceUnitToMelody(unit: ReferenceUnit): { notes: MelodyNote[]; chords: ChordEvent[] } {
  return {
    notes: unit.notes.map(([startBeat, durationBeats, pitch], index) => ({
      id: `r${index}`, startBeat, durationBeats, pitch, velocity: 90, locks: [],
    })),
    chords: unit.chords.map(([startBeat, durationBeats, symbol, bass], index) => ({
      id: `c${index}`, sectionId: "ref", startBeat, durationBeats, symbol, bass,
    })),
  }
}

/** 物差しの値を集計用に取り出す(和音が要る物差しは、和音のある単位だけ。終わり方は曲の最後の単位だけ) */
export function referenceMetricValues(
  metrics: MelodyCraftMetrics,
  context: { hasChords: boolean; final: boolean; totalBeats: number },
): Partial<Record<ReferenceMetricKey, number>> {
  const values: Partial<Record<ReferenceMetricKey, number>> = {
    repeatedPitch: metrics.repeatedPitch,
    stepwise: metrics.stepwise,
    leapRate: metrics.leapRate,
    leapRecovery: metrics.leapRecovery,
    distinctPitches: metrics.distinctPitches,
    top3Share: metrics.top3Share,
    range: metrics.range,
    notesPerBeat: metrics.noteCount / Math.max(1, context.totalBeats),
    outOfScale: metrics.outOfScale,
    skeletonSmoothness: metrics.skeletonSmoothness,
    antecedentOpen: metrics.antecedentOpen ? 1 : 0,
  }
  if (context.hasChords) {
    values.strongBeatChordTone = metrics.strongBeatChordTone
    values.parallelPerfectRate = metrics.parallelPerfectRate
    values.sighsPerUnit = metrics.sighCount
    if (metrics.leadingToneCases > 0) values.leadingToneResolution = metrics.leadingToneResolution
    if (metrics.seventhCases > 0) values.seventhResolution = metrics.seventhResolution
  }
  if (context.final) {
    values.endsOnTonic = metrics.endsOnTonic ? 1 : 0
    if (context.hasChords) values.endsOnChordTone = metrics.endsOnChordTone ? 1 : 0
  }
  return values
}

export function distributionOf(values: number[]): MetricDistribution {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => {
    if (sorted.length === 0) return 0
    const position = (sorted.length - 1) * q
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
  }
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)),
    p10: round(at(0.1)),
    p25: round(at(0.25)),
    p50: round(at(0.5)),
    p75: round(at(0.75)),
    p90: round(at(0.9)),
  }
}

/** 実在曲の分布(p25〜p75)に入っていれば1、外れるほど下がる点数(p10・p90で0.5、その外で0へ) */
export function bandScore(value: number, distribution: MetricDistribution, minimumWidth: number): number {
  const { p10, p25, p75, p90 } = distribution
  if (value >= p25 && value <= p75) return 1
  if (value > p75) {
    const width = Math.max(minimumWidth, p90 - p75)
    const over = value - p75
    return over <= width ? 1 - 0.5 * (over / width) : Math.max(0, 0.5 - 0.5 * ((over - width) / width))
  }
  const width = Math.max(minimumWidth, p25 - p10)
  const under = p25 - value
  return under <= width ? 1 - 0.5 * (under / width) : Math.max(0, 0.5 - 0.5 * ((under - width) / width))
}

/** 物差しごとに、どの曲集の分布をお手本にするか(旋律だけで測れるものは民謡、和音が要るものはコラール) */
export const REFERENCE_TARGETS: Array<{
  key: ReferenceMetricKey
  corpus: "essen" | "bach"
  weight: number
  /** 分布の幅がとても狭いときの最小の幅 */
  minimumWidth: number
  label: string
}> = [
  { key: "stepwise", corpus: "essen", weight: 1.5, minimumWidth: 0.05, label: "隣の音へ1〜2半音で動く割合" },
  { key: "leapRate", corpus: "essen", weight: 1.5, minimumWidth: 0.04, label: "5半音以上の跳躍の割合" },
  { key: "repeatedPitch", corpus: "essen", weight: 1, minimumWidth: 0.05, label: "同じ音の連打の割合" },
  { key: "top3Share", corpus: "essen", weight: 1, minimumWidth: 0.05, label: "よく使う3音が占める割合" },
  { key: "distinctPitches", corpus: "essen", weight: 0.8, minimumWidth: 1, label: "使う音の種類" },
  { key: "range", corpus: "essen", weight: 0.6, minimumWidth: 2, label: "音域(半音)" },
  { key: "leapRecovery", corpus: "essen", weight: 0.8, minimumWidth: 0.1, label: "跳躍の後に逆向きへ戻る割合" },
  { key: "skeletonSmoothness", corpus: "essen", weight: 0.6, minimumWidth: 0.1, label: "小節の頭の音どうしのつながり" },
  { key: "strongBeatChordTone", corpus: "bach", weight: 1, minimumWidth: 0.05, label: "拍の頭がコードの音である割合" },
  { key: "parallelPerfectRate", corpus: "bach", weight: 0.6, minimumWidth: 0.05, label: "ベースとの平行5度・8度の割合" },
]

export interface ReferenceScoreItem {
  key: ReferenceMetricKey
  label: string
  value: number
  /** お手本にした曲集の、多くの曲が収まる範囲(p25〜p75) */
  band: [number, number]
  corpus: string
  score: number
}

/**
 * 実在曲の分布を根拠にした「作りの良さ」(0〜100)と、その内訳。
 * 各物差しが、お手本の曲集で多くの曲が収まる範囲(p25〜p75)に入っているかで点を付ける。
 * resolving(サビ・アウトロ)は主音で終わるか、16拍以上は前半を主音で閉じないか、属七の7度が下がるか、も加える。
 */
export function scoreAgainstReference(
  metrics: MelodyCraftMetrics,
  stats: MelodyReferenceStats,
  options: { resolving: boolean; totalBeats: number },
): { score: number; items: ReferenceScoreItem[] } {
  const values = referenceMetricValues(metrics, { hasChords: true, final: true, totalBeats: options.totalBeats })
  const items: ReferenceScoreItem[] = []
  let weighted = 0
  let total = 0
  for (const target of REFERENCE_TARGETS) {
    const distribution = stats.corpora[target.corpus]?.metrics[target.key]
    const value = values[target.key]
    if (!distribution || value === undefined) continue
    const score = bandScore(value, distribution, target.minimumWidth)
    items.push({ key: target.key, label: target.label, value, band: [distribution.p25, distribution.p75], corpus: stats.corpora[target.corpus].label, score })
    weighted += score * target.weight
    total += target.weight
  }
  // 終わり方・問いと答え・属七の7度は、実在曲ではほぼ例外なく満たされる(p25=1)ので、満たすかどうかで数える
  const binary: Array<[ReferenceMetricKey, number | undefined, number, string, string]> = [
    ["antecedentOpen", options.totalBeats >= 16 ? values.antecedentOpen : undefined, 0.4, "前半を主音で閉じない", "essen"],
    ["endsOnTonic", options.resolving ? values.endsOnTonic : undefined, 0.8, "主音で終わる", "bach"],
    ["seventhResolution", metrics.seventhCases > 0 ? metrics.seventhResolution : undefined, 0.4, "属七の7度が下がって解決する", "bach"],
  ]
  for (const [key, value, weight, label, corpus] of binary) {
    const distribution = stats.corpora[corpus]?.metrics[key]
    if (value === undefined || !distribution) continue
    items.push({ key, label, value, band: [distribution.p25, distribution.p75], corpus: stats.corpora[corpus].label, score: value })
    weighted += value * weight
    total += weight
  }
  return { score: total > 0 ? (weighted / total) * 100 : 0, items }
}
