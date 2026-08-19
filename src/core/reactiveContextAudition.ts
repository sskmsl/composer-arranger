import { accompanimentPatternNotesForSection } from "./accompanimentPattern"
import type { MelodyNote } from "./melody"
import type { ComposerProject } from "./project"
import type { ReactiveLayerCandidate } from "./reactiveLayer"
import { decorationStructureFingerprint } from "./reactiveLayer"
import { notesByPartRole } from "./sectionLayers"
import { normalizeSectionTimeline } from "./sectionTimeline"
import { parseTimeSignature } from "./section"

export interface ReactiveContextAuditionMaterial {
  melody: MelodyNote[]
  accompaniment: MelodyNote[]
  reactive: MelodyNote[]
  includedActiveLayerNames: string[]
}

function activeOtherReactiveLayer(
  project: ComposerProject,
  sectionId: string,
  candidate: ReactiveLayerCandidate,
): ReactiveLayerCandidate | null {
  const activeId = candidate.kind === "counter"
    ? project.sectionDecorationLayerAssignments?.[sectionId]
    : project.sectionReactiveLayerAssignments?.[sectionId]
  const active = project.reactiveLayerCandidates?.find(
    (item) =>
      item.id === activeId &&
      item.sectionId === sectionId &&
      item.kind !== candidate.kind,
  )
  if (!active) return null
  const activeMelodyId = project.sectionMelodyAssignments[sectionId]
  if (
    active.kind === "counter" &&
    active.targetMelodyVariantId !== activeMelodyId
  ) {
    return null
  }
  if (active.kind === "decoration") {
    const timeline = normalizeSectionTimeline(project.sections)
    const sectionIndex = timeline.findIndex((section) => section.id === sectionId)
    const section = timeline[sectionIndex]
    if (!section) return null
    const previousSection = timeline[sectionIndex - 1]
    const nextSection = timeline[sectionIndex + 1]
    const nextSectionFirstChord = nextSection
      ? project.chords
          .filter((chord) => chord.sectionId === nextSection.id)
          .sort((left, right) => left.startBeat - right.startBeat)[0]?.symbol
      : undefined
    const fingerprint = decorationStructureFingerprint({
      sectionId,
      sectionRole: section.role,
      chords: project.chords
        .filter((chord) => chord.sectionId === sectionId)
        .sort((left, right) => left.startBeat - right.startBeat),
      totalBeats:
        section.lengthBars *
        parseTimeSignature(project.song.timeSignature).beatsPerBar,
      previousSectionRole: previousSection?.role,
      nextSectionRole: nextSection?.role,
      nextSectionFirstChord,
      isLastSection: !nextSection,
    })
    if (active.structureFingerprint !== fingerprint) return null
  }
  return active
}

export function buildReactiveContextAuditionMaterial(
  project: ComposerProject,
  sectionId: string,
  candidate: ReactiveLayerCandidate,
): ReactiveContextAuditionMaterial {
  const activeMelodyId = project.sectionMelodyAssignments[sectionId]
  const activeMelody = project.melodyVariants.find(
    (variant) =>
      variant.id === activeMelodyId && variant.sectionId === sectionId,
  )
  const melody = activeMelody
    ? notesByPartRole(activeMelody, "lead")
    : []
  const accompaniment = [
    ...(activeMelody
      ? notesByPartRole(activeMelody, "accompaniment")
      : []),
    ...accompanimentPatternNotesForSection(project, sectionId, melody),
  ]
  const activeOther = activeOtherReactiveLayer(project, sectionId, candidate)
  return {
    melody,
    accompaniment,
    reactive: [
      ...(activeOther?.notes ?? []),
      ...candidate.notes,
    ].sort(
      (left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch,
    ),
    includedActiveLayerNames: activeOther ? [activeOther.name] : [],
  }
}
