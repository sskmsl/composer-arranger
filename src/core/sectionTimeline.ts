import type { ChordEvent, ComposerProject } from "./project"
import type { MelodyNote, MelodyVariant } from "./melody"
import type { Section } from "./section"
import { parseTimeSignature } from "./section"
import { layersOf } from "./sectionLayers"
import { accompanimentEnabled } from "./sectionContent"
import { applyAccompanimentPattern } from "./accompanimentPattern"

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
  /** 再生用: lead と accompaniment を合わせた全ノート */
  melody: MelodyNote[]
  /** Issue #41: MIDIのトラック分割用に partRole ごとへ分けたノート */
  lead: MelodyNote[]
  accompaniment: MelodyNote[]
  /** Issue #45: コードから導出した独立Accompaniment Patternレイヤー。 */
  accompanimentPattern: MelodyNote[]
  totalBeats: number
}

/** セクション相対イベントを曲全体の絶対拍へ変換する。 */
export function buildSongPlaybackMaterial(project: ComposerProject): SongPlaybackMaterial {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const chords: ChordEvent[] = []
  const lead: MelodyNote[] = []
  const accompaniment: MelodyNote[] = []
  const accompanimentPattern: MelodyNote[] = []

  for (const section of normalizeSectionTimeline(project.sections)) {
    const offset = (section.startBar - 1) * beatsPerBar
    const sectionChords = project.chords
      .filter((candidate) => candidate.sectionId === section.id)
      .sort((a, b) => a.startBeat - b.startBeat)
    // Issue #41: accompaniment="none"(Silence)のセクションは伴奏を鳴らさない。
    // ここで除外しないと Silence と Chords Only が曲全体再生・曲全体MIDIで同じ結果になる。
    if (accompanimentEnabled(section)) {
      for (const chord of sectionChords) {
        chords.push({ ...chord, startBeat: offset + chord.startBeat })
      }
    }
    const patternId = project.sectionAccompanimentPatternAssignments?.[section.id]
    const pattern = patternId
      ? project.accompanimentPatterns?.find((candidate) => candidate.id === patternId)
      : undefined
    if (pattern) {
      const patternNotes = applyAccompanimentPattern(
        pattern,
        sectionChords,
        section.lengthBars * beatsPerBar,
      )
      for (const note of patternNotes) {
        accompanimentPattern.push({
          ...note,
          id: `${section.id}:${note.id}`,
          startBeat: offset + note.startBeat,
        })
      }
    }
    const variantId = project.sectionMelodyAssignments[section.id]
    const variant = variantId
      ? project.melodyVariants.find((candidate) => candidate.id === variantId && candidate.sectionId === section.id)
      : undefined
    if (!variant) continue
    // Issue #41: partRoleの正はLayer。曲全体へ展開する際も役割ごとに分けて持つ
    for (const layer of layersOf(variant)) {
      const target = layer.partRole === "accompaniment" ? accompaniment : lead
      for (const note of layer.notes) {
        target.push({ ...note, id: `${section.id}:${note.id}`, startBeat: offset + note.startBeat })
      }
    }
  }

  const byBeat = (a: MelodyNote, b: MelodyNote) => a.startBeat - b.startBeat
  const totalBars = project.sections.reduce((sum, section) => sum + Math.max(1, section.lengthBars), 0)
  return {
    chords: chords.sort((a, b) => a.startBeat - b.startBeat),
    melody: [...lead, ...accompaniment].sort(byBeat),
    lead: lead.sort(byBeat),
    accompaniment: accompaniment.sort(byBeat),
    accompanimentPattern: accompanimentPattern.sort(byBeat),
    totalBeats: totalBars * beatsPerBar,
  }
}

export function assignedVariantForSection(project: ComposerProject, sectionId: string): MelodyVariant | undefined {
  const assignedId = project.sectionMelodyAssignments[sectionId]
  if (!assignedId) return undefined
  return project.melodyVariants.find((variant) => variant.id === assignedId && variant.sectionId === sectionId)
}
