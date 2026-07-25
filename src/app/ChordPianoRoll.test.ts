import { describe, expect, it } from "vitest"
import { parseChordSymbol } from "@/core/chord"
import type { ChordEvent } from "@/core/project"
import { voiceChord } from "@/audio/chordVoicing"
import { chordVoicingNotes } from "./chordVoicingNotes"

describe("ChordPianoRoll", () => {
  it("再生・MIDIと同じvoiceChordのBass＋Upper Notesを同じ位置と長さで表示する", () => {
    const chord: ChordEvent = {
      id: "c1",
      sectionId: "s1",
      startBeat: 4,
      durationBeats: 3,
      symbol: "Am(add9)",
      bass: null,
    }
    const expected = voiceChord(parseChordSymbol(chord.symbol)!)
    const notes = chordVoicingNotes([chord])

    expect(notes.map((note) => note.pitch)).toEqual([expected.bassMidi, ...expected.upperMidi])
    expect(notes.every((note) => note.startBeat === 4 && note.durationBeats === 3)).toBe(true)
    expect(new Set(notes.map((note) => note.id)).size).toBe(notes.length)
  })

  it("解釈できないコードはノート表示へ混入させない", () => {
    const invalid: ChordEvent = {
      id: "invalid",
      sectionId: "s1",
      startBeat: 0,
      durationBeats: 4,
      symbol: "?",
      bass: null,
    }
    expect(chordVoicingNotes([invalid])).toEqual([])
  })
})
