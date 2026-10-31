import { expect, it, vi } from "vitest"
import { reloadAfterSave } from "./reloadAfterSave"
it("does not reload until the latest save has completed", async () => {
  let finish!: (ok: boolean) => void
  const reload = vi.fn()
  const result = reloadAfterSave(() => new Promise((resolve) => { finish = resolve }), reload)
  expect(reload).not.toHaveBeenCalled()
  finish(true)
  expect(await result).toBe(true)
  expect(reload).toHaveBeenCalledOnce()
})
it("retains the screen when saving fails or rejects", async () => {
  const reload = vi.fn()
  expect(await reloadAfterSave(async () => false, reload)).toBe(false)
  expect(await reloadAfterSave(async () => { throw new Error("quota") }, reload)).toBe(false)
  expect(reload).not.toHaveBeenCalled()
})
