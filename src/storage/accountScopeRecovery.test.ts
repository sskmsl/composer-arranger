import { beforeEach, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), scheduleProjectPush: vi.fn() }))
vi.mock("./db", () => ({ getDb: mocks.getDb, PROJECT_STORE: "projects", META_STORE: "meta" }))
vi.mock("@/features/sync/projectSync", () => ({ scheduleProjectPush: mocks.scheduleProjectPush }))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
it("does not start an old account write after its DB open completes under another account", async () => {
  const scope = await import("./accountScope")
  scope.selectStorageAccount("A"); scope.allowStorageAccount("A")
  let open!: (db: unknown) => void
  const transaction = vi.fn()
  mocks.getDb.mockReturnValue(new Promise((resolve) => { open = resolve }))
  const { saveProject } = await import("./projectRepository")
  const saving = saveProject(createEmptyProject("private A"))
  const rejection = expect(saving).rejects.toThrow("アカウント")
  scope.selectStorageAccount("B"); scope.allowStorageAccount("B")
  open({ transaction })
  await rejection
  expect(transaction).not.toHaveBeenCalled()
  expect(mocks.scheduleProjectPush).not.toHaveBeenCalled()
})
it("does not schedule a cloud upload if the account changes during a local commit", async () => {
  const scope = await import("./accountScope")
  scope.selectStorageAccount("A"); scope.allowStorageAccount("A")
  let commit!: () => void
  const done = new Promise<void>((resolve) => { commit = resolve })
  mocks.getDb.mockResolvedValue({ transaction: () => ({ objectStore: () => ({ put: vi.fn().mockResolvedValue(undefined) }), done }) })
  const { saveProject } = await import("./projectRepository")
  const saving = saveProject(createEmptyProject("private A"))
  const rejection = expect(saving).rejects.toThrow("アカウント")
  await Promise.resolve()
  scope.selectStorageAccount("B"); scope.allowStorageAccount("B")
  commit()
  await rejection
  expect(mocks.scheduleProjectPush).not.toHaveBeenCalled()
})
