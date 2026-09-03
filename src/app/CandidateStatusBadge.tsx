export type CandidateStatus = "not-created" | "candidate" | "auditioning" | "selected" | "applied"

const LABELS: Record<CandidateStatus, string> = {
  "not-created": "未生成",
  candidate: "候補あり",
  auditioning: "試聴中",
  selected: "採用済み",
  applied: "全曲へ反映済み",
}

const CLASSES: Record<CandidateStatus, string> = {
  "not-created": "bg-white/7 text-body-muted",
  candidate: "bg-primary/12 text-primary-on-dark",
  auditioning: "bg-amber-300/12 text-amber-100",
  selected: "bg-emerald-400/12 text-emerald-100",
  applied: "bg-cyan-300/12 text-cyan-100",
}

export function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  return (
    <span className={`shrink-0 rounded-pill px-2.5 py-1 text-[11px] ${CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  )
}
