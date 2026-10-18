import { describe, expect, it } from "vitest"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { exportMelodyMidi } from "@/midi/exportMelody"
import { parseMidi } from "@/midi/importMidi"

const seeds = [19, 41, 73, 101, 137, 173]
const chords = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, sectionId: "s1",
  startBeat: i * 4, durationBeats: 4, symbol: ["Am", "F", "C", "G"][i % 4], bass: null }))

describe("reference D and E melody candidates", () => {
  it("keeps midrange semitone returns after selection, finishing, and MIDI export", () => {
    let neighbors = 0
    for (const seed of seeds) {
      const batch = generateFromChordsWithProfiles({ chords, sectionId: "s1", sectionRole: "breakdown-chorus",
        songProfile: "original-custom", density: "sparse", drama: "restrained", range: { low: 60, high: 65 },
        totalBeats: 32, seed, profiles: ["incantatory"] })
      expect(batch.candidates).toHaveLength(3)
      for (const candidate of batch.candidates) {
        const midi = parseMidi(exportMelodyMidi({ title: "Neighbor cell", sectionName: "s1", tempo: 100,
          timeSignature: "4/4", chords, melodyNotes: candidate.notes, includeChords: false }))
        const pitches = midi.tracks.flatMap((t) => t.notes).map((n) => n.pitch)
        expect(pitches).toEqual(candidate.notes.map((n) => n.pitch))
        expect(Math.min(...pitches)).toBeGreaterThanOrEqual(60)
        expect(Math.max(...pitches)).toBeLessThanOrEqual(65)
        const steps = pitches.slice(1).map((p, i) => Math.abs(p - pitches[i])).filter(Boolean)
        const returns = pitches.filter((p, i) => i >= 2 && p === pitches[i - 2] && Math.abs(p - pitches[i - 1]) === 1)
        if (returns.length > 1 && steps.filter((step) => step === 1).length > steps.length / 2) neighbors++
      }
    }
    // A selected candidate must contain repeated returns, rather than an isolated accidental semitone.
    expect(neighbors).toBeGreaterThan(0)
  })
})
