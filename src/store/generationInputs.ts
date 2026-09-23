/**
 * プロジェクトの状態から、各生成エンジン(フレーズ・イントロ・対旋律・装飾など)への入力を組み立てる
 * 関数群。ストア(useProjectStore)の状態には触れない純粋な関数なので、ストア本体から分けている。
 */
import {
  effectiveSectionKey,
  effectiveSongProfile,
  type ComposerProject,
} from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import type {
  MelodyGeneratorProfile,
  MelodyNote,
} from "@/core/melody"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { RANGE_PRESETS, type Density, type Drama, type RangeSetting } from "@/melody-engine/generationParams"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import { notesByPartRole } from "@/core/sectionLayers"
import { accompanimentPatternNotesForSection } from "@/core/accompanimentPattern"
import type { PhraseLengthBars } from "@/core/phrase"
import type {
  SignatureGenerationDirection,
  SignaturePhraseLengthBars,
} from "@/core/signaturePhrase"
import { type GeneratePhrasesInput } from "@/phrase-engine/generatePhrases"
import { type GenerateSignaturePhrasesInput } from "@/phrase-engine/generateSignaturePhrases"
import { type ArrangementSurpriseContext } from "@/core/arrangementSurprise"
import {
  applyPerformanceExecution,
  buildDefaultPerformancePlan,
  type PerformanceSpec,
  type PerformanceExecutionPlan,
} from "@/core/performanceExecution"
import { type GenerateCounterInput } from "@/melody-engine/counterGenerator"
import {
  type DecorationSettings,
  type GenerateDecorationInput,
} from "@/melody-engine/decorationGenerator"

import {
  resolvePublicComposerRules,
  type TechniqueExperimentPresetId,
} from "@/composer-intelligence"

export type RangePreset = "low" | "middle" | "high" | "custom"

export interface GenerationSettings {
  density: Density
  rangePreset: RangePreset
  customRange: RangeSetting
  drama: Drama
  /** Melody Candidate Diversity v1.2: 有効化するGenerator Profile(未選択時はStandardのみ) */
  selectedGeneratorProfiles: MelodyGeneratorProfile[]
  /** セッション限定。Draft TechniqueのLifecycleは変更しない。 */
  techniqueExperimentPresetId: TechniqueExperimentPresetId | null
}

export function resolveRange(settings: GenerationSettings): RangeSetting {
  return settings.rangePreset === "custom" ? settings.customRange : RANGE_PRESETS[settings.rangePreset]
}

export function phraseGenerationInput(
  project: ComposerProject,
  sectionId: string,
  settings: GenerationSettings,
  seed: number,
  lengthBars?: PhraseLengthBars,
): GeneratePhrasesInput | null {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return null
  const timeSignature = parseTimeSignature(project.song.timeSignature)
  const totalBeats = section.lengthBars * timeSignature.beatsPerBar
  const chords = project.chords
    .filter((chord) => chord.sectionId === sectionId)
    .sort((a, b) => a.startBeat - b.startBeat)
  if (
    chords.length === 0 ||
    section.lengthBars < 2 ||
    diagnoseChordInput(chords, totalBeats).hasError
  ) {
    return null
  }
  return {
    chords,
    sectionId,
    sectionRole: section.role,
    songProfile: effectiveSongProfile(project, sectionId),
    density: settings.density,
    drama: settings.drama,
    range: resolveRange(settings),
    key: effectiveSectionKey(project, sectionId),
    beatsPerBar: timeSignature.beatsPerBar,
    totalBeats,
    seed,
    lengthBars,
    composerRules: resolvePublicComposerRules({
      generatorTarget: "phrase",
      sectionRole: section.role,
    }),
  }
}

export function signaturePhraseGenerationInput(
  project: ComposerProject,
  sectionId: string,
  settings: GenerationSettings,
  seed: number,
  lengthBars?: SignaturePhraseLengthBars,
  direction?: SignatureGenerationDirection,
): GenerateSignaturePhrasesInput | null {
  const section = project.sections.find(
    (candidate) => candidate.id === sectionId,
  )
  if (!section) return null
  const { beatsPerBar } = parseTimeSignature(
    project.song.timeSignature,
  )
  const totalBeats = section.lengthBars * beatsPerBar
  const chords = project.chords
    .filter((chord) => chord.sectionId === sectionId)
    .sort((left, right) => left.startBeat - right.startBeat)
  const activeMelodyId = project.sectionMelodyAssignments[sectionId]
  const activeMelody = project.melodyVariants.find(
    (candidate) =>
      candidate.id === activeMelodyId && candidate.sectionId === sectionId,
  )
  const resolvedLength =
    lengthBars ?? (section.lengthBars >= 2 ? 2 : 1)
  if (
    chords.length === 0 ||
    section.lengthBars < resolvedLength ||
    diagnoseChordInput(chords, totalBeats).hasError
  ) {
    return null
  }
  return {
    chords,
    referenceMelody: activeMelody?.notes ?? [],
    sectionId,
    sectionRole: section.role,
    songProfile: effectiveSongProfile(project, sectionId),
    density: settings.density,
    drama: settings.drama,
    range: resolveRange(settings),
    key: effectiveSectionKey(project, sectionId),
    beatsPerBar,
    totalBeats,
    seed,
    lengthBars: resolvedLength,
    finalCandidateCount: 12,
    candidatePoolSize: 72,
    direction,
  }
}

