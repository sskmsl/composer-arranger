import { describe, expect, it } from "vitest"
import { answerHook, hookPhraseRole, returningHook } from "./hookDevelopment"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import type { MotifCore } from "./motifCore"

const source: MotifCore = {
  pitches: [60, 64, 62, 67], lengthBeats: 4,
  events: [0.5, 0.5, 1, 2].map((durationBeats, i) => ({ offsetBeats: [0, 0.5, 1, 2][i], durationBeats, isRest: false })),
}

describe("planned hook development", () => {
  it("provides contrast and an explicit return, including abbreviated sections", () => {
    expect(Array.from({ length: 4 }, (_, i) => hookPhraseRole(i, 4))).toEqual(["statement", "answer", "contrast", "return"])
    expect(Array.from({ length: 3 }, (_, i) => hookPhraseRole(i, 3))).toEqual(["statement", "answer", "return"])
    expect(Array.from({ length: 2 }, (_, i) => hookPhraseRole(i, 2))).toEqual(["statement", "answer"])
    expect(hookPhraseRole(0, 1)).toBeUndefined()
  })
  it("preserves the defining head and rhythm while varying the answer without mutating the source", () => {
    const original = structuredClone(source)
    const answer = answerHook(source)
    expect(answer.pitches.slice(0, -1)).toEqual(source.pitches.slice(0, -1))
    expect(answer.pitches.at(-1)).not.toBe(source.pitches.at(-1))
    expect(answer.events).toEqual(source.events)
    answer.events[0].durationBeats = 8
    expect(source).toEqual(original)
    expect(answerHook({ ...source, pitches: [60, 64] }).pitches).toEqual([60, 64])
  })
  it("does not repeat the opening wait but preserves the internal rhythm and rests", () => {
    const pickup = { ...source, lengthBeats: 6, events: [
      { offsetBeats: 0, durationBeats: 2, isRest: true },
      ...source.events.map(event => ({ ...event, offsetBeats: event.offsetBeats + 2 })),
    ] }
    expect(returningHook(pickup)).toEqual(source)
    expect(pickup.events[0].isRest).toBe(true)
  })
  it("leaves specialized profile grammars in control", () => {
    for (const profile of ["minimal", "leaping", "rhythmic", "chromatic", "elegiac-cantabile", "speech-rhythmic", "incantatory"] as const) {
      expect(hookPhraseRole(3, 4, profile)).toBeUndefined()
    }
    expect(hookPhraseRole(3, 4, "cinematic")).toBe("return")
  })
  it("keeps final melodies bounded and repeatable through changing harmony", () => {
    const input = {
      chords: ["Am", "F", "C", "G", "Dm", "E7", "Am", "Am"].map((symbol, i) => ({ id: `${i}`, sectionId: "s", startBeat: i * 4, durationBeats: 4, symbol, bass: null })),
      sectionId: "s", sectionRole: "chorus" as const, songProfile: "original-custom" as const,
      density: "balanced" as const, range: { low: 60, high: 77 }, drama: "growing" as const,
      totalBeats: 32, seed: 7, profiles: ["standard" as const],
    }
    const first = generateFromChordsWithProfiles(input).candidates
    const again = generateFromChordsWithProfiles(input).candidates
    expect(first).toHaveLength(3)
    const sounding = (candidates: typeof first) => candidates.map(c => c.notes.map(n => [n.pitch, n.startBeat, n.durationBeats]))
    expect(sounding(first)).toEqual(sounding(again))
    for (const candidate of first) {
      expect(candidate.notes.length).toBeGreaterThan(0)
      for (const note of candidate.notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(60)
        expect(note.pitch).toBeLessThanOrEqual(77)
        expect(note.startBeat).toBeGreaterThanOrEqual(0)
        expect(note.startBeat + note.durationBeats).toBeLessThanOrEqual(32)
      }
    }
  })
})
