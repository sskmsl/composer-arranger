import { beforeEach, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
const storage = vi.hoisted(() => ({ saveProject: vi.fn(), loadLastOpenedProject: vi.fn(), loadProject: vi.fn() }))
vi.mock("@/storage/projectRepository", () => ({ ...storage,
  backupProjectTimingSnapshot: vi.fn(), duplicateProject: vi.fn(), renameProject: vi.fn(), deleteProject: vi.fn(),
}))
beforeEach(() => { vi.resetModules(); storage.saveProject.mockReset().mockResolvedValue(undefined); storage.loadLastOpenedProject.mockReset(); storage.loadProject.mockReset() })
it("exits startup loading on failure and recovers without writing empty data", async () => {
  storage.loadLastOpenedProject.mockRejectedValueOnce(new Error("blocked")).mockResolvedValueOnce(createEmptyProject("restored"))
  const { useProjectStore } = await import("./useProjectStore")
  await useProjectStore.getState().hydrate()
  expect(useProjectStore.getState()).toMatchObject({ hydrated: true, storageLoadError: true })
  expect(await useProjectStore.getState().flushSave()).toBe(false)
  expect(storage.saveProject).not.toHaveBeenCalled()
  await useProjectStore.getState().hydrate()
  expect(useProjectStore.getState().storageLoadError).toBe(false)
  expect(useProjectStore.getState().project.title).toBe("restored")
})
it("keeps edits available after a failed save and retries the latest snapshot", async () => {
  storage.saveProject.mockRejectedValueOnce(new Error("quota"))
  const { useProjectStore } = await import("./useProjectStore")
  const p = createEmptyProject("unsaved")
  useProjectStore.setState({ project: p })
  expect(await useProjectStore.getState().flushSave()).toBe(false)
  expect(useProjectStore.getState().saveStatus).toBe("error")
  expect(useProjectStore.getState().project).toBe(p)
  useProjectStore.setState({ project: { ...p, title: "newest" } })
  expect(await useProjectStore.getState().flushSave()).toBe(true)
  expect(storage.saveProject.mock.lastCall?.[0].title).toBe("newest")
  expect(useProjectStore.getState().saveStatus).toBe("saved")
})

it("reopens the latest unsaved edit instead of replacing it with an older DB record", async () => {
  storage.saveProject.mockRejectedValue(new Error("quota"))
  const { useProjectStore } = await import("./useProjectStore")
  const latest = createEmptyProject("latest unsaved")
  storage.loadProject.mockResolvedValue({ ...latest, title: "old DB version" })
  useProjectStore.setState({ project: latest })
  expect(await useProjectStore.getState().flushSave()).toBe(false)
  useProjectStore.setState({ project: createEmptyProject("other project") })
  await useProjectStore.getState().loadProjectById(latest.projectId)
  expect(useProjectStore.getState().project.title).toBe("latest unsaved")
  expect(storage.loadProject).not.toHaveBeenCalled()
})
