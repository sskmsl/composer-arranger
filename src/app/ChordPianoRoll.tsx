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
      title="コードの響き"
      subtitle="ベース＋上の音 · 表示のみ · MIDI書き出しと同じ"
      accentColor="#7667c7"
      accentStroke="#b4a9ff"
      ariaLabel="コードの響きのピアノロール"
      noteLabel="コードの響き"
      // Issue #59: Bass(C2付近)+Upper(B3〜)の配置で常に3.5〜4.5オクターブに及ぶため、
      // Melody/Accompanimentより広い上限にしないと典型的な進行でも内部スクロールが残る。
      maxHeight="min(58vh, 520px)"
    />
  )
}
