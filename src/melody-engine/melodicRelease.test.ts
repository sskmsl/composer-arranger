import { describe, expect, it } from "vitest"
import type { CandidateMelodyDNA, MelodyNote } from "@/core/melody"
import { buildHarmonicMap } from "./harmonicMap"
import { shapeMelodicRelease } from "./melodicRelease"

const chords = Array.from({ length: 16 }, (_, i) => ({
  id: `c${i}`, sectionId: "chorus", startBeat: i * 4, durationBeats: 4,
  symbol: ["Am", "F", "C", "G"][i % 4], bass: null,
}))
const harmony = buildHarmonicMap(chords)
const dna: CandidateMelodyDNA = {
  motifIdentity: "stepwise-cell", rhythmGrammar: "balanced", phraseArchitecture: "balanced",
  harmonicResponse: "chord-following", registerTrajectory: "arch", developmentStrategy: "sequence",
  climaxPlan: { type: "pitch-peak", position: "middle", targetFraction: 0.58 },
  endingStrategy: "resolved",
}

function activeNotes(): MelodyNote[] {
  return Array.from({ length: 64 }, (_, beat) => ({
    id: `n${beat}`, startBeat: beat, durationBeats: 1,
    pitch: beat === 63 ? 71 : beat >= 60 ? 67 : 69,
    velocity: 80, locks: [],
  }))
}

describe("melodic release", () => {
  it("keeps the established hook, thins the ending, and leaves accompaniment room", () => {
    const before = activeNotes()
    before[52].plannedResolution = { targetPitchClass: 9, targetBeat: 54, maximumDelayBeats: 2 }
    const after = shapeMelodicRelease(before, harmony, 64, "standard", "chorus", dna)
    expect(after.filter(note => note.startBeat < 48)).toEqual(before.filter(note => note.startBeat < 48))
    expect(after.find(note => note.id === "n52")?.plannedResolution).toEqual(before[52].plannedResolution)
    expect(after.some(note => note.id === "n54")).toBe(true)
    expect(after.filter(note => note.startBeat >= 48).length).toBeLessThan(before.filter(note => note.startBeat >= 48).length / 2)
    const last = after[after.length - 1]
    expect(last.pitch).toBe(71)
    expect(last.durationBeats).toBeGreaterThanOrEqual(2)
    expect(last.startBeat + last.durationBeats).toBeLessThanOrEqual(63.25)
    expect(after.every((note, index) => index === 0 || after[index - 1].startBeat + after[index - 1].durationBeats <= note.startBeat)).toBe(true)
  })

  it("preserves a late-climax phrase and protected final notes", () => {
    const notes = activeNotes()
    expect(shapeMelodicRelease(notes, harmony, 64, "standard", "chorus", {
      ...dna, climaxPlan: { ...dna.climaxPlan, position: "late" },
    })).toBe(notes)
    notes[61].locks = ["pitch"]
    expect(shapeMelodicRelease(notes, harmony, 64, "standard", "chorus", dna)).toBe(notes)
  })
})
