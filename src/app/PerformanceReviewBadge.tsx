import type { PerformanceCandidateReview } from "@/core/performanceExecution"
import type { PerformanceBatchRecommendation } from "@/core/performanceCandidateSelection"

const CLASSES: Record<PerformanceCandidateReview["status"], string> = {
  strong: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  watch: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  revise: "border-red-400/35 bg-red-400/10 text-red-200",
}

/** 自動採用はせず、試聴前の安全確認で気になる点がある時だけ、候補の上へ印を出す(点数は出さない)。 */
export function PerformanceReviewBadge({
  review,
}: {
  review: PerformanceCandidateReview | undefined
}) {
  if (!review || review.status === "strong") return null
  const details = [review.summary, ...review.findings].join("\n")
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[12px] font-medium ${CLASSES[review.status]}`}
      title={details}
    >
      {review.status === "revise" ? "演奏上の注意あり" : "演奏上の確認あり"}
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
      className="inline-flex shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary-on-dark"
      title={recommendation.reason}
    >
      おすすめ
    </span>
  )
}
