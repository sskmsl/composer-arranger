import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { judgeCoreMotif } from "./hookFirst"
import { subtleHookVariation } from "./hookDevelopment"

function notes(pitches: number[], starts: number[], durations: number[]): MelodyNote[] {
  return pitches.map((pitch, index) => ({
    id: `n${index}`, pitch, startBeat: starts[index], durationBeats: durations[index],
    velocity: 80, locks: [],
  }))
}

describe("Hook-first Melody Generator", () => {
  it("少ない音数だけをHookとせず、歌唱可能な輪郭とリズムの識別性を別々に評価する", () => {
    const flat = judgeCoreMotif(notes([64, 64, 64], [0, 1, 2], [1, 1, 1]), 4)
    const shaped = judgeCoreMotif(notes([64, 64, 67, 65], [.5, 1, 2.5, 3], [.5, 1, .5, .5]), 4)
    expect(shaped.rhythmicIdentity).toBeGreaterThan(flat.rhythmicIdentity)
    expect(shaped.hookability).toBeGreaterThan(flat.hookability)
    expect(shaped.humability).toBeGreaterThan(flat.humability)
  })

  it("変形では核の頭を維持し、末尾1音または小さな休符だけを変える", () => {
    const source = {
      pitches: [64, 64, 67, 65], lengthBeats: 4,
      events: [0, .5, 1.5, 2.5].map((offsetBeats, index) => ({
        offsetBeats, durationBeats: index === 1 ? 1 : .5, isRest: false,
      })),
    }
    const tail = subtleHookVariation(source, "tail")
    const breath = subtleHookVariation(source, "breath")
    expect(tail.pitches.slice(0, -1)).toEqual(source.pitches.slice(0, -1))
    expect(tail.pitches.at(-1)).not.toBe(source.pitches.at(-1))
    expect(breath.pitches).toHaveLength(3)
    expect(source.events.every((event) => !event.isRest)).toBe(true)
  })

  it("サビは短い核を選んで展開し、理論評価と別に記憶性・残存を記録する", () => {
    const chords = ["Am(add9)", "Fmaj7", "Cmaj7", "E7", "Am(add9)", "Fmaj7", "Dm9", "E7"]
      .map((symbol, i) => ({ id: `c${i}`, sectionId: "s", startBeat: i * 4, durationBeats: 4, symbol, bass: null }))
    const result = generateFromChordsWithProfiles({
      chords, sectionId: "s", sectionRole: "chorus", songProfile: "dark-romantic",
      density: "balanced", range: { low: 60, high: 77 }, drama: "growing",
      totalBeats: 32, seed: 7, profiles: ["standard"], key: "Am",
    })
    expect(result.candidates).toHaveLength(3)
    for (const candidate of result.candidates) {
      expect(candidate.coreHumability).toBeGreaterThan(.6)
      expect(candidate.coreHookability).toBeGreaterThan(.6)
      expect(candidate.coreRetention).toBeGreaterThan(.5)
      expect(candidate.notes.every((note) => note.pitch >= 60 && note.pitch <= 77)).toBe(true)
    }
    expect(result.diagnostics.filter((item) => item.selected).every((item) =>
      item.qualityScore >= 45 && (item.coreHookability ?? 0) > .6,
    )).toBe(true)
  })
})
