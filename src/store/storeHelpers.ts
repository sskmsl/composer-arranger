import type { ComposerProject } from "@/core/project"

/** 取り消し(undo)用に、プロジェクトの深いコピーを取る */
export function snapshot(project: ComposerProject): ComposerProject {
  return JSON.parse(JSON.stringify(project))
}
