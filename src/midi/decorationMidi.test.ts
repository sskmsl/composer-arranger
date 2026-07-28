import { describe, expect, it } from "vitest"
import { exportMelodyMidi } from "./exportMelody"

describe("Issue #71 / Decoration MIDI", () => {
  it("Melody必須にせずDecoration専用トラックを書き出す", () => {
    const bytes = exportMelodyMidi({
      title: "Decoration",
      sectionName: "Transition",
      tempo: 96,
      timeSignature: "4/4",
      chords: [],
      includeChords: false,
      includeLeadTrack: false,
      reactiveTrackName: "Decoration",
      reactiveNotes: [
        {
          id: "decoration",
          startBeat: 14,
          durationBeats: 0.5,
          pitch: 71,
          velocity: 64,
          locks: [],
        },
      ],
    })
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("Decoration")
    expect(text).not.toContain("Active Melody")
  })
})
