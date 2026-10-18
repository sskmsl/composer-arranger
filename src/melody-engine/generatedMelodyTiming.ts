import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { parseChordSymbol } from "@/core/chord"

export const MINIMUM_GENERATED_MELODY_BEATS = .1

/** 新規生成だけに使用。完全同時の主旋律は和声音を優先し、元の候補には触れない。 */
export function mergeCoincidentMelodyNotes(source: readonly MelodyNote[], chords: readonly ChordEvent[]): MelodyNote[] {
  const result: MelodyNote[] = []
  for (const note of [...source].sort((a, b) => a.startBeat - b.startBeat)) {
    const previous = result.at(-1)
    if (!previous || Math.abs(previous.startBeat - note.startBeat) > 1e-9) {
      result.push({ ...note })
      continue
    }
    const chord = chords.find((c) => note.startBeat >= c.startBeat && note.startBeat < c.startBeat + c.durationBeats)
    const parsed = chord && parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    // 同じ入口なので拍の強弱は共通。和声の役割→固定した音→演奏上の強さの順。
    const priority = (n: MelodyNote) => (parsed && (parsed.bassPc === n.pitch % 12 || parsed.tones.some((t) => t.pitchClass === n.pitch % 12)) ? 1000 : 0)
      + (n.locks.includes("pitch") ? 200 : 0) + n.velocity
    if (priority(note) > priority(previous)) result[result.length - 1] = { ...note }
  }
  return result
}
