import { describe, expect, it } from "vitest"
import { parseChordSymbol } from "./chord"

function tonePcs(symbol: string): number[] {
  const parsed = parseChordSymbol(symbol)
  if (!parsed) throw new Error(`failed to parse ${symbol}`)
  return parsed.tones.map((t) => t.pitchClass)
}

describe("parseChordSymbol / m7 vs M7 collision (issue #1)", () => {
  it("Am7 はマイナー7thとして解析される(メジャー7thにならない)", () => {
    const parsed = parseChordSymbol("Am7")!
    expect(parsed.isMinor).toBe(true)
    // A(9) C(0) E(4) G(7)
    expect(tonePcs("Am7")).toEqual([9, 0, 4, 7])
  })

  it("Bm7b5 はハーフディミニッシュとして解析される", () => {
    const parsed = parseChordSymbol("Bm7b5")!
    expect(parsed.isMinor).toBe(true)
    expect(parsed.isDiminished).toBe(true)
    // B(11) D(2) F(5) A(9)
    expect(tonePcs("Bm7b5")).toEqual([11, 2, 5, 9])
  })

  it("CM7 (大文字M) は引き続きメジャー7thとして解析される", () => {
    const parsed = parseChordSymbol("CM7")!
    expect(parsed.isMinor).toBe(false)
    // C(0) E(4) G(7) B(11)
    expect(tonePcs("CM7")).toEqual([0, 4, 7, 11])
  })

  it("Cmaj7 は引き続きメジャー7thとして解析される", () => {
    const parsed = parseChordSymbol("Cmaj7")!
    expect(parsed.isMinor).toBe(false)
    expect(tonePcs("Cmaj7")).toEqual([0, 4, 7, 11])
  })

  it("CmM7 (マイナー・メジャー7th) は引き続き正しく解析される", () => {
    const parsed = parseChordSymbol("CmM7")!
    expect(parsed.isMinor).toBe(true)
    expect(tonePcs("CmM7")).toEqual([0, 3, 7, 11])
  })

  it("Dm7 もマイナー7thとして解析される", () => {
    expect(parseChordSymbol("Dm7")!.isMinor).toBe(true)
  })
})
