import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import {
  mergeProjectCollections,
  reconcileProjectRows,
  type StoredComposerProject,
} from "./projectSync"

function stored(
  title: string,
  savedAt: string,
  projectId = crypto.randomUUID(),
): StoredComposerProject {
  return {
    ...createEmptyProject(title),
    projectId,
    savedAt,
  }
}

describe("Composer Arranger cloud sync merge", () => {
  it("端末だけ・Cloudだけのprojectをどちらも保持する", () => {
    const local = stored("Local", "2026-08-10T00:00:00.000Z")
    const remote = stored("Remote", "2026-08-11T00:00:00.000Z")

    const merged = mergeProjectCollections([local], [remote])

    expect(merged.map((project) => project.title)).toEqual(["Remote", "Local"])
  })

  it("同一projectIdは更新日時が新しい側を採用する", () => {
    const id = crypto.randomUUID()
    const local = stored("Local newer", "2026-08-12T01:00:00.000Z", id)
    const remote = stored("Remote older", "2026-08-11T01:00:00.000Z", id)

    expect(mergeProjectCollections([local], [remote])).toEqual([local])
    expect(mergeProjectCollections([remote], [local])).toEqual([local])
  })

  it("同じ入力から常に同じ順序と内容を返す", () => {
    const first = stored("First", "2026-08-12T01:00:00.000Z")
    const second = stored("Second", "2026-08-12T02:00:00.000Z")

    expect(mergeProjectCollections([first], [second])).toEqual(
      mergeProjectCollections([first], [second]),
    )
  })

  it("Cloudで削除されたprojectを別端末の古いローカル状態から復活させない", () => {
    const local = stored("Deleted elsewhere", "2026-08-12T01:00:00.000Z")

    expect(
      reconcileProjectRows([local], [
        {
          id: local.projectId,
          data: null,
          deleted_at: "2026-08-12T02:00:00.000Z",
        },
      ]),
    ).toEqual([])
  })
})