export function counterGenerationInput(
  project: ComposerProject,
  sectionId: string,
  seed: number,
): GenerateCounterInput | null {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  const melodyId = project.sectionMelodyAssignments[sectionId]
  const melody = project.melodyVariants.find(
    (candidate) => candidate.id === melodyId && candidate.sectionId === sectionId,
  )
  if (!section || !melody || melody.notes.length === 0) return null
  const { beatsPerBar } = parseTimeSignature(project.song.timeSignature)
  const totalBeats = section.lengthBars * beatsPerBar
  const chords = project.chords
    .filter((chord) => chord.sectionId === sectionId)
    .sort((a, b) => a.startBeat - b.startBeat)
  if (chords.length === 0 || diagnoseChordInput(chords, totalBeats).hasError) return null
  const activeDecorationId =
    project.sectionDecorationLayerAssignments?.[sectionId]
  const activeDecoration = project.reactiveLayerCandidates?.find(
    (candidate) =>
      candidate.id === activeDecorationId &&
      candidate.sectionId === sectionId &&
      candidate.kind === "decoration",
  )
  return {
    sectionId,
    sectionRole: section.role,
    songProfile: effectiveSongProfile(project, sectionId),
    key: effectiveSectionKey(project, sectionId),
    chords,
    melody,
    totalBeats,
    seed,
    existingSupportNotes: [
      ...notesByPartRole(melody, "accompaniment"),
      ...accompanimentPatternNotesForSection(
        project,
        sectionId,
        notesByPartRole(melody, "lead"),
      ),
      ...(activeDecoration?.notes ?? []),
    ],
    existingReactiveLayers: activeDecoration ? [activeDecoration] : [],
    composerRules: resolvePublicComposerRules({
      generatorTarget: "counter",
      sectionRole: section.role,
    }),
  }
}

export function arrangementSurpriseContext(
  project: ComposerProject,
  sectionId: string,
  melodyNotes: MelodyNote[],
  existingSupportNoteCount = 0,
): ArrangementSurpriseContext | null {
  const timeline = normalizeSectionTimeline(project.sections)
  const sectionIndex = timeline.findIndex((section) => section.id === sectionId)
  const section = timeline[sectionIndex]
  if (!section) return null
  const nextSection = timeline[sectionIndex + 1]
  const nextSectionFirstChord = nextSection
    ? project.chords
        .filter((chord) => chord.sectionId === nextSection.id)
        .sort((left, right) => left.startBeat - right.startBeat)[0]?.symbol
    : undefined
  const { beatsPerBar } = parseTimeSignature(project.song.timeSignature)
  return {
    chords: project.chords
      .filter((chord) => chord.sectionId === sectionId)
      .sort((left, right) => left.startBeat - right.startBeat),
    melodyNotes,
    totalBeats: section.lengthBars * beatsPerBar,
    sectionRole: section.role,
    nextSectionRole: nextSection?.role,
    nextSectionFirstChord,
    existingSupportNoteCount,
  }
}

