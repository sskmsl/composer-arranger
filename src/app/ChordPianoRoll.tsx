import { useMemo } from "react"
import type { ChordEvent } from "@/core/project"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"
import { chordVoicingNotes } from "./chordVoicingNotes"

export function ChordPianoRoll({
  chords,
  totalBeats,
  timeSignature,
  songKey,
}: {
  chords: ChordEvent[]
  totalBeats: number
  timeSignature: string
  songKey?: string
}) {
  const notes = useMemo(() => chordVoicingNotes(chords), [chords])

  return (
    <ReadOnlyPianoRoll
      notes={notes}
      chords={chords}
      totalBeats={totalBeats}
      timeSignature={timeSignature}
      songKey={songKey}
      title="Chord Voicing"
      subtitle="Bass＋Upper Notes · 表示専用 · MIDI出力と同一"
      accentColor="#7667c7"
      accentStroke="#b4a9ff"
      ariaLabel="Chord Voicing Piano Roll"
      noteLabel="Chord Voicing"
    />
  )
}
