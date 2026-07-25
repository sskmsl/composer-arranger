import { describe, expect, it } from "vitest"
import { resolveGenerationParams } from "../melody-engine/generationParams"
import { parseTimeSignature, SECTION_ROLE_LABELS } from "./section"

describe("parseTimeSignature / denominator handling (issue #6)", () => {
  it("4/4 は従来どおり beatsPerBar=4", () => {
    expect(parseTimeSignature("4/4")).toEqual({
      numerator: 4,
      denominator: 4,
      beatsPerBar: 4,
    })
  })

  it("3/4 は beatsPerBar=3", () => {
    expect(parseTimeSignature("3/4")).toEqual({
      numerator: 3,
      denominator: 4,
      beatsPerBar: 3,
    })
  })

  it("6/8 は四分音符換算で beatsPerBar=3 になる(6ではない)", () => {
    expect(parseTimeSignature("6/8")).toEqual({
      numerator: 6,
      denominator: 8,
      beatsPerBar: 3,
    })
  })

  it("2/2 は beatsPerBar=4 になる", () => {
    expect(parseTimeSignature("2/2")).toEqual({
      numerator: 2,
      denominator: 2,
      beatsPerBar: 4,
    })
  })
})

describe("共通Section ROLE", () => {
  it("Chord Generatorと共有する10 ROLEを同じ順序とラベルで持つ", () => {
    expect(Object.entries(SECTION_ROLE_LABELS)).toEqual([
      ["intro", "イントロ"],
      ["verse", "Aメロ"],
      ["pre-chorus", "Bメロ"],
      ["chorus", "サビ"],
      ["breakdown-chorus", "落ちサビ"],
      ["grand-chorus", "大サビ"],
      ["c-melody", "Cメロ"],
      ["bridge", "ブリッジ"],
      ["instrumental", "間奏"],
      ["outro", "アウトロ"],
    ])
  })

  it("落ちサビは通常サビより密度を抑え、Cメロは新規性を高める", () => {
    const chorus = resolveGenerationParams("original-custom", "chorus", "balanced", "growing")
    const breakdown = resolveGenerationParams(
      "original-custom",
      "breakdown-chorus",
      "balanced",
      "growing",
    )
    const cMelody = resolveGenerationParams(
      "original-custom",
      "c-melody",
      "balanced",
      "growing",
    )

    expect(breakdown.densityNoteMultiplier).toBeLessThan(chorus.densityNoteMultiplier)
    expect(breakdown.restRatioTarget).toBeGreaterThan(chorus.restRatioTarget)
    expect(cMelody.noveltyWeight).toBeGreaterThan(chorus.noveltyWeight)
  })
})
