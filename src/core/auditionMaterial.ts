import type { MelodyNote, MelodyVariant } from "./melody"
import type { ComposerProject } from "./project"
import { parseTimeSignature } from "./section"
import { notesByPartRole } from "./sectionLayers"

/** Imported MIDIの変換済みVariantが空でも、保存済み原Melodyを試聴に使う。 */
export function leadNotesForAudition(
  project: ComposerProject,
  sectionId: string,
  variant?: MelodyVariant,
): MelodyNote[] {
  const variantLead = variant ? notesByPartRole(variant, "lead") : []
  if (variantLead.length > 0) return variantLead

  const section = project.sections.find((candidate) => candidate.id === sectionId)
  const imported = project.importedArrangement
  if (!section || !imported) return variant?.notes ?? []

  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const sectionStart = (section.startBar - 1) * beatsPerBar
  const sectionEnd = sectionStart + section.lengthBars * beatsPerBar
  return imported.tracks
    .filter((track) => track.role === "melody")
    .flatMap((track, trackIndex) => track.notes.flatMap((note, noteIndex) => {
      const start = Math.max(sectionStart, note[0])
      const end = Math.min(sectionEnd, note[0] + note[1])
      if (end <= start) return []
      return [{
        id: `imported-audition:${trackIndex}:${noteIndex}`,
        startBeat: Number((start - sectionStart).toFixed(4)),
        durationBeats: Number((end - start).toFixed(4)),
        pitch: note[2],
        velocity: note[3],
        locks: [],
      } satisfies MelodyNote]
    }))
    .sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch)
}

/** 長いImported Songは、主旋律が聞こえる位置から最大8小節だけを即時試聴する。 */
export function immediateAuditionRange(
  notes: MelodyNote[],
  totalBeats: number,
  beatsPerBar: number,
  maximumBars = 8,
): { startBeat: number; endBeat: number } {
  if (totalBeats <= 0) return { startBeat: 0, endBeat: 0 }
  const maximumBeats = Math.max(beatsPerBar, beatsPerBar * maximumBars)
  if (totalBeats <= maximumBeats) return { startBeat: 0, endBeat: totalBeats }

  const firstNoteBeat = notes.length > 0
    ? Math.min(...notes.map((note) => note.startBeat))
    : 0
  const startBeat = Math.max(0, Math.floor(firstNoteBeat / beatsPerBar) * beatsPerBar)
  return { startBeat, endBeat: Math.min(totalBeats, startBeat + maximumBeats) }
}
