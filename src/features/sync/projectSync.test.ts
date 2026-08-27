import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import {
  mergeProjectCollections,
  isTransientCloudSyncError,
  projectIdsNeedingDownload,
  projectsNeedingUpload,
  reconcileProjectRows,
  retryTransientCloudOperation,
  shouldResetLocalForOwner,
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

  it("送信待ちのローカル削除もCloudから復活させない", () => {
    const remote = stored("Pending deletion", "2026-08-12T01:00:00.000Z")
    expect(
      reconcileProjectRows(
        [],
        [{ id: remote.projectId, data: remote, deleted_at: null }],
        [remote.projectId],
      ),
    ).toEqual([])
  })

  it("別accountへ切り替えた場合だけローカルprojectを隔離する", () => {
    expect(shouldResetLocalForOwner(null, "owner-a")).toBe(false)
    expect(shouldResetLocalForOwner("owner-a", "owner-a")).toBe(false)
    expect(shouldResetLocalForOwner("owner-a", "owner-b")).toBe(true)
  })

  it("Cloudと同じ保存状態のprojectをログイン時に再送しない", () => {
    const project = stored("Already synced", "2026-08-12T01:00:00.000Z")
    expect(
      projectsNeedingUpload([project], [
        { id: project.projectId, data: project, deleted_at: null },
      ]),
    ).toEqual([])
  })

  it("data未取得のmetadataだけでも同じ保存状態を再送しない", () => {
    const project = stored("Metadata only", "2026-08-12T01:00:00.000Z")
    expect(
      projectsNeedingUpload([project], [
        {
          id: project.projectId,
          data: null,
          updated_at: project.savedAt,
          deleted_at: null,
        },
      ]),
    ).toEqual([])
  })

  it("Cloudより新しいローカルprojectだけを送信対象にする", () => {
    const id = crypto.randomUUID()
    const remote = stored("Remote", "2026-08-12T01:00:00.000Z", id)
    const local = stored("Local", "2026-08-12T02:00:00.000Z", id)
    expect(
      projectsNeedingUpload([local], [
        { id, data: remote, deleted_at: null },
      ]),
    ).toEqual([local])
  })

  it("端末にないprojectとCloud側が新しいprojectだけを本体取得対象にする", () => {
    const same = stored("Same", "2026-08-12T01:00:00.000Z")
    const remoteNewer = stored("Remote newer", "2026-08-12T01:00:00.000Z")
    const localOnly = stored("Cloud missing", "2026-08-12T02:00:00.000Z")
    const cloudOnlyId = crypto.randomUUID()

    expect(
      projectIdsNeedingDownload(
        [same, remoteNewer, localOnly],
        [
          {
            id: same.projectId,
            updated_at: same.savedAt,
            deleted_at: null,
          },
          {
            id: remoteNewer.projectId,
            updated_at: "2026-08-12T03:00:00.000Z",
            deleted_at: null,
          },
          {
            id: cloudOnlyId,
            updated_at: "2026-08-12T04:00:00.000Z",
            deleted_at: null,
          },
        ],
      ),
    ).toEqual([remoteNewer.projectId, cloudOnlyId])
  })

  it("Cloud tombstoneと送信待ち削除は本体取得しない", () => {
    const pendingId = crypto.randomUUID()
    expect(
      projectIdsNeedingDownload(
        [],
        [
          {
            id: "deleted",
            updated_at: "2026-08-12T01:00:00.000Z",
            deleted_at: "2026-08-12T01:00:00.000Z",
          },
          {
            id: pendingId,
            updated_at: "2026-08-12T01:00:00.000Z",
            deleted_at: null,
          },
        ],
        [pendingId],
      ),
    ).toEqual([])
  })
})

describe("Composer Arranger cloud sync network retry", () => {
  it("ChromeのFailed to fetchを一時的な通信失敗として判定する", () => {
    expect(isTransientCloudSyncError(new TypeError("Failed to fetch"))).toBe(
      true,
    )
    expect(
      isTransientCloudSyncError({ message: "TypeError: Failed to fetch" }),
    ).toBe(true)
    expect(isTransientCloudSyncError({ message: "permission denied" })).toBe(
      false,
    )
  })

  it("一時的な失敗だけを短く再試行して成功する", async () => {
    let attempts = 0
    const waits: number[] = []

    const result = await retryTransientCloudOperation(
      async () => {
        attempts += 1
        if (attempts < 3) throw new TypeError("Failed to fetch")
        return "synced"
      },
      [250, 750],
      async (delayMs) => {
        waits.push(delayMs)
      },
    )

    expect(result).toBe("synced")
    expect(attempts).toBe(3)
    expect(waits).toEqual([250, 750])
  })

  it("権限エラーなど恒久的な失敗は再試行しない", async () => {
    let attempts = 0

    await expect(
      retryTransientCloudOperation(
        async () => {
          attempts += 1
          throw new Error("permission denied")
        },
        [250, 750],
        async () => undefined,
      ),
    ).rejects.toThrow("permission denied")
    expect(attempts).toBe(1)
  })
})
