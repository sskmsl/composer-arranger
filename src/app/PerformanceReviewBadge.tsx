import type { PerformanceCandidateReview } from "@/core/performanceExecution"
import type { PerformanceBatchRecommendation } from "@/core/performanceCandidateSelection"

const LABELS: Record<PerformanceCandidateReview["status"], string> = {
  strong: "演奏適合 Strong",
  watch: "演奏適合 Watch",
  revise: "演奏適合 Revise",
}

const CLASSES: Record<PerformanceCandidateReview["status"], string> = {
  strong: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  watch: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  revise: "border-red-400/35 bg-red-400/10 text-red-200",
}

/** 自動採用はせず、試聴前の安全確認結果だけを候補上へ表示する。 */
export function PerformanceReviewBadge({
  review,
  compact = false,
}: {
  review: PerformanceCandidateReview | undefined
  compact?: boolean
}) {
  if (!review) return null
  const details = [review.summary, ...review.findings].join("\n")
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLASSES[review.status]}`}
      title={details}
    >
      {compact ? review.status.toUpperCase() : LABELS[review.status]} · {review.score}
    </span>
  )
}

export function DirectorRecommendationBadge({
  recommendation,
  candidateId,
}: {
  recommendation: PerformanceBatchRecommendation | undefined
  candidateId: string
}) {
  if (recommendation?.candidateId !== candidateId) return null
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-on-dark"
      title={recommendation.reason}
    >
      Director推奨 · {recommendation.compositeScore}
    </span>
  )
}
