import { describe, expect, it } from "vitest"
import { resolveComparisonSwitchBeat } from "./previewPlayer"

describe("comparison preview switching", () => {
  it("A/B/C切替時に現在の再生位置を維持する", () => {
    expect(resolveComparisonSwitchBeat(6.25, 4, 12)).toBe(6.25)
  })

  it("ループ範囲外なら共通の先頭位置へ戻す", () => {
    expect(resolveComparisonSwitchBeat(12, 4, 12)).toBe(4)
    expect(resolveComparisonSwitchBeat(2, 4, 12)).toBe(4)
  })
})
