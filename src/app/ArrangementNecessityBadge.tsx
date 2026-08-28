import { ShieldCheck, Sparkles } from "lucide-react"
import type { ArrangementNecessity } from "@/core/arrangementSurprise"

export function ArrangementNecessityBadge({
  necessity,
}: {
  necessity: ArrangementNecessity | undefined
}) {
  if (!necessity) return null
  const surprise = necessity.approach === "surprise-tension"
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
        {surprise ? "Surprise / Tension" : "Safe"}
        <span className="ml-auto font-normal opacity-75">
          必然性 {necessity.score}
        </span>
      </div>
      <p className="mt-1">{necessity.reason}</p>
      {necessity.resolution && (
        <p className="mt-1 opacity-75">回収：{necessity.resolution}</p>
      )}
    </div>
  )
}
