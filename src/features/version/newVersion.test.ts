import { describe, expect, it } from "vitest"
import { isNewVersionAvailable } from "./newVersion"

describe("isNewVersionAvailable", () => {
  it("公開された版のIDが違うときだけ、新しい版があるとする", () => {
    expect(isNewVersionAvailable("abc1234", "def5678")).toBe(true)
    expect(isNewVersionAvailable("abc1234", "abc1234")).toBe(false)
  })

  it("手元のビルドや、取得できなかった・形式が違うときは知らせない", () => {
    expect(isNewVersionAvailable("dev", "def5678")).toBe(false)
    expect(isNewVersionAvailable("abc1234", null)).toBe(false)
    expect(isNewVersionAvailable("abc1234", "")).toBe(false)
    expect(isNewVersionAvailable("abc1234", 5)).toBe(false)
  })
})
