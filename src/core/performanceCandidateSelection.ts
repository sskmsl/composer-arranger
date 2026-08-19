import type { PerformanceCandidateReview } from "./performanceExecution"

export interface PerformanceCandidateSelectionInput {
  candidateId: string
  qualityScore: number
  review: PerformanceCandidateReview
}

export interface PerformanceBatchRecommendation {
  batchId: string
  candidateId: string | null
  compositeScore: number
  status: "recommended" | "needs-review"
  reason: string
  consideredCandidateIds: string[]
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/**
 * 既存Generatorの音楽品質を尊重しつつ、演奏安全性を採用判断へ加える。
 * Reviseしかない場合は無理に推奨せず、人間の確認へ戻す。
 */
export function recommendPerformedCandidate(
  batchId: string,
  inputs: PerformanceCandidateSelectionInput[],
): PerformanceBatchRecommendation {
  const consideredCandidateIds = inputs.map((input) => input.candidateId)
  const safe = inputs.filter((input) => input.review.status !== "revise")
  if (safe.length === 0) {
    return {
      batchId,
      candidateId: null,
      compositeScore: 0,
      status: "needs-review",
      reason: "演奏安全性を満たす候補がないため、Director推奨を保留しました。",
      consideredCandidateIds,
    }
  }

  const ranked = safe
    .map((input) => ({
      ...input,
      compositeScore:
        clampScore(input.qualityScore) * 0.6 +
        clampScore(input.review.score) * 0.4,
    }))
    .sort(
      (left, right) =>
        right.compositeScore - left.compositeScore ||
        right.review.score - left.review.score ||
        right.qualityScore - left.qualityScore ||
        left.candidateId.localeCompare(right.candidateId),
    )
  const selected = ranked[0]
  return {
    batchId,
    candidateId: selected.candidateId,
    compositeScore: Math.round(selected.compositeScore),
    status: "recommended",
    reason:
      selected.review.status === "strong"
        ? "既存の音楽品質を保ち、Performance安全条件も満たすためDirector推奨としました。"
        : "重大な問題がなく、音楽品質とのバランスが最も高いため比較試聴の第一候補としました。",
    consideredCandidateIds,
  }
}
