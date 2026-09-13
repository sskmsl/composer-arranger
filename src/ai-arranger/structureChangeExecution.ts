import type { ArrangementStructureChange } from "@/core/arrangementGeneration"
import type { ComposerProject, ImportedArrangementNote } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { useProjectStore } from "@/store/useProjectStore"
import { arrangementStructureChangesFingerprint } from "./structureChanges"

function trimChangedSectionMaterial(project: ComposerProject): ComposerProject {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const endBeatBySection = new Map(
    project.sections.map((section) => [section.id, section.lengthBars * beatsPerBar]),
  )
  const trimNotes = <T extends { sectionId: string; notes: Array<{ startBeat: number; durationBeats: number }> }>(
    candidates: readonly T[],
  ): T[] => candidates.map((candidate) => {
    const endBeat = endBeatBySection.get(candidate.sectionId)
    if (endBeat === undefined) return candidate
    const trim = <N extends { startBeat: number; durationBeats: number }>(notes: readonly N[]): N[] => notes
      .filter((note) => note.startBeat < endBeat)
      .map((note) => ({
        ...note,
        durationBeats: Math.max(0.01, Math.min(note.durationBeats, endBeat - note.startBeat)),
      }))
    return {
      ...candidate,
      notes: trim(candidate.notes),
      ...("layers" in candidate && Array.isArray(candidate.layers)
        ? {
            layers: candidate.layers.map((layer) => ({
              ...layer,
              notes: trim(layer.notes),
            })),
          }
        : {}),
    }
  })

  return {
    ...project,
    chords: project.chords.flatMap((chord) => {
      const endBeat = endBeatBySection.get(chord.sectionId)
      if (endBeat === undefined || chord.startBeat >= endBeat) return []
      return [{
        ...chord,
        durationBeats: Math.max(0.01, Math.min(chord.durationBeats, endBeat - chord.startBeat)),
      }]
    }),
    melodyVariants: trimNotes(project.melodyVariants),
    phraseCandidates: trimNotes(project.phraseCandidates),
    signaturePhraseCandidates: trimNotes(project.signaturePhraseCandidates),
    reactiveLayerCandidates: trimNotes(project.reactiveLayerCandidates ?? []),
  }
}

function remapImportedArrangement(
  original: ComposerProject,
  changed: ComposerProject,
  sourceSectionById: ReadonlyMap<string, string>,
): ComposerProject["importedArrangement"] {
  if (!original.importedArrangement) return changed.importedArrangement
  const beatsPerBar = parseTimeSignature(original.song.timeSignature).beatsPerBar
  const originalSections = new Map(original.sections.map((section) => [section.id, section]))
  const copyTrackNotes = (notes: readonly ImportedArrangementNote[]): ImportedArrangementNote[] =>
    changed.sections.flatMap((section) => {
      const sourceId = sourceSectionById.get(section.id) ?? section.id
      const source = originalSections.get(sourceId)
      if (!source) return []
      const sourceStart = (source.startBar - 1) * beatsPerBar
      const sourceLength = source.lengthBars * beatsPerBar
      const targetStart = (section.startBar - 1) * beatsPerBar
      const copyLength = Math.min(sourceLength, section.lengthBars * beatsPerBar)
      return notes.flatMap((note): ImportedArrangementNote[] => {
        const clippedStart = Math.max(sourceStart, note[0])
        const clippedEnd = Math.min(sourceStart + copyLength, note[0] + note[1])
        if (clippedEnd <= clippedStart) return []
        return [[
          targetStart + clippedStart - sourceStart,
          clippedEnd - clippedStart,
          note[2],
          note[3],
          note[4],
        ]]
      })
    }).sort((left, right) => left[0] - right[0] || left[2] - right[2])

  const totalBeats = changed.sections.reduce(
    (sum, section) => sum + Math.max(1, section.lengthBars) * beatsPerBar,
    0,
  )
  return {
    ...original.importedArrangement,
    totalBeats,
    tracks: original.importedArrangement.tracks.map((track) => ({
      ...track,
      notes: copyTrackNotes(track.notes),
    })),
  }
}

/**
 * 解析済みのSection変更を既存Store操作で適用し、履歴は一操作へまとめる。
 * Imported MIDIは絶対時刻なので、変更後のSection順へ実ノートも再配置する。
 */
export function executeArrangementStructureChanges(
  changes: readonly ArrangementStructureChange[],
  previouslyApplied?: readonly ArrangementStructureChange[],
): { applied: ArrangementStructureChange[]; skipped: boolean } {
  if (changes.length === 0) return { applied: [], skipped: true }
  if (arrangementStructureChangesFingerprint(changes) === arrangementStructureChangesFingerprint(previouslyApplied)) {
    return { applied: [], skipped: true }
  }

  const initialState = useProjectStore.getState()
  const originalProject = structuredClone(initialState.project)
  const originalHistory = [...initialState.history]
  const sourceSectionById = new Map(originalProject.sections.map((section) => [section.id, section.id]))
  const applied: ArrangementStructureChange[] = []

  for (const change of changes) {
    const state = useProjectStore.getState()
    if (!state.project.sections.some((section) => section.id === change.sectionId)) continue
    if (change.kind === "resize-section") {
      state.updateSection(change.sectionId, { lengthBars: change.lengthBars })
      applied.push(change)
      continue
    }
    if (change.kind === "remove-section") {
      if (state.project.sections.length <= 1) continue
      state.removeSection(change.sectionId)
      applied.push(change)
      continue
    }
    if (change.kind === "duplicate-section") {
      let insertionIndex = state.project.sections.findIndex((section) => section.id === change.sectionId) + 1
      for (let index = 0; index < change.copies; index += 1) {
        const beforeIds = new Set(useProjectStore.getState().project.sections.map((section) => section.id))
        useProjectStore.getState().duplicateSection(change.sectionId)
        const duplicateId = useProjectStore.getState().project.sections.find((section) => !beforeIds.has(section.id))?.id
        if (!duplicateId) continue
        sourceSectionById.set(duplicateId, sourceSectionById.get(change.sectionId) ?? change.sectionId)
        useProjectStore.getState().moveSection(duplicateId, insertionIndex)
        insertionIndex += 1
      }
      applied.push(change)
      continue
    }
    const currentSections = state.project.sections
    const anchorIndex = currentSections.findIndex((section) => section.id === change.anchorSectionId)
    if (anchorIndex < 0) continue
    const sourceIndex = currentSections.findIndex((section) => section.id === change.sectionId)
    let targetIndex = change.position === "before" ? anchorIndex : anchorIndex + 1
    if (sourceIndex < targetIndex) targetIndex -= 1
    state.moveSection(change.sectionId, targetIndex)
    applied.push(change)
  }

  if (applied.length === 0) return { applied: [], skipped: true }
  const currentState = useProjectStore.getState()
  const project = trimChangedSectionMaterial({
    ...currentState.project,
    importedArrangement: remapImportedArrangement(originalProject, currentState.project, sourceSectionById),
    fullSongArrangement: undefined,
  })
  useProjectStore.setState({
    project,
    history: [...originalHistory, originalProject],
    future: [],
  })
  useProjectStore.getState().persist()
  return { applied, skipped: false }
}
