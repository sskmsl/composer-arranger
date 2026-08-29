import { describe, expect, it } from "vitest"
import {
  decodeCloudProjectPayload,
  encodeCloudProjectPayload,
} from "./cloudProjectPayload"

describe("Cloud project payload", () => {
  it("小さいProjectは既存Cloudデータと同じJSON形式を維持する", async () => {
    const project = { projectId: "small", title: "Small", notes: [] }
    expect(await encodeCloudProjectPayload(project)).toBe(project)
    expect(await decodeCloudProjectPayload(project)).toBe(project)
  })

  it("大きいProjectを圧縮し、データを失わず復元する", async () => {
    const project = {
      projectId: "large",
      title: "Large",
      importedArrangement: {
        tracks: Array.from({ length: 8000 }, (_, index) => [
          index / 4,
          0.25,
          48 + (index % 24),
          80,
          0,
        ]),
      },
    }
    const encoded = await encodeCloudProjectPayload(project)
    expect(encoded).not.toBe(project)
    expect(JSON.stringify(encoded).length).toBeLessThan(
      JSON.stringify(project).length,
    )
    expect(await decodeCloudProjectPayload(encoded)).toEqual(project)
  })

  it("既存の非圧縮Cloud Projectもそのまま読める", async () => {
    const legacy = { projectId: "legacy", savedAt: "2026-08-29T00:00:00.000Z" }
    expect(await decodeCloudProjectPayload(legacy)).toEqual(legacy)
  })
})
