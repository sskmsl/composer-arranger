import type { ComposerProject } from "@/core/project"
import type { MainTab } from "./App"

export function homeContinueAction(project: ComposerProject): { tab: MainTab; label: string } {
  if (project.fullSongArrangement) return { tab: "arrangement", label: "生成結果を開く" }
  const hasAiConsultation = Object.values(project.aiPartnerSessions ?? {}).some((session) => session.latestResponse)
  if (hasAiConsultation) return { tab: "ai-partner", label: "AI相談を続ける" }
  const hasMusicalInput = project.sourceImport?.type === "midi" || project.chords.length > 0 || project.melodyVariants.length > 0
  if (hasMusicalInput) return { tab: "ai-partner", label: "AIにおまかせする" }
  return { tab: "melody", label: "曲を編集する" }
}
