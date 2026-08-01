import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import { generateSignaturePhraseCandidates } from "@/phrase-engine/generateSignaturePhrases"
import { exportMelodyMidi } from "./exportMelody"

describe("Signature Phrase MIDI export", () => {
  it("生成候補を専用Software Instrumentトラックとして書き出せる", () => {
    const chords = parseChordInputText(
      "Am(add9) | D#dim",
      "s1",
      4,
      "signature-midi",
    )
    const candidate = generateSignaturePhraseCandidates({
      chords,
      sectionId: "s1",
      sectionRole: "intro",
      songProfile: "original-custom",
      density: "balanced",
      drama: "growing",
      range: { low: 60, high: 79 },
      key: "Am",
      beatsPerBar: 4,
      totalBeats: 8,
      seed: 8181,
      lengthBars: 2,
    })[0]
    const bytes = exportMelodyMidi({
      title: "Signature Test",
      sectionName: "Intro Signature Phrase",
      tempo: 96,
      timeSignature: "4/4",
      chords,
      melodyNotes: candidate.notes,
      leadTrackName: "Signature Phrase",
      includeChords: false,
      range: { startBeat: 0, endBeat: 8 },
    })
    const decoded = new TextDecoder().decode(bytes)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(decoded).toContain("Signature Phrase")
    expect(decoded).toContain("Intro Signature Phrase")
  })
})
