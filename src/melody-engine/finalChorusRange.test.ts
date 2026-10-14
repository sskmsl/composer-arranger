import { describe, expect, it } from "vitest"
import { finalChorusRange } from "./finalChorusRange"
import { RANGE_PRESETS } from "./generationParams"

describe("転調する最終サビの音域", () => {
  it("全プリセットで上限をキー差だけ拡張し、最大4半音かつ84に収める", () => {
    for (const range of Object.values(RANGE_PRESETS)) for (let rise = 1; rise <= 5; rise++) {
      const result = finalChorusRange(range, true, rise)
      expect(result.high).toBe(Math.min(84, range.high + Math.min(4, rise)))
      expect(result.low).toBe(Math.min(result.high, range.low + rise))
    }
    expect(finalChorusRange({ low: 70, high: 83 }, true, 5)).toEqual({ low: 75, high: 84 })
  })
  it("最終サビなし・同じキー・下がるキーでは設定を変えない", () => {
    for (const [lifted, rise] of [[false, 2], [true, 0], [true, 11], [true, -2]] as const) {
      expect(finalChorusRange(RANGE_PRESETS.middle, lifted, rise)).toBe(RANGE_PRESETS.middle)
    }
  })
})