export function decorationGenerationInput(
  project: ComposerProject,
  sectionId: string,
  seed: number,
  settings: DecorationSettings,
): GenerateDecorationInput | null {
  const timeline = normalizeSectionTimeline(project.sections)
  const sectionIndex = timeline.findIndex((candidate) => candidate.id === sectionId)
  const section = timeline[sectionIndex]
  if (!section) return null
  const { beatsPerBar } = parseTimeSignature(project.song.timeSignature)
  const totalBeats = section.lengthBars * beatsPerBar
  const chords = project.chords
    .filter((chord) => chord.sectionId === sectionId)
    .sort((a, b) => a.startBeat - b.startBeat)
  if (chords.length === 0 || diagnoseChordInput(chords, totalBeats).hasError) return null
  const previousSection = sectionIndex > 0 ? timeline[sectionIndex - 1] : undefined
  const nextSection = timeline[sectionIndex + 1]
  const nextSectionFirstChord = nextSection
    ? project.chords
        .filter((chord) => chord.sectionId === nextSection.id)
        .sort((a, b) => a.startBeat - b.startBeat)[0]?.symbol
    : undefined
  const activeMelodyId = project.sectionMelodyAssignments[sectionId]
  const activeMelody = project.melodyVariants.find(
    (variant) => variant.id === activeMelodyId && variant.sectionId === sectionId,
  )
  const reactiveCandidates = project.reactiveLayerCandidates ?? []
  const activeCounterId = project.sectionReactiveLayerAssignments?.[sectionId]
  const activeCounter = reactiveCandidates.find(
    (candidate) =>
      candidate.id === activeCounterId &&
      candidate.sectionId === sectionId &&
      candidate.kind === "counter" &&
      candidate.targetMelodyVariantId === activeMelody?.id,
  )
  const sectionArrangementNoteCount = (
    targetSectionId: string | undefined,
  ): number => {
    if (!targetSectionId) return 0
    const assignedIds = [
      project.sectionReactiveLayerAssignments?.[targetSectionId],
      project.sectionDecorationLayerAssignments?.[targetSectionId],
    ].filter((id): id is string => Boolean(id))
    const reactiveNoteCount = assignedIds.reduce(
      (sum, id) =>
        sum +
        (reactiveCandidates.find((candidate) => candidate.id === id)?.notes
          .length ?? 0),
      0,
    )
    const accompanimentEstimate =
      project.sectionAccompanimentPatternAssignments?.[targetSectionId]
        ? 4
        : 0
    return reactiveNoteCount + accompanimentEstimate
  }
  const favoritePlans = reactiveCandidates
    .flatMap((candidate) =>
      candidate.kind === "decoration" &&
      candidate.reviewState === "favorite" &&
      candidate.decorationPlan
        ? [candidate.decorationPlan]
        : [],
    )
  const rejectedPlans = reactiveCandidates
    .flatMap((candidate) =>
      candidate.kind === "decoration" &&
      candidate.reviewState === "rejected" &&
      candidate.decorationPlan
        ? [candidate.decorationPlan]
        : [],
    )
  return {
    sectionId,
    sectionRole: section.role,
    songProfile: effectiveSongProfile(project, sectionId),
    chords,
    totalBeats,
    beatsPerBar,
    key: effectiveSectionKey(project, sectionId),
    seed,
    settings,
    melodyNotes: activeMelody?.notes,
    existingSupportNotes: [
      ...(activeMelody
        ? notesByPartRole(activeMelody, "accompaniment")
        : []),
      ...accompanimentPatternNotesForSection(
        project,
        sectionId,
        activeMelody ? notesByPartRole(activeMelody, "lead") : [],
      ),
      ...(activeCounter?.notes ?? []),
    ],
    existingReactiveLayers: activeCounter ? [activeCounter] : [],
    previousSectionRole: previousSection?.role,
    nextSectionRole: nextSection?.role,
    nextSectionFirstChord,
    isLastSection: !nextSection,
    arrangementContext: {
      previousSectionNoteCount: sectionArrangementNoteCount(
        previousSection?.id,
      ),
      currentSectionNoteCount: sectionArrangementNoteCount(section.id),
      nextSectionNoteCount: sectionArrangementNoteCount(nextSection?.id),
    },
    preferenceProfile: {
      favoriteCharacters: [
        ...new Set(favoritePlans.map((plan) => plan.character)),
      ],
      favoriteShapes: [
        ...new Set(favoritePlans.map((plan) => plan.shape)),
      ],
      favoriteRhythms: [
        ...new Set(favoritePlans.map((plan) => plan.rhythmStyle)),
      ],
      rejectedCharacters: [
        ...new Set(rejectedPlans.map((plan) => plan.character)),
      ],
      rejectedShapes: [
        ...new Set(rejectedPlans.map((plan) => plan.shape)),
      ],
      rejectedRhythms: [
        ...new Set(rejectedPlans.map((plan) => plan.rhythmStyle)),
      ],
    },
    composerRules: resolvePublicComposerRules({
      generatorTarget: "decoration",
      sectionRole: section.role,
      transition: nextSection
        ? `${section.role}->${nextSection.role}`
        : undefined,
    }),
  }
}

export function performGeneratedNotes(
  project: ComposerProject,
  sectionId: string,
  notes: MelodyNote[],
  role: PerformanceExecutionPlan["role"],
): { notes: MelodyNote[]; performanceSpec: PerformanceSpec } {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const totalBeats = Math.max(0.25, (section?.lengthBars ?? 1) * beatsPerBar)
  const melodyId = project.sectionMelodyAssignments[sectionId]
  const melody = project.melodyVariants.find(
    (candidate) => candidate.id === melodyId && candidate.sectionId === sectionId,
  )
  const plan = buildDefaultPerformancePlan(role, section?.role)
  const result = applyPerformanceExecution(notes, plan, {
    totalBeats,
    beatsPerBar,
    bpm: project.song.tempo,
    chordBoundaryBeats: project.chords
      .filter((chord) => chord.sectionId === sectionId)
      .map((chord) => chord.startBeat),
    melodyNotes: role === "counter-voice" ? melody?.notes : undefined,
  })
  return { notes: result.notes, performanceSpec: plan.performanceSpec }
}
