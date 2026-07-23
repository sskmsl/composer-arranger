import { describe, expect, it } from "vitest"
import { seedExpand } from "./developSeed"
import { buildHarmonicMap } from "./harmonicMap"
import { resolveGenerationParams } from "./generationParams"
import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"

const chords: ChordEvent[] = [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 32, symbol: "C", bass: null }]
const harmonicMap = buildHarmonicMap(chords)
const range = { low: 60, high: 77 }
const params = resolveGenerationParams("original-custom", "verse", "balanced", "growing")

function makeSeed(startBeat: number): MelodyNote[] {
  return [
    { id: "n1", startBeat, durationBeats: 1, pitch: 64, velocity: 80, locks: [] },
    { id: "n2", startBeat: startBeat + 1, durationBeats: 1, pitch: 67, velocity: 80, locks: [] },
  ]
}

describe("seedExpand / target length is relative to the seed's own length (issue #5)", () => {
  it("セクション先頭(0拍)から始まるSeedをExpandすると、ちょうどtargetTotalBeatsの長さになる", () => {
    const seed = makeSeed(0)
    const result = seedExpand(seed, 16, harmonicMap, range, params, 42)
    const end = Math.max(...result.map((n) => n.startBeat + n.durationBeats))
    expect(end).toBeCloseTo(16, 5)
  })

  it("セクション途中(8拍目)から始まるSeedをExpandしても、Seed自身の長さがtargetTotalBeatsになる(絶対位置16までで打ち切られない)", () => {
    const seedStart = 8
    const seed = makeSeed(seedStart)
    const result = seedExpand(seed, 16, harmonicMap, range, params, 42)
    const end = Math.max(...result.map((n) => n.startBeat + n.durationBeats))
    // 修正前は end が 16 (絶対位置) になっていたが、正しくは seedStart(8) + 16 = 24
    expect(end).toBeCloseTo(seedStart + 16, 5)
  })
})
