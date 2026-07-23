import { normalizeProject, type ComposerProject } from "@/core/project"

/** Composer Project(JSON)をファイルとして書き出す。Chord Generator側との受け渡し形式(14章)。 */
export function downloadProjectFile(project: ComposerProject): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${project.title || "composer-project"}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function readProjectFile(file: File): Promise<ComposerProject> {
  const text = await file.text()
  const raw = JSON.parse(text)
  return normalizeProject(raw)
}
