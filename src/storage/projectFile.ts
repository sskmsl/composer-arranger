import type { ComposerProject } from "@/core/project"

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

/**
 * 生のJSONをそのまま返す(正規化・時間単位移行はしない)。
 * これらはstore.loadProject側でIndexedDB復元と同じ唯一の移行経路(resolveProjectTiming)を
 * 通すため、ここで先に正規化してしまうと移行判定に必要な生データが失われる(Issue #16)。
 */
export async function readProjectFile(file: File): Promise<unknown> {
  const text = await file.text()
  return JSON.parse(text)
}
