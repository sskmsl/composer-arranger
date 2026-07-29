import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { emptyWorkspace } from "./core.mjs"
import {
  loadJson,
  loadWorkspace,
  saveJson,
  saveWorkspace,
} from "./storage.mjs"

describe("Analysis Workspace storage", () => {
  it("returns an empty workspace for a new private data path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analysis-workspace-"))
    expect(await loadWorkspace(join(directory, "workspace.json"))).toEqual(
      emptyWorkspace(),
    )
  })

  it("atomically saves valid JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analysis-workspace-"))
    const path = join(directory, "nested", "workspace.json")
    await saveWorkspace(path, emptyWorkspace())
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(emptyWorkspace())
  })

  it("atomically saves and loads private Pipeline JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analysis-pipeline-"))
    const path = join(directory, "pipeline.json")
    const value = { schemaVersion: 1, status: "draft" }
    await saveJson(path, value)
    expect(await loadJson(path)).toEqual(value)
  })
})
