import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getUser: mocks.getUser }, rpc: mocks.rpc } }))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())
it("cancels an old account's delayed upload on account change", async () => {
  const scope = await import("@/storage/accountScope")
  scope.selectStorageAccount("A"); scope.allowStorageAccount("A")
  mocks.getUser.mockResolvedValue({ data: { user: { id: "B" } } })
  const { scheduleProjectPush } = await import("./projectSync")
  scheduleProjectPush({ ...createEmptyProject("private A"), savedAt: new Date().toISOString() })
  scope.selectStorageAccount("B"); scope.allowStorageAccount("B")
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it("does not upload when authentication resolves under a different account", async () => {
  const scope = await import("@/storage/accountScope")
  scope.selectStorageAccount("A"); scope.allowStorageAccount("A")
  let authenticate!: (value: unknown) => void
  mocks.getUser.mockReturnValue(new Promise((resolve) => { authenticate = resolve }))
  const { pushProject } = await import("./projectSync")
  const push = pushProject({ ...createEmptyProject("private A"), savedAt: new Date().toISOString() })
  scope.selectStorageAccount("B"); scope.allowStorageAccount("B")
  authenticate({ data: { user: { id: "B" } } })
  await push
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it("uploads a project normally while its authenticated owner remains unchanged", async () => {
  const scope = await import("@/storage/accountScope")
  scope.selectStorageAccount("A"); scope.allowStorageAccount("A")
  mocks.getUser.mockResolvedValue({ data: { user: { id: "A" } } })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  const { pushProject } = await import("./projectSync")
  const project = { ...createEmptyProject("private A"), savedAt: new Date().toISOString() }
  await pushProject(project)
  expect(mocks.rpc).toHaveBeenCalledWith("upsert_arranger_project", expect.objectContaining({ p_id: project.projectId, p_deleted_at: null }))
})
