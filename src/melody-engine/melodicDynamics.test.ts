import { describe, expect, it } from "vitest"
import type { CandidateMelodyDNA, MelodyNote } from "@/core/melody"
import { shapeGrowingMelodyDynamics } from "./melodicDynamics"

const dna: CandidateMelodyDNA = {
  motifIdentity: "stepwise-cell", rhythmGrammar: "balanced", phraseArchitecture: "balanced",
  harmonicResponse: "chord-following", registerTrajectory: "arch", developmentStrategy: "sequence",
  climaxPlan: { type: "pitch-peak", position: "middle", targetFraction: 0.58 },
  endingStrategy: "resolved",
}

const notes: MelodyNote[] = Array.from({ length: 128 }, (_, beat) => ({
  id: `n${beat}`, pitch: 64 + (beat % 4), startBeat: beat,
  durationBeats: 1, velocity: 78, locks: [],
}))

describe("growing melody dynamics", () => {
  it("builds intensity over the whole phrase, then eases without rewriting the melody", () => {
    const shaped = shapeGrowingMelodyDynamics(notes, 128, "standard", "chorus", "growing", dna)
    expect(shaped.map(note => [note.pitch, note.startBeat, note.durationBeats])).toEqual(
      notes.map(note => [note.pitch, note.startBeat, note.durationBeats]),
    )
    expect(shaped[0].velocity).toBeLessThan(shaped[50].velocity)
    expect(shaped[50].velocity).toBeLessThan(shaped[104].velocity)
    expect(shaped[127].velocity).toBeLessThan(shaped[104].velocity)
    expect(shaped.every(note => note.velocity >= 50 && note.velocity <= 110)).toBe(true)
  })

  it("leaves restrained, early-climax, dedicated-profile, and locked notes alone", () => {
    expect(shapeGrowingMelodyDynamics(notes, 128, "standard", "chorus", "restrained", dna)).toBe(notes)
    expect(shapeGrowingMelodyDynamics(notes, 128, "cinematic", "chorus", "growing", dna)).toBe(notes)
    expect(shapeGrowingMelodyDynamics(notes, 128, "standard", "chorus", "growing", {
      ...dna, climaxPlan: { ...dna.climaxPlan, position: "early" },
    })).toBe(notes)
    const locked = notes.map(note => ({ ...note, locks: [...note.locks] }))
    locked[104].locks = ["pitch"]
    expect(shapeGrowingMelodyDynamics(locked, 128, "standard", "chorus", "growing", dna)[104].velocity).toBe(78)
  })
})
