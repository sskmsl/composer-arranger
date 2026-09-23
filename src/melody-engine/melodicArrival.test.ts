import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { applyMelodicArrival, placeExpressiveChromaticTurn } from "./melodicArrival"
import { buildHarmonicMap } from "./harmonicMap"
import { enforceHarmonicIntegrity } from "./harmonicIntegrity"
import { SeededRandom } from "@/core/rng"
import { generateRhythmMotif } from "./motifCore"
import { resolveGenerationParams } from "./generationParams"
import { capturePlacedHook } from "./hookDevelopment"

const chords = [{ id: "c", sectionId: "s", startBeat: 0, durationBeats: 12, symbol: "C", bass: null }]
const map = buildHarmonicMap(chords)
const range = { low: 60, high: 81 }
function fixture(): MelodyNote[] {
  return [60, 64, 67, 72, 74, 79, 74, 76, 72].map((pitch, i) => ({
    id: `${i}`, pitch, startBeat: [0, 1, 2, 3, 4, 5, 5.5, 7, 8][i],
    durationBeats: [1, 1, 1, 1, 1, 0.5, 1.5, 1, 2][i], velocity: 80, locks: [],
  }))
}

describe("melodic arrival", () => {
  it("adds one late chromatic tension that resolves without adding notes or changing the hook", () => {
    const longChords = [{ ...chords[0], durationBeats: 32 }]
    const longMap = buildHarmonicMap(longChords)
    const source: MelodyNote[] = Array.from({ length: 16 }, (_, i) => ({
      id: `late-${i}`, pitch: i === 12 ? 79 : i % 4 === 0 ? 64 : 67,
      startBeat: i * 2, durationBeats: 1.5, velocity: 80, locks: [],
    }))
    const shaped = placeExpressiveChromaticTurn(source, longMap, range, 32)
    const final = enforceHarmonicIntegrity(shaped, longChords, range).notes
    const changed = final.filter((note, i) => note.pitch !== source[i].pitch)
    expect(changed).toHaveLength(1)
    expect(final.map(note => [note.id, note.startBeat, note.durationBeats]))
      .toEqual(source.map(note => [note.id, note.startBeat, note.durationBeats]))
    expect(final.slice(0, 4).map(note => note.pitch)).toEqual(source.slice(0, 4).map(note => note.pitch))
    const tension = changed[0]
    const next = final[final.findIndex(note => note.id === tension.id) + 1]
    expect(Math.abs(next.pitch - tension.pitch)).toBe(1)
    expect(tension.plannedResolution?.targetBeat).toBe(next.startBeat)
    expect(placeExpressiveChromaticTurn(final, longMap, range, 32)).toEqual(final)
  })
  it("preserves the hook and ending while shaping a single existing peak", () => {
    const source = fixture()
    const snapshot = structuredClone(source)
    const result = applyMelodicArrival(source, map, range, 12, "growing")
    expect(source).toEqual(snapshot)
    expect(result.slice(0, 3)).toEqual(source.slice(0, 3))
    expect(result.at(-1)).toEqual(source.at(-1))
    expect(result.map(n => n.id)).toEqual(source.map(n => n.id))
    expect(result[5].pitch).toBe(source[5].pitch)
    expect(result[5].durationBeats).toBeGreaterThan(source[5].durationBeats)
    expect(result[5].startBeat - result[4].startBeat - result[4].durationBeats).toBeGreaterThanOrEqual(0.25)
    expect(result[5].pitch - result[6].pitch).toBeGreaterThan(0)
    expect(result[5].pitch - result[6].pitch).toBeLessThanOrEqual(3)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].startBeat + result[i].durationBeats).toBeLessThanOrEqual(result[i + 1].startBeat)
      expect(result[i].durationBeats).toBeGreaterThanOrEqual(0.25)
    }
  })
  it("makes a real stepwise resolution survive final harmonic validation", () => {
    const source = fixture()
    source[5].pitch = 77
    const shaped = applyMelodicArrival(source, map, range, 12, "open")
    const final = enforceHarmonicIntegrity(shaped, chords, range, { preserveExpressiveChordRoles: true }).notes
    const peak = final.find(n => n.id === "5")!
    const landing = final.find(n => n.id === "6")!
    expect(peak.pitch).toBe(77)
    expect(landing.pitch).toBe(76)
    expect(peak.plannedResolution?.targetPitchClass).toBe(4)
    expect(peak.plannedResolution?.targetBeat).toBe(landing.startBeat)
  })
  it("does not borrow duration across a chord boundary", () => {
    const split = buildHarmonicMap([
      { ...chords[0], durationBeats: 5.5 },
      { ...chords[0], id: "g", symbol: "G", startBeat: 5.5, durationBeats: 6.5 },
    ])
    const result = applyMelodicArrival(fixture(), split, range, 12, "open")
    expect(result[5].durationBeats).toBe(0.5)
    expect(result[6].startBeat).toBe(5.5)
  })
  it("respects restraint, specialized profiles, locks and existing resolution pairs", () => {
    const source = fixture()
    expect(applyMelodicArrival(source, map, range, 12, "restrained")).toEqual(source)
    expect(applyMelodicArrival(source, map, range, 12, "growing", "cinematic")).toEqual(source)
    source[5].locks = ["pitch"]
    expect(applyMelodicArrival(source, map, range, 12, "growing")).toEqual(source)
    source[5].locks = []
    source[4].plannedResolution = { targetPitchClass: 7, targetBeat: 5, maximumDelayBeats: 1 }
    expect(applyMelodicArrival(source, map, range, 12, "growing")).toEqual(source)
  })
  it("retains at least three sounding notes when creating a hook, even with rests enabled", () => {
    const params = { ...resolveGenerationParams("original-custom", "chorus", "balanced", "growing"), restRatioTarget: 1 }
    for (let seed = 1; seed <= 100; seed++) {
      const events = generateRhythmMotif(new SeededRandom(seed), "balanced", params, undefined, 3)
      expect(events.filter(event => !event.isRest).length).toBeGreaterThanOrEqual(3)
    }
  })
  it("records the audible hook rather than pitches that were corrected during placement", () => {
    const source = { pitches: [61, 65, 68], lengthBeats: 3, events: [0, 1, 2].map(offsetBeats => ({ offsetBeats, durationBeats: 1, isRest: false })) }
    const actual = fixture().map(note => ({ ...note, startBeat: note.startBeat + 4 }))
    const captured = capturePlacedHook(source, actual, 4)
    expect(captured.pitches).toEqual([60, 64, 67])
    expect(captured.events.map(e => e.offsetBeats)).toEqual([0, 1, 2])
    expect(source.pitches).toEqual([61, 65, 68])
  })
})
