import { describe, expect, it } from "vitest"
import { parseTimeSignature } from "./section"

describe("parseTimeSignature / denominator handling (issue #6)", () => {
  it("4/4 は従来どおり beatsPerBar=4", () => {
    expect(parseTimeSignature("4/4")).toEqual({ numerator: 4, denominator: 4, beatsPerBar: 4 })
  })

  it("3/4 は beatsPerBar=3", () => {
    expect(parseTimeSignature("3/4")).toEqual({ numerator: 3, denominator: 4, beatsPerBar: 3 })
  })

  it("6/8 は四分音符換算で beatsPerBar=3 になる(6ではない)", () => {
    expect(parseTimeSignature("6/8")).toEqual({ numerator: 6, denominator: 8, beatsPerBar: 3 })
  })

  it("2/2 は beatsPerBar=4 になる", () => {
    expect(parseTimeSignature("2/2")).toEqual({ numerator: 2, denominator: 2, beatsPerBar: 4 })
  })
})
