import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { candidateMelodyRegister, planMelodyCharacter } from "./melodyCharacter"
import { exportMelodyMidi } from "@/midi/exportMelody"
import { parseMidi } from "@/midi/importMidi"

const chords = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, sectionId: "s1",
  startBeat: i * 4, durationBeats: 4, symbol: ["Am", "F", "C", "G"][i % 4], bass: null }))
const seeds = [19, 41, 73, 101, 137, 173]

describe("reference D and E chorus register choices", () => {
  it("selects high narrow and middle wide melodies after finishing and MIDI export", () => {
    let narrow = 0, wide = 0, mixed = 0
    const rows: unknown[] = []
    for (const seed of seeds) {
      const character = planMelodyCharacter({ seed, chords, tempo: 100, style: "cinematic", role: "chorus", range: { low: 60, high: 79 } })
      const batch = generateFromChordsWithProfiles({ chords, sectionId: "s1", sectionRole: "chorus", key: "Am",
        songProfile: "original-custom", density: "balanced", drama: "open", range: character.range,
        totalBeats: 32, seed, profiles: ["standard"], melodyCharacter: character })
      expect(batch.candidates).toHaveLength(3)
      const dimensions = batch.candidates.map((c) => {
        const midi = parseMidi(exportMelodyMidi({ title: "Register", sectionName: "s1", tempo: 100,
          timeSignature: "4/4", chords, melodyNotes: c.notes, includeChords: false }))
        const pitches = midi.tracks.flatMap((t) => t.notes).map((n) => n.pitch)
        expect(pitches).toEqual(c.notes.map((n) => n.pitch))
        const plan = candidateMelodyRegister(character, c.generationDiagnostics!.candidatePoolIndex)
        expect(Math.min(...pitches)).toBeGreaterThanOrEqual(plan.range.low)
        expect(Math.max(...pitches)).toBeLessThanOrEqual(plan.range.high)
        return { low: Math.min(...pitches), high: Math.max(...pitches), span: Math.max(...pitches) - Math.min(...pitches), pool: c.generationDiagnostics!.candidatePoolIndex }
      })
      const highNarrow = dimensions.filter((d) => d.span <= 8 && (d.low + d.high) / 2 >= 73).length
      const middleWide = dimensions.filter((d) => d.span >= 10 && (d.low + d.high) / 2 <= 72).length
      narrow += highNarrow; wide += middleWide
      if (highNarrow && middleWide) mixed++
      rows.push({ seed, dimensions })
    }
    if (process.env.REFERENCE_DE_REGISTER_REPORT) writeFileSync(process.env.REFERENCE_DE_REGISTER_REPORT, JSON.stringify({ seeds, register: rows, narrow, wide, mixed }, null, 2) + "\n")
    expect(narrow).toBeGreaterThan(0)
    expect(wide).toBeGreaterThan(0)
    expect(mixed).toBeGreaterThan(0)
  }, 60_000)
})
