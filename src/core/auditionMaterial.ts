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

/**
 * A/B/C比較では、IDや表示名が違っても実際に鳴る音が同じ候補を重ねて表示しない。
 * Imported MIDIの旧データには、同一演奏を指すVariantが複数残っている場合がある。
 */
export function distinctMelodyVariantsForAudition(
  project: ComposerProject,
  sectionId: string,
  variants: readonly MelodyVariant[],
): MelodyVariant[] {
  const fingerprints = new Set<string>()
  return variants.filter((variant) => {
    const fingerprint = leadNotesForAudition(project, sectionId, variant)
      .map((note) => [
        Number(note.startBeat.toFixed(4)),
        Number(note.durationBeats.toFixed(4)),
        note.pitch,
      ].join(":"))
      .join("|")
    if (fingerprints.has(fingerprint)) return false
    fingerprints.add(fingerprint)
    return true
  })
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
