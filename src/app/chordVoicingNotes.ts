import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { parseChordSymbol } from "@/core/chord"
import { voiceChord } from "@/audio/chordVoicing"

export function chordVoicingNotes(chords: ChordEvent[]): MelodyNote[] {
  return chords.flatMap((chord): MelodyNote[] => {
    const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    if (!parsed) return []
    const voicing = voiceChord(parsed)
    return [
      {
        id: `chord:${chord.id}:bass`,
        startBeat: chord.startBeat,
        durationBeats: chord.durationBeats,
        pitch: voicing.bassMidi,
        velocity: 70,
        locks: [],
      },
      ...voicing.upperMidi.map((pitch, index) => ({
        id: `chord:${chord.id}:upper:${index}`,
        startBeat: chord.startBeat,
        durationBeats: chord.durationBeats,
        pitch,
        velocity: 60,
        locks: [],
      })),
    ]
  })
}
