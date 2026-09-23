import type { MelodyFeatures, MelodyGeneratorProfile } from "@/core/melody"
import type { GenerationParams } from "./generationParams"

/** 9.6 Scoring: 内部評価のみに使用し、ユーザーへは総合点を出さない */
export function scoreCandidate(features: MelodyFeatures, params: GenerationParams, profile: MelodyGeneratorProfile = "standard", notesPerBeat?: number): number {
  const vocalArc = profile === "standard" || profile === "cinematic"
  const motifUnity = 25 * clamp01(features.motifRepeatRatio)

  const leapPenalty = clamp01(features.avgLeap / 9)
  const singability = 10 * (1 - leapPenalty * 0.7)

  // Issue #64: 跳躍後の反行・段階進行による回収度合いをボイスリーディングの評価に加える
  const voiceLeading = (vocalArc ? 15 : 10) * clamp01(features.leapRecoveryRatio)

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
  // 歌の候補では珍しい跳躍の量より、跳躍に行き先があることを重視する。
  const novelty = (vocalArc ? 5 : 10) * clamp01(varietyScore * (0.5 + params.noveltyWeight))

  const baseScore = motifUnity + singability + voiceLeading + tensionAndResolution + sectionFit + restAndBreath + novelty
  // 反復主体のスタイルを減点せず、識別できる核の再登場を補助加点する。
  // 100点までの余白の5%を上限にし、旧データは従来どおり評価する。
  // Minimalでは意図的な同音反復や余白を優先し、フックによる順位変更を行わない。
  if (profile === "minimal") return baseScore
  const hookBonus = (100 - baseScore) * 0.05 * clamp01(features.hookStrength ?? 0)
  // Standardの歌メロで大跳躍が頻発する案は、珍しさより口ずさみやすさを優先する。
  const roughLeapPenalty = profile === "standard"
    ? 20 * clamp01(((features.largeLeapRatio ?? 0) - 0.08) / 0.14)
    : profile === "cinematic"
      ? 9 * clamp01(((features.largeLeapRatio ?? 0) - 0.12) / 0.16)
    : 0
  const staticRunPenalty = profile === "standard"
    ? 4 * Math.min(5, Math.max(0, (features.longestPitchRun ?? 0) - 4))
    : 0
  // 反復を密度で埋める候補より、短い核の後に歌う余地がある候補を選ぶ。
  // 音数そのものは変更せず、同じ長さの候補間の順位にだけ使う。
  const densityPenalty = profile === "standard" && notesPerBeat !== undefined
    ? 10 * clamp01((notesPerBeat - 0.78) / 0.28)
    : 0
  return Math.max(0, baseScore + hookBonus - roughLeapPenalty - staticRunPenalty - densityPenalty)
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}
