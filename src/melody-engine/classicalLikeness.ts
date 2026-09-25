import type { MelodyCraftMetrics } from "./melodyCraftMetrics"

/**
 * 古典らしさ(0〜100)。古典の旋律(Bach のコラール、古典派・ロマン派の最上声部)を 100 とする物差し。
 *
 * 旋律の「エッセンス」にあたる音の動き・和声との関係だけを見る(リズムの細かさ・音域・音数は
 * ジャンルや歌い手の音域で決まるので入れない)。物差しごとに、古典の旋律の分布(なめらかにした度数分布)を持ち、
 * その値が古典の中でどれだけ「ふつう」か(分布の高さ)で 0〜1 を付けて重み付き平均する。
 * 学習に使っていない古典の旋律のうち、真ん中の旋律がちょうど 100 になるように目盛りを合わせてある。
 * 作り方は melodyReference.calibration.test.ts。
 */

export type ClassicalFeatureKey =
  | "stepwise"
  | "leapRate"
  | "meanAbsInterval"
  | "repeatedPitch"
  | "leapRecovery"
  | "top3Share"
  | "directionChangeRate"
  | "skeletonSmoothness"
  | "strongBeatChordTone"
  | "parallelPerfectRate"

export const CLASSICAL_FEATURES: Array<{ key: ClassicalFeatureKey; label: string; weight: number; minimumBandwidth: number }> = [
  { key: "stepwise", label: "隣の音へ1〜2半音で動く割合", weight: 1.5, minimumBandwidth: 0.02 },
  { key: "leapRate", label: "5半音以上の跳躍の割合", weight: 1.5, minimumBandwidth: 0.015 },
  { key: "meanAbsInterval", label: "音程の大きさの平均(半音)", weight: 1, minimumBandwidth: 0.15 },
  { key: "repeatedPitch", label: "同じ音の連打の割合", weight: 1, minimumBandwidth: 0.02 },
  { key: "leapRecovery", label: "跳躍の後に逆向きへ戻る割合", weight: 0.8, minimumBandwidth: 0.05 },
  { key: "top3Share", label: "よく使う3音が占める割合", weight: 1, minimumBandwidth: 0.02 },
  { key: "directionChangeRate", label: "上下の向きが変わる割合", weight: 1, minimumBandwidth: 0.02 },
  { key: "skeletonSmoothness", label: "小節の頭の音どうしのつながり", weight: 0.6, minimumBandwidth: 0.05 },
  { key: "strongBeatChordTone", label: "拍の頭がコードの音である割合", weight: 1.2, minimumBandwidth: 0.02 },
  { key: "parallelPerfectRate", label: "ベースとの平行5度・8度の割合", weight: 0.6, minimumBandwidth: 0.02 },
]

export interface ClassicalFeatureModel {
  label: string
  weight: number
  /** 分布を持つ範囲と、その間を等分した点での分布の高さ */
  low: number
  high: number
  density: number[]
  /** 古典の旋律での分布の高さの中央値。これ以上なら「ふつう」として 1 */
  reference: number
  /** 古典の旋律での値の中央値(説明用) */
  median: number
}

export interface ClassicalModel {
  source: string
  corpora: string[]
  /** 群ごとの単位数と曲数(4つの群は同じ重みで学ぶ) */
  groups?: Record<string, { units: number; pieces: number }>
  units: { fit: number; holdout: number }
  features: Record<ClassicalFeatureKey, ClassicalFeatureModel>
  /** 学習に使っていない古典の旋律の、重み付き平均の中央値。これで割って 100 にそろえる */
  normalization: number
  /** 学習に使っていない古典の旋律の古典らしさの分布 */
  holdout: { p10: number; p25: number; p50: number; p75: number; p90: number }
}

export function classicalFeatureValues(metrics: MelodyCraftMetrics): Record<ClassicalFeatureKey, number> {
  return {
    stepwise: metrics.stepwise,
    leapRate: metrics.leapRate,
    meanAbsInterval: metrics.meanAbsInterval,
    repeatedPitch: metrics.repeatedPitch,
    leapRecovery: metrics.leapRecovery,
    top3Share: metrics.top3Share,
    directionChangeRate: metrics.directionChangeRate,
    skeletonSmoothness: metrics.skeletonSmoothness,
    strongBeatChordTone: metrics.strongBeatChordTone,
    parallelPerfectRate: metrics.parallelPerfectRate,
  }
}

export function densityAt(model: ClassicalFeatureModel, value: number): number {
  const steps = model.density.length - 1
  const position = ((value - model.low) / (model.high - model.low)) * steps
  if (position < 0 || position > steps) return 0
  const lower = Math.floor(position)
  const upper = Math.min(steps, lower + 1)
  return model.density[lower] + (model.density[upper] - model.density[lower]) * (position - lower)
}

export interface ClassicalLikenessItem {
  key: ClassicalFeatureKey
  label: string
  value: number
  classicalMedian: number
  /** 古典の中でのふつうさ(0〜1) */
  typicality: number
}

/** 重み付き平均(目盛りを合わせる前) */
export function rawClassicalTypicality(values: Record<ClassicalFeatureKey, number>, model: ClassicalModel): { raw: number; items: ClassicalLikenessItem[] } {
  let weighted = 0
  let total = 0
  const items: ClassicalLikenessItem[] = []
  for (const feature of CLASSICAL_FEATURES) {
    const featureModel = model.features[feature.key]
    if (!featureModel) continue
    const typicality = Math.min(1, densityAt(featureModel, values[feature.key]) / Math.max(1e-9, featureModel.reference))
    items.push({ key: feature.key, label: feature.label, value: values[feature.key], classicalMedian: featureModel.median, typicality })
    weighted += typicality * featureModel.weight
    total += featureModel.weight
  }
  return { raw: total > 0 ? weighted / total : 0, items }
}

