import { afterEach, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { PendingCloudSave } from "@/storage/cloudOutbox"
import { createCloudSaveCoordinator } from "./cloudSaveCoordinator"

afterEach(() => vi.useRealTimers())
function setup() {
  let owner: string | null = "A"
  const entries = new Map<string, PendingCloudSave>()
  const notify = vi.fn()
  const send = vi.fn<(entry: PendingCloudSave) => Promise<void>>().mockResolvedValue(undefined)
  const key = (entry: PendingCloudSave) => entry.ownerId + ":" + entry.project.projectId
  const add = (ownerId: string, id: string, revision: string) => {
    const entry: PendingCloudSave = { kind: "save", ownerId, revision, project: { ...createEmptyProject(revision), projectId: id, savedAt: "2026-11-01T00:00:00Z" } }
    entries.set(key(entry), entry)
    return entry
  }
  const options = { owner: () => owner, list: async (id: string) => [...entries.values()].filter(e => e.ownerId === id), send,
    acknowledge: async (entry: PendingCloudSave) => { if (entries.get(key(entry))?.revision === entry.revision) entries.delete(key(entry)) },
    retryable: (error: unknown) => error instanceof TypeError, notify }
  return { entries, add, send, notify, options, owner: (next: string | null) => { owner = next } }
}
it("retains failed sends and resumes from persistent entries after recreating the coordinator", async () => {
  const s = setup(); s.add("A", "song", "v1")
  s.send.mockRejectedValueOnce(new Error("server unavailable"))
  const first = createCloudSaveCoordinator(s.options)
  await first.flush(); first.dispose()
  expect(s.entries.size).toBe(1)
  expect(s.notify).toHaveBeenLastCalledWith({ state: "error", pendingCount: 1 })
  await createCloudSaveCoordinator(s.options).flush()
  expect(s.entries.size).toBe(0)
  expect(s.notify).toHaveBeenLastCalledWith({ state: "saved", pendingCount: 0 })
})
it("does not acknowledge a newer edit using an earlier send response", async () => {
  const s = setup(); s.add("A", "song", "v1")
  let release!: () => void
  s.send.mockImplementationOnce(async () => new Promise<void>(resolve => { release = resolve }))
  const queue = createCloudSaveCoordinator(s.options)
  const sending = queue.flush()
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1))
  s.add("A", "song", "v2"); release(); await sending
  expect(s.send.mock.calls.map(([entry]) => entry.revision)).toEqual(["v1", "v2"])
  expect(s.entries.size).toBe(0)
})
it("keeps an old owner's in-flight entry and never acknowledges it under another account", async () => {
  const s = setup(); s.add("A", "private-a", "a"); s.add("B", "private-b", "b")
  let release!: () => void
  s.send.mockImplementationOnce(async () => new Promise<void>(resolve => { release = resolve }))
  const queue = createCloudSaveCoordinator(s.options)
  const old = queue.flush()
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1))
  s.owner("B"); queue.accountChanged(); await queue.flush()
  release(); await old
  expect([...s.entries.values()].map(e => e.ownerId)).toEqual(["A"])
  s.owner("A"); queue.accountChanged(); await queue.flush()
  expect(s.entries.size).toBe(0)
  queue.dispose()
})
it("backs off network failures and cancels retry timers on sign out", async () => {
  vi.useFakeTimers()
  const s = setup(); s.add("A", "song", "v1")
  s.send.mockRejectedValue(new TypeError("Failed to fetch"))
  const queue = createCloudSaveCoordinator(s.options)
  await queue.flush()
  expect(s.send).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(4999)
  expect(s.send).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(s.send).toHaveBeenCalledTimes(2)
  s.owner(null); queue.accountChanged()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(s.send).toHaveBeenCalledTimes(2)
  expect(s.entries.size).toBe(1)
})
it("does not shorten network backoff when more edits arrive", async () => {
  vi.useFakeTimers()
  const s = setup(); s.add("A", "song", "v1")
  s.send.mockRejectedValueOnce(new TypeError("Failed to fetch"))
  const queue = createCloudSaveCoordinator(s.options)
  await queue.flush()
  s.add("A", "song", "v2"); queue.schedule()
  await vi.advanceTimersByTimeAsync(800)
  expect(s.send).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(4200)
  expect(s.send.mock.calls.map(([entry]) => entry.revision)).toEqual(["v1", "v2"])
  expect(s.entries.size).toBe(0)
  queue.dispose()
})
