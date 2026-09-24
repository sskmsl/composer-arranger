import { ShieldCheck, Sparkles } from "lucide-react"
import type { ArrangementNecessity } from "@/core/arrangementSurprise"

export function ArrangementNecessityBadge({
  necessity,
  compact = false,
}: {
  necessity: ArrangementNecessity | undefined
  /** 1行の印として出す(理由はカーソルを合わせると出る) */
  compact?: boolean
}) {
  if (!necessity) return null
  const surprise = necessity.approach === "surprise-tension"
  if (compact) {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
          surprise
            ? "border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-100"
            : "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100"
        }`}
        title={necessity.reason}
      >
        {surprise ? <Sparkles size={11} /> : <ShieldCheck size={11} />}
        {surprise ? "意外性" : "安定"} · 必然性 {necessity.score}
      </span>
    )
  }
  return (
    <div
      className={`mt-2 rounded-sm border px-2.5 py-2 text-[11px] leading-4 ${
        surprise
          ? "border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-100"
          : "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100"
      }`}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {surprise ? <Sparkles size={12} /> : <ShieldCheck size={12} />}
        {surprise ? "意外性で引きつける" : "安定"}
        <span className="ml-auto font-normal opacity-75">
          必然性 {necessity.score}
        </span>
      </div>
      <p className="mt-1">{necessity.reason}</p>
    </div>
  )
}
