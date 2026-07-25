import type { ChordEvent, ComposerProject } from "./project"
import type { MelodyNote, MelodyVariant } from "./melody"
import type { Section } from "./section"
import { parseTimeSignature } from "./section"

/** 配列順を曲順として扱い、startBarを1始まりで隙間なく再計算する。 */
export function normalizeSectionTimeline(sections: Section[]): Section[] {
  let startBar = 1
  return sections.map((section) => {
    const normalized = { ...section, startBar }
    startBar += Math.max(1, section.lengthBars)
    return normalized
  })
}

export function moveSectionInTimeline(sections: Section[], sectionId: string, targetIndex: number): Section[] {
  const sourceIndex = sections.findIndex((section) => section.id === sectionId)
  if (sourceIndex < 0) return normalizeSectionTimeline(sections)
  const boundedTarget = Math.max(0, Math.min(sections.length - 1, targetIndex))
  const reordered = [...sections]
  const [moved] = reordered.splice(sourceIndex, 1)
  reordered.splice(boundedTarget, 0, moved)
  return normalizeSectionTimeline(reordered)
}

export interface SongPlaybackMaterial {
  chords: ChordEvent[]
  melody: MelodyNote[]
  totalBeats: number
}

/** セクション相対イベントを曲全体の絶対拍へ変換する。 */
export function buildSongPlaybackMaterial(project: ComposerProject): SongPlaybackMaterial {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const chords: ChordEvent[] = []
  const melody: MelodyNote[] = []

  for (const section of normalizeSectionTimeline(project.sections)) {
    const offset = (section.startBar - 1) * beatsPerBar
    for (const chord of project.chords.filter((candidate) => candidate.sectionId === section.id)) {
      chords.push({ ...chord, startBeat: offset + chord.startBeat })
    }
    const variantId = project.sectionMelodyAssignments[section.id]
    const variant = variantId
      ? project.melodyVariants.find((candidate) => candidate.id === variantId && candidate.sectionId === section.id)
      : undefined
    for (const note of variant?.notes ?? []) {
      melody.push({ ...note, id: `${section.id}:${note.id}`, startBeat: offset + note.startBeat })
    }
  }

  const totalBars = project.sections.reduce((sum, section) => sum + Math.max(1, section.lengthBars), 0)
  return {
    chords: chords.sort((a, b) => a.startBeat - b.startBeat),
    melody: melody.sort((a, b) => a.startBeat - b.startBeat),
    totalBeats: totalBars * beatsPerBar,
  }
}

export function assignedVariantForSection(project: ComposerProject, sectionId: string): MelodyVariant | undefined {
  const assignedId = project.sectionMelodyAssignments[sectionId]
  if (!assignedId) return undefined
  return project.melodyVariants.find((variant) => variant.id === assignedId && variant.sectionId === sectionId)
}
