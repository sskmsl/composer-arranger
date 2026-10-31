import { describe, expect, it, vi } from "vitest"
import { createSaveCoordinator } from "./saveCoordinator"

describe("ordered recoverable project saves", () => {
  it("does not allow an older write to finish after a newer edit", async () => {
    let release!: () => void
    const written: string[] = []
    const write = vi.fn(async (value: { id: string; text: string }) => {
      if (value.text === "old") await new Promise<void>((resolve) => { release = resolve })
      written.push(value.text)
    })
    const queue = createSaveCoordinator(write, (v) => v.id, vi.fn())
    queue.enqueue({ id: "a", text: "old" })
    queue.enqueue({ id: "a", text: "middle" })
    queue.enqueue({ id: "a", text: "latest" })
    expect(write).toHaveBeenCalledTimes(1)
    release()
    expect(await queue.flush()).toBe(true)
    expect(written).toEqual(["old", "latest"])
  })

  it("retains a failed project even when a different project saves successfully", async () => {
    let fail = true
    const statuses: string[] = [], written: string[] = []
    const queue = createSaveCoordinator(async (v: string) => {
      if (v === "a" && fail) throw new Error("quota")
      written.push(v)
    }, (v) => v, (s) => statuses.push(s))
    queue.enqueue("a")
    queue.enqueue("b")
    expect(await queue.flush()).toBe(false)
    expect(written).toEqual(["b"])
    expect(statuses.at(-1)).toBe("error")
    fail = false
    expect(await queue.flush()).toBe(true)
    expect(written).toEqual(["b", "a"])
    expect(statuses.at(-1)).toBe("saved")
  })

  it("waits for edits submitted while a save barrier is waiting", async () => {
    let release!: () => void
    const written: number[] = []
    const queue = createSaveCoordinator(async (v: number) => {
      if (v === 1) await new Promise<void>((resolve) => { release = resolve })
      written.push(v)
    }, () => "same", vi.fn())
    queue.enqueue(1)
    const barrier = queue.flush()
    queue.enqueue(2)
    release()
    expect(await barrier).toBe(true)
    expect(written).toEqual([1, 2])
  })

  it("keeps the most recently edited project last when switching away and back", async () => {
    let release!: () => void
    const written: string[] = []
    const queue = createSaveCoordinator(async (v: { id: string; text: string }) => {
      if (v.text === "old-a") await new Promise<void>((resolve) => { release = resolve })
      written.push(v.text)
    }, (v) => v.id, vi.fn())
    queue.enqueue({ id: "a", text: "old-a" })
    queue.enqueue({ id: "b", text: "b" })
    queue.enqueue({ id: "a", text: "new-a" })
    release()
    expect(await queue.flush()).toBe(true)
    expect(written).toEqual(["old-a", "b", "new-a"])
  })


  it("discards a queued project before deletion and waits for already started writes", async () => {
    let release!: () => void
    const written: string[] = []
    const queue = createSaveCoordinator(async (value: string) => {
      if (value === "active") await new Promise<void>((resolve) => { release = resolve })
      written.push(value)
    }, (value) => value, vi.fn())
    queue.enqueue("active")
    queue.enqueue("deleted")
    expect(queue.pendingValue("deleted")).toBe("deleted")
    let removed = false
    const deletion = queue.discard("deleted").then(() => { removed = true })
    expect(removed).toBe(false)
    release()
    await deletion
    expect(written).toEqual(["active"])
    expect(queue.pendingValue("deleted")).toBeUndefined()
  })


  it("includes a new edit queued as the previous save finishes in the same barrier", async () => {
    const written: number[] = []
    let next = false
    let enqueueNext = () => {}
    const queue = createSaveCoordinator(async (value: number) => { written.push(value) }, () => "same", (status) => {
      if (status === "saved" && !next) { next = true; enqueueNext() }
    })
    enqueueNext = () => queue.enqueue(2)
    queue.enqueue(1)
    expect(await queue.flush()).toBe(true)
    expect(written).toEqual([1, 2])
  })

})
