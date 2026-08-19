import { describe, expect, it } from "vitest"
import {
  previewLayersForMode,
  previewTailSeconds,
  resolveComparisonSwitchBeat,
  resolveReactivePreviewRange,
} from "./previewPlayer"

describe("signature preview expression", () => {
  it("空間型だけはフレーズ終端で残響を切らない", () => {
    expect(previewTailSeconds("atmospheric")).toBeGreaterThanOrEqual(1)
    expect(previewTailSeconds("obsessive")).toBeLessThan(0.5)
    expect(previewTailSeconds("kinetic")).toBeLessThan(0.5)
  })
})

describe("comparison preview switching", () => {
  it("A/B/C切替時に現在の再生位置を維持する", () => {
    expect(resolveComparisonSwitchBeat(6.25, 4, 12)).toBe(6.25)
  })

  it("ループ範囲外なら共通の先頭位置へ戻す", () => {
    expect(resolveComparisonSwitchBeat(12, 4, 12)).toBe(4)
    expect(resolveComparisonSwitchBeat(2, 4, 12)).toBe(4)
  })
})

describe("reactive candidate preview range", () => {
  it("候補の前後だけを再生し、Section末まで待たせない", () => {
    expect(
      resolveReactivePreviewRange(
        [
          {
            id: "n1",
            startBeat: 6,
            durationBeats: 0.5,
            pitch: 64,
            velocity: 70,
            locks: [],
          },
          {
            id: "n2",
            startBeat: 7,
            durationBeats: 1,
            pitch: 67,
            velocity: 70,
            locks: [],
          },
        ],
        16,
      ),
    ).toEqual({ startBeat: 5, endBeat: 8.5 })
  })

  it("Section境界を越えない", () => {
    expect(
      resolveReactivePreviewRange(
        [
          {
            id: "n1",
            startBeat: 0.25,
            durationBeats: 0.5,
            pitch: 64,
            velocity: 70,
            locks: [],
          },
          {
            id: "n2",
            startBeat: 15,
            durationBeats: 1,
            pitch: 67,
            velocity: 70,
            locks: [],
          },
        ],
        16,
      ),
    ).toEqual({ startBeat: 0, endBeat: 16 })
  })
})

describe("preview layer modes", () => {
  it("Arpeggio Onlyではコードとメロディを鳴らさず伴奏Patternだけを鳴らす", () => {
    expect(previewLayersForMode("accompaniment-only")).toEqual({
      chords: false,
      melody: false,
      accompaniment: true,
      reactive: false,
    })
  })

  it("Chords OnlyへAccompaniment Patternが混入しない", () => {
    expect(previewLayersForMode("chords-only")).toEqual({
      chords: true,
      melody: false,
      accompaniment: false,
      reactive: false,
    })
  })

  it("Chords + Melodyでは独立伴奏Patternも合わせて鳴らす", () => {
    expect(previewLayersForMode("chords-melody")).toEqual({
      chords: true,
      melody: true,
      accompaniment: true,
      reactive: false,
    })
  })

  it("Reactive Layerを単独またはMelodyとのCombinedで選べる", () => {
    expect(previewLayersForMode("reactive-only")).toEqual({
      chords: false,
      melody: false,
      accompaniment: false,
      reactive: true,
    })
    expect(previewLayersForMode("melody-reactive")).toEqual({
      chords: false,
      melody: true,
      accompaniment: false,
      reactive: true,
    })
    expect(previewLayersForMode("chords-reactive")).toEqual({
      chords: true,
      melody: false,
      accompaniment: false,
      reactive: true,
    })
  })

  it("Full Active Contextでは全レイヤーを同じ時間軸で鳴らす", () => {
    expect(previewLayersForMode("active-context-reactive")).toEqual({
      chords: true,
      melody: true,
      accompaniment: true,
      reactive: true,
    })
  })
})
