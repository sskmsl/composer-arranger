import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { hookabilityFor, judgeCoreMotif } from "./hookFirst"
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


describe("サビの核の型ごとの覚えやすさ", () => {
  const core = (rhythm: [number, number][]): MelodyNote[] =>
    rhythm.map(([startBeat, durationBeats], index) => ({ id: `r${index}`, startBeat, durationBeats, pitch: [60, 62, 64, 67, 64, 62][index % 6], velocity: 80, locks: [] }))
  // 1拍・2拍の組を2回(リズムの種類は少なめ)
  const moderate = core([[0, 1], [1, 2], [4, 1], [5, 2]])
  // 発音間隔も音価もばらばら(リズムの種類が多い)
  const busy = core([[0, 1.5], [1.5, .5], [2, .75], [3, .25], [4.5, 1.25], [6, .5]])
  it("従来の型は種類の多い核を、素直な型は種類が中くらいの核を高くする", () => {
    const m = judgeCoreMotif(moderate, 8)
    const b = judgeCoreMotif(busy, 8)
    expect(b.rhythmicIdentity).toBeGreaterThan(m.rhythmicIdentity)
    expect(b.hookability - b.plainHookability).toBeGreaterThan(m.hookability - m.plainHookability)
    expect(m.plainHookability).toBeGreaterThan(b.plainHookability)
  })
  it("選抜・候補の順位付け・記録には、核の型に合った覚えやすさを使う", () => {
    const j = judgeCoreMotif(moderate, 8)
    expect(hookabilityFor(j, "plain")).toBe(j.plainHookability)
    expect(hookabilityFor(j, "varied")).toBe(j.hookability)
    expect(hookabilityFor(j)).toBe(j.hookability)
  })
})
