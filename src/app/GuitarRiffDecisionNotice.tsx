import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { guitarRiffDecision, type GuitarRiffOmissionReason } from "@/melody-engine/guitarRiffDecision"

const REASONS: Record<GuitarRiffOmissionReason, string> = {
  boundary: "他のパートとの重なりを避けるため、リフを休ませました。",
  "short-phrase": "リフを十分に繰り返せる長さが残らず、元の伴奏を維持しました。",
  balance: "主旋律や他のパートとのバランスを優先し、元の伴奏を採用しました。",
}

export function GuitarRiffDecisionNotice({ project, arrangement }: { project: ComposerProject; arrangement: FullSongArrangement }) {
  const decision = guitarRiffDecision(arrangement)
  if (!decision) return null
  const groups = new Map<GuitarRiffOmissionReason, string[]>()
  for (const section of project.sections) {
    const reason = decision.omissions.find((item) => item.sectionId === section.id)?.reason
    if (!reason) continue
    const names = groups.get(reason) ?? []
    names.push(section.name)
    groups.set(reason, names)
  }
  const overall = decision.overall === "instruction"
    ? "指定した音作りを優先し、自動のギターリフは加えていません。"
    : decision.overall === "no-candidate" ? "条件に合うギターリフが見つからず、元の伴奏を維持しました。" : null
  if (!overall && groups.size === 0) return null
  return <div className="mt-2 min-w-0 space-y-1 break-words text-[12px] leading-5 text-body-muted" aria-label="ギターリフの配置について">
    {overall && <p>{overall}</p>}
    {[...groups].map(([reason, names]) => <p key={reason}>
      {names.slice(0, 2).join("・")}{names.length > 2 ? `ほか${names.length - 2}区間` : ""}：{REASONS[reason]}
    </p>)}
  </div>
}
