import { describe, expect, it } from "vitest"
import { previewLayersForMode, resolveComparisonSwitchBeat } from "./previewPlayer"

describe("comparison preview switching", () => {
  it("A/B/C切替時に現在の再生位置を維持する", () => {
    expect(resolveComparisonSwitchBeat(6.25, 4, 12)).toBe(6.25)
  })

  it("ループ範囲外なら共通の先頭位置へ戻す", () => {
    expect(resolveComparisonSwitchBeat(12, 4, 12)).toBe(4)
    expect(resolveComparisonSwitchBeat(2, 4, 12)).toBe(4)
  })
})

describe("preview layer modes", () => {
  it("Arpeggio Onlyではコードとメロディを鳴らさず伴奏Patternだけを鳴らす", () => {
    expect(previewLayersForMode("accompaniment-only")).toEqual({
      chords: false,
      melody: false,
      accompaniment: true,
    })
  })

  it("Chords OnlyへAccompaniment Patternが混入しない", () => {
    expect(previewLayersForMode("chords-only")).toEqual({
      chords: true,
      melody: false,
      accompaniment: false,
    })
  })

  it("Chords + Melodyでは独立伴奏Patternも合わせて鳴らす", () => {
    expect(previewLayersForMode("chords-melody")).toEqual({
      chords: true,
      melody: true,
      accompaniment: true,
    })
  })
})
