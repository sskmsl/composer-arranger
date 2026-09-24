import type { ComposerProject } from "@/core/project"
import type { MainTab } from "./App"

export function homeContinueAction(project: ComposerProject): { tab: MainTab; label: string } {
  if (project.fullSongArrangement) return { tab: "arrangement", label: "アレンジを続ける" }
  if ((project.arrangementChat?.messages.length ?? 0) > 0) return { tab: "arrangement", label: "アレンジ相談を続ける" }
  const hasMusicalInput = project.sourceImport?.type === "midi" || project.chords.length > 0 || project.melodyVariants.length > 0
  if (hasMusicalInput) return { tab: "arrangement", label: "全曲をアレンジする" }
  return { tab: "melody", label: "曲を編集する" }
}
