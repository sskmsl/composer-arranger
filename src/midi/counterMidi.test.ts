import { describe, expect, it } from "vitest"
import { exportMelodyMidi } from "./exportMelody"

describe("Issue #70 / Counter MIDI export", () => {
  it("Active Melodyとは別のSoftware Instrument用トラックとして書き出す", () => {
    const bytes = exportMelodyMidi({
      title: "Counter Test",
      sectionName: "Verse Counter",
      tempo: 96,
      timeSignature: "4/4",
      chords: [],
      melodyNotes: [
        {
          id: "melody",
          startBeat: 0,
          durationBeats: 1,
          pitch: 69,
          velocity: 80,
          locks: [],
        },
      ],
      reactiveNotes: [
        {
          id: "counter",
          startBeat: 1,
          durationBeats: 0.5,
          pitch: 57,
          velocity: 60,
          locks: [],
        },
      ],
      includeChords: false,
    })
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("Active Melody")
    expect(text).toContain("Counter Melody")
  })
})
