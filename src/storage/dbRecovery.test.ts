import { expect, it, vi } from "vitest"
const open = vi.hoisted(() => vi.fn())
vi.mock("idb", () => ({ openDB: open }))
it("retries a failed open without deleting the stored database", async () => {
  open.mockRejectedValueOnce(new Error("temporary denial")).mockResolvedValueOnce({ marker: "reopened" })
  const { getDb } = await import("./db")
  await expect(getDb()).rejects.toThrow("temporary denial")
  expect(await getDb()).toEqual({ marker: "reopened" })
  expect(open).toHaveBeenCalledTimes(2)
})