/** 1つずつの物差しだけで見た古典らしさ(0〜100)。学習に使っていない古典の旋律の真ん中が 100 */
export function marginalClassicalLikeness(metrics: MelodyCraftMetrics, model: ClassicalModel): { score: number; items: ClassicalLikenessItem[] } {
  const { raw, items } = rawClassicalTypicality(classicalFeatureValues(metrics), model)
  return { score: Math.min(100, (raw / model.normalization) * 100), items }
}

/**
 * 物差しの組み合わせ(同時分布)。古典の旋律の10個の物差しの組をガウス混合で表したもの。
 * tools/melody-reference/fit_joint_model.py で作る。
 */
export interface ClassicalJointModel {
  features: ClassicalFeatureKey[]
  mean: number[]
  scale: number[]
  components: Array<{ weight: number; mean: number[]; precisionCholesky: number[][] }>
  /** 学習に使っていない古典の旋律の対数密度の 0〜100 パーセンタイル(101点) */
  holdoutLogDensityQuantiles: number[]
}

export interface ClassicalModels {
  /** 1つずつの物差しの分布(内訳の説明に使う) */
  marginal: ClassicalModel
  /** 物差しの組み合わせの分布(点数に使う) */
  joint: ClassicalJointModel
}

export function jointLogDensity(values: Record<ClassicalFeatureKey, number>, joint: ClassicalJointModel): number {
  const z = joint.features.map((key, index) => (values[key] - joint.mean[index]) / joint.scale[index])
  const dimension = z.length
  const logs = joint.components.map((component) => {
    let squared = 0
    let logDeterminant = 0
    for (let column = 0; column < dimension; column += 1) {
      let y = 0
      for (let row = 0; row <= column; row += 1) y += (z[row] - component.mean[row]) * component.precisionCholesky[row][column]
      squared += y * y
      logDeterminant += Math.log(component.precisionCholesky[column][column])
    }
    return Math.log(component.weight) - 0.5 * (dimension * Math.log(2 * Math.PI) + squared) + logDeterminant
  })
  const top = Math.max(...logs)
  return top + Math.log(logs.reduce((sum, value) => sum + Math.exp(value - top), 0))
}

/** 対数密度が、学習に使っていない古典の旋律の中で下から何割の位置か(0〜1) */
export function jointPercentile(logDensity: number, joint: ClassicalJointModel): number {
  const quantiles = joint.holdoutLogDensityQuantiles
  if (logDensity <= quantiles[0]) return 0
  if (logDensity >= quantiles[quantiles.length - 1]) return 1
  let index = 0
  while (index + 1 < quantiles.length && quantiles[index + 1] < logDensity) index += 1
  const span = quantiles[index + 1] - quantiles[index]
  return (index + (span > 0 ? (logDensity - quantiles[index]) / span : 0)) / (quantiles.length - 1)
}

/**
 * 古典らしさ(0〜100)。物差しの組み合わせとして古典の旋律の中でどれだけ「ふつう」かを見る。
 * 学習に使っていない古典の旋律の真ん中が 100(それより典型的な旋律も 100)、古典の下位1割に当たる旋律は 20。
 * 内訳(items)は、1つずつの物差しで見た古典の中でのふつうさ。
 */
export function classicalLikeness(metrics: MelodyCraftMetrics, models: ClassicalModels): { score: number; items: ClassicalLikenessItem[] } {
  const values = classicalFeatureValues(metrics)
  const { items } = rawClassicalTypicality(values, models.marginal)
  const percentile = jointPercentile(jointLogDensity(values, models.joint), models.joint)
  return { score: Math.min(100, percentile * 200), items }
}

/** 重み付きのデータから、なめらかにした度数分布(ガウスの山を重ねたもの)を作る */
export function buildFeatureModel(
  samples: Array<{ value: number; weight: number }>,
  feature: { label: string; weight: number; minimumBandwidth: number },
  points = 81,
): ClassicalFeatureModel {
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0)
  const mean = samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / totalWeight
  const variance = samples.reduce((sum, sample) => sum + sample.weight * (sample.value - mean) ** 2, 0) / totalWeight
  const bandwidth = Math.max(feature.minimumBandwidth, 1.06 * Math.sqrt(variance) * samples.length ** -0.2)
  const values = samples.map((sample) => sample.value)
  const low = Math.min(...values) - 3 * bandwidth
  const high = Math.max(...values) + 3 * bandwidth
  const density = Array.from({ length: points }, (_, index) => {
    const x = low + ((high - low) * index) / (points - 1)
    return samples.reduce((sum, sample) => sum + sample.weight * Math.exp(-0.5 * ((x - sample.value) / bandwidth) ** 2), 0) / (totalWeight * bandwidth * Math.sqrt(2 * Math.PI))
  })
  const model: ClassicalFeatureModel = { label: feature.label, weight: feature.weight, low, high, density, reference: 0, median: 0 }
  model.reference = weightedMedian(samples.map((sample) => ({ value: densityAt(model, sample.value), weight: sample.weight })))
  model.median = weightedMedian(samples)
  return model
}

export function weightedMedian(samples: Array<{ value: number; weight: number }>, quantile = 0.5): number {
  const sorted = [...samples].sort((a, b) => a.value - b.value)
  const total = sorted.reduce((sum, sample) => sum + sample.weight, 0)
  let accumulated = 0
  for (const sample of sorted) {
    accumulated += sample.weight
    if (accumulated >= total * quantile) return sample.value
  }
  return sorted.at(-1)?.value ?? 0
}
