import type { MelodyFeatures, MelodyGeneratorProfile } from "@/core/melody"
import type { GenerationParams } from "./generationParams"

/** 9.6 Scoring: 内部評価のみに使用し、ユーザーへは総合点を出さない */
export function scoreCandidate(features: MelodyFeatures, params: GenerationParams, profile: MelodyGeneratorProfile = "standard"): number {
  const motifUnity = 25 * clamp01(features.motifRepeatRatio)

  const leapPenalty = clamp01(features.avgLeap / 9)
  const singability = 10 * (1 - leapPenalty * 0.7)

  // Issue #64: 跳躍後の反行・段階進行による回収度合いをボイスリーディングの評価に加える
  const voiceLeading = 10 * clamp01(features.leapRecoveryRatio)

  const tensionFit = 1 - Math.min(1, Math.abs(features.tensionUsageRatio - params.tensionUsageTarget) / 0.4)
  const tensionAndResolution = 20 * clamp01(tensionFit)

  const restFit = 1 - Math.min(1, Math.abs(features.restRatio - params.restRatioTarget) / 0.4)
  const climaxFit =
    params.climaxBias === "early"
      ? 1 - features.peakPosition
      : params.climaxBias === "end"
        ? features.peakPosition
        : 1 - Math.abs(features.peakPosition - 0.6)
  const sectionFit = 15 * clamp01((restFit + climaxFit) / 2)

  const restAndBreath = 10 * clamp01(restFit)

  const varietyScore = clamp01((features.maxLeap - features.avgLeap) / 8 + features.tensionUsageRatio)
  const novelty = 10 * clamp01(varietyScore * (0.5 + params.noveltyWeight))

  const baseScore = motifUnity + singability + voiceLeading + tensionAndResolution + sectionFit + restAndBreath + novelty
  // 反復主体のスタイルを減点せず、識別できる核の再登場を補助加点する。
  // 100点までの余白の5%を上限にし、旧データは従来どおり評価する。
  // Minimalでは意図的な同音反復や余白を優先し、フックによる順位変更を行わない。
  if (profile === "minimal") return baseScore
  return baseScore + (100 - baseScore) * 0.05 * clamp01(features.hookStrength ?? 0)
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}
