import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { exportMelodyMidi } from "./exportMelody"

describe("Phrase MIDI export", () => {
  it("Melody Variantへ昇格させずPhrase専用トラックとして書き出せる", () => {
    const notes: MelodyNote[] = [
      { id: "a", startBeat: 0.5, durationBeats: 0.5, pitch: 69, velocity: 84, locks: [] },
      { id: "b", startBeat: 1, durationBeats: 1, pitch: 72, velocity: 88, locks: [] },
    ]
    const bytes = exportMelodyMidi({
      title: "Phrase Test",
      sectionName: "Verse Phrase",
      tempo: 96,
      timeSignature: "4/4",
      chords: [],
      melodyNotes: notes,
      leadTrackName: "Phrase",
      includeChords: false,
      range: { startBeat: 0, endBeat: 8 },
    })
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(new TextDecoder().decode(bytes)).toContain("Phrase")
  })
})
