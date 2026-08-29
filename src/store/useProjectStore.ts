import { create } from "zustand"
import {
  createEmptyProject,
  effectiveSongProfile,
  type ArrangementDirectorSectionOverride,
  type ArrangementDirectorWorkspaceState,
  type OrchestrationPartOverride,
  type ComposerProject,
  type SongProfileId,
} from "@/core/project"
import type { Section, SectionRole } from "@/core/section"
import { parseTimeSignature } from "@/core/section"
import type {
  LockKind,
  MelodyGeneratorProfile,
  MelodyNote,
  MelodyVariant,
  RangeRegenerationLocks,
} from "@/core/melody"
import { parseChordInputText } from "@/core/chordInput"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { generateFromChordsWithProfiles, toMelodyVariantFromProfile } from "@/melody-engine/generateFromChords"
import { resolveGenerationParams, RANGE_PRESETS, type Density, type Drama, type RangeSetting } from "@/melody-engine/generationParams"
import { computeMelodyFeatures } from "@/melody-engine/features"
import { extractMotifDNA } from "@/melody-engine/motifDNA"
import { generateRangeRegenerationCandidates } from "@/melody-engine/rangeRegeneration"
import {
  seedContinue,
  seedExpand,
  seedAnswerPhrase,
  seedVariation,
  seedLift,
  seedRestrain,
  type SeedOperation,
} from "@/melody-engine/developSeed"
import { createSeed } from "@/core/rng"
import {
  saveProject,
  loadLastOpenedProject,
  loadProject as loadProjectById,
  backupProjectTimingSnapshot,
  duplicateProject as duplicateStoredProjectRepo,
  renameProject as renameStoredProjectRepo,
  deleteProject as deleteStoredProjectRepo,
} from "@/storage/projectRepository"
import { resolveProjectTiming, resolveAmbiguousTiming } from "@/core/timingMigration"
import { inferMarkerlessImportedSections } from "@/core/importedSectionInference"
import { moveSectionInTimeline, normalizeSectionTimeline } from "@/core/sectionTimeline"
import { DEFAULT_SECTION_CONTENT, LEAD_CONTENT_LABELS, type SectionContentSettings } from "@/core/sectionContent"
import {
  chorusPeakMidi,
  fallbackPlanFor,
  flattenLayerNotes,
  notesByPartRole,
  replaceVariantNotes,
  resolvedLeadContent,
} from "@/core/sectionLayers"
import { accompanimentPatternNotesForSection } from "@/core/accompanimentPattern"
import {
  generateMelodyPickupNotes,
  generateSectionContent,
  toMelodyVariantFromContent,
  usesContentPipeline,
} from "@/melody-engine/generateSectionContent"
import {
  chordsForWindow,
  isFullSectionWindow,
  leadWindowOf,
  shiftNotesToSection,
  windowLengthBeats,
} from "@/melody-engine/leadWindow"
import { applyProfileOverride, generatorProfileIntensity } from "@/melody-engine/generatorProfile"
import type { PhraseCandidate, PhraseLengthBars } from "@/core/phrase"
import type {
  SignaturePhraseCandidate,
  SignatureGenerationDirection,
  SignaturePhraseLengthBars,
} from "@/core/signaturePhrase"
import {
  generatePhraseCandidates,
  phraseTechniqueFitScore,
  regeneratePhraseCandidate as buildRegeneratedPhrase,
  type GeneratePhrasesInput,
} from "@/phrase-engine/generatePhrases"
import {
  generateSignaturePhraseCandidates,
  regenerateSignaturePhraseCandidate as buildRegeneratedSignaturePhrase,
  type GenerateSignaturePhrasesInput,
} from "@/phrase-engine/generateSignaturePhrases"
import { buildSectionTransitionContext } from "@/melody-engine/sectionTransition"
import type {
  CounterCreativeRisk,
  CounterGeneratorStyle,
  ReactiveLayerCandidate,
} from "@/core/reactiveLayer"
import {
  annotateArrangementApproaches,
  type ArrangementSurpriseContext,
} from "@/core/arrangementSurprise"
import type { AiPartnerSession, OrchestrationRole } from "@/ai-arranger/types"
import {
  analyzeMelodyActivity,
  assessReactiveLayerCollisions,
  evaluateReactiveLayerCompatibility,
} from "@/melody-engine/reactiveLayerAnalysis"
import {
  applyPerformanceExecution,
  reviewPerformanceExecution,
  type PerformanceExecutionPlan,
} from "@/core/performanceExecution"
import { recommendPerformedCandidate } from "@/core/performanceCandidateSelection"
import {
  COUNTER_CANDIDATE_CONFIG,
  counterTechniqueFitScore,
  generateCounterCandidates,
  regenerateCounterCandidate as buildRegeneratedCounter,
  type GenerateCounterInput,
} from "@/melody-engine/counterGenerator"
import {
  DEFAULT_DECORATION_SETTINGS,
  assessDecorationNeed,
  decorationTechniqueFitScore,
  decorationFingerprintForInput,
  generateDecorationCandidates,
  regenerateDecorationCandidate as buildRegeneratedDecoration,
  type DecorationSettings,
  type GenerateDecorationInput,
} from "@/melody-engine/decorationGenerator"

import {
  resolvePublicComposerRules,
  techniqueExperimentPreset,
  techniqueExperimentRules,
  type TechniqueExperimentPresetId,
} from "@/composer-intelligence"

const COUNTER_EXPERIMENT_CANDIDATES_PER_MODE = 5

export type RangePreset = "low" | "middle" | "high" | "custom"

/** Issue #16: 時間単位移行の状態をUIへ伝えるための通知 */
export type TimingNotice =
  | { kind: "auto-converted"; factor: number; timeSignature: string }
  | { kind: "ambiguous"; timeSignature: string; reason: string }

interface GenerationSettings {
  density: Density
  rangePreset: RangePreset
  customRange: RangeSetting
  drama: Drama
  /** Melody Candidate Diversity v1.2: 有効化するGenerator Profile(未選択時はStandardのみ) */
  selectedGeneratorProfiles: MelodyGeneratorProfile[]
  /** セッション限定。Draft TechniqueのLifecycleは変更しない。 */
  techniqueExperimentPresetId: TechniqueExperimentPresetId | null
}

interface ProjectState {
  project: ComposerProject
  selectedSectionId: string | null
  activeBatchId: string | null
  activeCandidateIndex: number
  activePhraseBatchId: string | null
  activePhraseCandidateIndex: number
  activeSignaturePhraseBatchId: string | null
  activeSignaturePhraseCandidateIndex: number
  activeReactiveBatchId: string | null
  activeReactiveCandidateIndex: number
  generationSettings: GenerationSettings
  history: ComposerProject[]
  future: ComposerProject[]
  hydrated: boolean
  workflowNotice: string | null
  /** Issue #16: 時間単位の自動変換通知/確認待ち(判定できなかった場合) */
  timingNotice: TimingNotice | null

  hydrate: () => Promise<void>
  newProject: () => void
  loadProject: (project: unknown) => void
  loadProjectById: (id: string) => Promise<void>
  /** Issue #14: 保存済みプロジェクトを複製する(新しいprojectId・全データ保持)。複製したidを返す */
  duplicateStoredProject: (projectId: string) => Promise<string | null>
  /** Issue #14: 保存済みプロジェクトのタイトルを変更する(開いている場合は現在の表示も更新) */
  renameStoredProject: (projectId: string, title: string) => Promise<void>
  /** Issue #14: 保存済みプロジェクトを削除する(開いている場合は新規プロジェクトへ切り替え) */
  deleteStoredProject: (projectId: string) => Promise<void>
  persist: () => void
  /** timingNoticeがambiguousの場合にユーザーの選択を適用する。auto-convertedの通知は単に閉じる */
  confirmTimingConversion: (convert: boolean) => void
  dismissTimingNotice: () => void

  updateSongField: <K extends keyof ComposerProject["song"]>(key: K, value: ComposerProject["song"][K]) => void
  setSectionProfileOverride: (sectionId: string, profile: SongProfileId | null) => void
  setArrangementDirectorClimax: (sectionId: string | null) => void
  setArrangementDirectorSectionOverride: (
    sectionId: string,
    patch: {
      targetEnergy?: ArrangementDirectorSectionOverride["targetEnergy"] | null
      densityCeiling?: number | null
    },
  ) => void
  setArrangementDirectorWorkspace: (patch: {
    brief?: string
    selectedDirectionId?: ArrangementDirectorWorkspaceState["selectedDirectionId"]
  }) => void
  setSectionOrchestrationOverride: (
    sectionId: string,
    role: OrchestrationRole,
    patch: Partial<{
      [K in keyof OrchestrationPartOverride]: OrchestrationPartOverride[K] | null
    }> | null,
  ) => void

  addSection: (name: string, role: SectionRole, lengthBars: number) => void
  updateSection: (sectionId: string, patch: Partial<Section>) => void
  /** Issue #41: セクションのリード内容/伴奏/entryOffset/pickupを更新する */
  setSectionContent: (sectionId: string, patch: Partial<SectionContentSettings>) => void
  /** Issue #45: セクションへ独立Accompaniment Pattern Templateを割り当てる。 */
  setSectionAccompanimentPattern: (sectionId: string, patternId: string | null) => void
  setAiPartnerSession: (sectionId: string, session: AiPartnerSession | null) => void
  removeSection: (sectionId: string) => void
  duplicateSection: (sectionId: string) => void
  moveSection: (sectionId: string, targetIndex: number) => void
  selectSection: (sectionId: string | null) => void
  /** AI Partnerの結果一覧から、対象Sectionと候補バッチを同時に開く。 */
  focusCandidateWorkspace: (
    sectionId: string,
    generator: "melody" | "phrase" | "signature" | "counter" | "decoration" | "accompaniment",
    batchId?: string | null,
  ) => void

  setChordText: (sectionId: string, text: string) => void
  /** 現在のコード進行をそのまま複製して後ろへ繋げ、小節数を2倍にする */
  repeatSectionChords: (sectionId: string) => void
  /** Issue #12: セクション長に満たない場合、最後のコードを不足分だけ延長して充足させる */
  extendLastChordToFill: (sectionId: string) => void
  setGenerationSettings: (patch: Partial<GenerationSettings>) => void
  toggleGeneratorProfile: (profile: MelodyGeneratorProfile) => void
  /** Song Motif DNA(将来のセクション間一貫性チェックの土台): 指定Variantから抽出して保存する */
  extractMotifDNAFromVariant: (variantId: string) => void

  generateForSection: (sectionId: string) => void
  setActiveCandidateIndex: (index: number) => void
  setActiveMelody: (variantId: string) => void
  assignVariantToSection: (sectionId: string, variantId: string | null) => void
  setVariantReviewState: (variantId: string, reviewState: "favorite" | "rejected" | null) => void
  /** 生成履歴からVariantを選ぶ: Active Melodyにするだけでなく、現在の候補バッチ表示も解除する */
  selectVariantFromHistory: (variantId: string) => void
  renameVariant: (variantId: string, name: string) => void
  deleteVariant: (variantId: string) => void

  generatePhrasesForSection: (sectionId: string, lengthBars?: PhraseLengthBars) => void
  setActivePhraseCandidateIndex: (index: number) => void
  regeneratePhrase: (candidateId: string) => void
  generateSignaturePhrasesForSection: (
    sectionId: string,
    lengthBars?: SignaturePhraseLengthBars,
    direction?: SignatureGenerationDirection,
  ) => void
  setActiveSignaturePhraseCandidateIndex: (index: number) => void
  regenerateSignaturePhrase: (candidateId: string) => void
  generateCounterForSection: (
    sectionId: string,
    preferredStyle?: CounterGeneratorStyle,
    preferredCreativeRisk?: CounterCreativeRisk,
  ) => void
  setActiveReactiveCandidateIndex: (index: number) => void
  regenerateCounter: (candidateId: string) => void
  generateDecorationsForSection: (
    sectionId: string,
    settings?: DecorationSettings,
  ) => void
  /** AI Partnerで選んだDirectionの演奏意図を、直前に生成した候補へ安全に反映する。 */
  applyPerformanceToLatestGeneration: (
    sectionId: string,
    generator: "melody" | "phrase" | "signature" | "counter" | "decoration" | "accompaniment",
    plan: PerformanceExecutionPlan,
  ) => void
  regenerateDecoration: (candidateId: string) => void
  setReactiveLayerReviewState: (
    candidateId: string,
    reviewState: "favorite" | "rejected" | null,
  ) => void
  assignReactiveLayer: (candidateId: string) => void

  toggleNoteLock: (variantId: string, noteId: string, lock: LockKind) => void
  toggleBarLock: (variantId: string, barIndex: number) => void
  updateNote: (variantId: string, noteId: string, patch: Partial<MelodyNote>) => void
  deleteNote: (variantId: string, noteId: string) => void
  regenerateRange: (
    variantId: string,
    startBeat: number,
    endBeat: number,
    locks?: Partial<RangeRegenerationLocks>,
  ) => void

  applySeedOperation: (
    sourceVariantId: string,
    op: SeedOperation,
    seedNoteIds: string[],
    opts?: { continuationBars?: number; expandToBars?: number },
  ) => void

  undo: () => void
  redo: () => void
}

function resolveRange(settings: GenerationSettings): RangeSetting {
  return settings.rangePreset === "custom" ? settings.customRange : RANGE_PRESETS[settings.rangePreset]
}

function phraseGenerationInput(
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
    key: project.song.key,
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

function signaturePhraseGenerationInput(
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
    key: project.song.key,
    beatsPerBar,
    totalBeats,
    seed,
    lengthBars: resolvedLength,
    finalCandidateCount: 12,
    candidatePoolSize: 72,
    direction,
  }
}

function counterGenerationInput(
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
    key: project.song.key,
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

function arrangementSurpriseContext(
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

function decorationGenerationInput(
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
    key: project.song.key,
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

function snapshot(project: ComposerProject): ComposerProject {
  return JSON.parse(JSON.stringify(project))
}

/** 採用済みメロディーを別セクションへ複製し、編集可能な独立Variantにする。 */
function duplicateVariantForSection(source: MelodyVariant, sectionId: string): MelodyVariant {
  const copy = structuredClone(replaceVariantNotes(source, source.notes))
  const noteIds = new Map<string, string>()
  const duplicateNote = (note: MelodyNote): MelodyNote => {
    let id = noteIds.get(note.id)
    if (!id) {
      id = crypto.randomUUID()
      noteIds.set(note.id, id)
    }
    return { ...note, id }
  }

  return {
    ...copy,
    id: crypto.randomUUID(),
    name: `${source.name} copy`,
    sectionId,
    parentMelodyId: source.id,
    batchId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reviewState: null,
    notes: copy.notes.map(duplicateNote),
    layers: copy.layers?.map((layer) => ({
      ...layer,
      id: crypto.randomUUID(),
      notes: layer.notes.map(duplicateNote),
    })),
  }
}

function timingNoticeFrom(result: ReturnType<typeof resolveProjectTiming>): TimingNotice | null {
  if (result.status === "auto-converted") {
    return { kind: "auto-converted", factor: result.factor ?? 1, timeSignature: result.project.song.timeSignature }
  }
  if (result.status === "ambiguous" && result.ambiguity) {
    return { kind: "ambiguous", timeSignature: result.ambiguity.timeSignature, reason: result.ambiguity.reason }
  }
  return null
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createEmptyProject("New Song"),
  selectedSectionId: null,
  activeBatchId: null,
  activeCandidateIndex: 0,
  activePhraseBatchId: null,
  activePhraseCandidateIndex: 0,
  activeSignaturePhraseBatchId: null,
  activeSignaturePhraseCandidateIndex: 0,
  activeReactiveBatchId: null,
  activeReactiveCandidateIndex: 0,
  generationSettings: {
    density: "balanced",
    rangePreset: "middle",
    customRange: RANGE_PRESETS.middle,
    drama: "growing",
    selectedGeneratorProfiles: ["standard"],
    techniqueExperimentPresetId: null,
  },
  history: [],
  future: [],
  hydrated: false,
  workflowNotice: null,
  timingNotice: null,

  hydrate: async () => {
    const last = await loadLastOpenedProject()
    if (last) {
      // JSON Import/loadProjectByIdと同じ唯一の移行経路(resolveProjectTiming)を通す。
      // normalizeProjectも内部で必ず通るため、旧schemaVersion(1.0)のデータが
      // songProfile等を欠いたままUIへ渡ってクラッシュすることもない(16章/Issue #16)
      const result = resolveProjectTiming(last)
      const sectionInference = inferMarkerlessImportedSections(result.project)
      if (result.status !== "no-op") void backupProjectTimingSnapshot(last)
      set({
        project: sectionInference.project,
        selectedSectionId: sectionInference.project.sections[0]?.id ?? null,
        hydrated: true,
        timingNotice: timingNoticeFrom(result),
      })
      if (result.status === "auto-converted" || sectionInference.changed) get().persist()
    } else {
      set({ hydrated: true })
    }
  },

  newProject: () => {
    const project = createEmptyProject("New Song")
    set({
      project,
      selectedSectionId: null,
      activeBatchId: null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
      activeSignaturePhraseBatchId: null,
      activeSignaturePhraseCandidateIndex: 0,
      activeReactiveBatchId: null,
      activeReactiveCandidateIndex: 0,
      history: [],
      future: [],
      timingNotice: null,
      workflowNotice: null,
    })
    get().persist()
  },

  loadProject: (raw) => {
    const result = resolveProjectTiming(raw)
    const sectionInference = inferMarkerlessImportedSections(result.project)
    if (result.status !== "no-op") void backupProjectTimingSnapshot(raw)
    set({
      project: sectionInference.project,
      selectedSectionId: sectionInference.project.sections[0]?.id ?? null,
      activeBatchId: null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
      activeSignaturePhraseBatchId: null,
      activeSignaturePhraseCandidateIndex: 0,
      activeReactiveBatchId: null,
      activeReactiveCandidateIndex: 0,
      history: [],
      future: [],
      timingNotice: timingNoticeFrom(result),
      workflowNotice: null,
    })
    get().persist()
  },

  confirmTimingConversion: (convert) => {
    const prev = get().project
    const resolved = resolveAmbiguousTiming(prev, convert)
    set({ project: resolved, timingNotice: null })
    get().persist()
  },

  dismissTimingNotice: () => set({ timingNotice: null }),

  loadProjectById: async (id) => {
    const p = await loadProjectById(id)
    if (p) get().loadProject(p)
  },

  duplicateStoredProject: async (projectId) => {
    const copy = await duplicateStoredProjectRepo(projectId)
    return copy?.projectId ?? null
  },

  renameStoredProject: async (projectId, title) => {
    await renameStoredProjectRepo(projectId, title)
    // 開いているプロジェクトを改名した場合は現在の表示も更新する(自動保存で永続化)
    if (get().project.projectId === projectId) {
      set({ project: { ...get().project, title } })
      get().persist()
    }
  },

  deleteStoredProject: async (projectId) => {
    await deleteStoredProjectRepo(projectId)
    // 開いているプロジェクトを削除した場合は、直前状態(lastOpened)を復元、無ければ新規へ
    if (get().project.projectId === projectId) {
      const last = await loadLastOpenedProject()
      if (last) get().loadProject(last)
      else get().newProject()
    }
  },

  persist: () => {
    void saveProject(get().project)
  },

  updateSongField: (key, value) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, song: { ...prev.song, [key]: value } },
    })
    get().persist()
  },

  setSectionProfileOverride: (sectionId, profile) => {
    const prev = get().project
    const overrides = prev.song.sectionProfileOverrides.filter((o) => o.sectionId !== sectionId)
    if (profile) overrides.push({ sectionId, songProfile: profile })
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, song: { ...prev.song, sectionProfileOverrides: overrides } },
    })
    get().persist()
  },

  setArrangementDirectorClimax: (sectionId) => {
    const prev = get().project
    if (sectionId && !prev.sections.some((section) => section.id === sectionId)) return
    const overrides = {
      sections: { ...(prev.arrangementDirectorOverrides?.sections ?? {}) },
      ...(sectionId ? { climaxSectionId: sectionId } : {}),
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, arrangementDirectorOverrides: overrides },
    })
    get().persist()
  },

  setArrangementDirectorSectionOverride: (sectionId, patch) => {
    const prev = get().project
    if (!prev.sections.some((section) => section.id === sectionId)) return
    const sections = { ...(prev.arrangementDirectorOverrides?.sections ?? {}) }
    const current = { ...(sections[sectionId] ?? {}) }
    if (patch.targetEnergy === null) delete current.targetEnergy
    else if (patch.targetEnergy !== undefined) current.targetEnergy = patch.targetEnergy
    if (patch.densityCeiling === null) delete current.densityCeiling
    else if (patch.densityCeiling !== undefined) current.densityCeiling = Math.max(
      1,
      Math.min(prev.arrangementSettings.maximumParts, Math.round(patch.densityCeiling)),
    )
    if (Object.keys(current).length > 0) sections[sectionId] = current
    else delete sections[sectionId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        arrangementDirectorOverrides: {
          ...(prev.arrangementDirectorOverrides?.climaxSectionId
            ? { climaxSectionId: prev.arrangementDirectorOverrides.climaxSectionId }
            : {}),
          sections,
        },
      },
    })
    get().persist()
  },

  setArrangementDirectorWorkspace: (patch) => {
    const prev = get().project
    const current = prev.arrangementDirectorWorkspace ?? { brief: "", selectedDirectionId: null }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        arrangementDirectorWorkspace: {
          brief: patch.brief === undefined ? current.brief : patch.brief.slice(0, 1500),
          selectedDirectionId: patch.selectedDirectionId === undefined
            ? current.selectedDirectionId
            : patch.selectedDirectionId,
        },
      },
    })
    get().persist()
  },

  setSectionOrchestrationOverride: (sectionId, role, patch) => {
    const prev = get().project
    if (!prev.sections.some((section) => section.id === sectionId)) return
    const allSections = { ...(prev.sectionOrchestrationOverrides ?? {}) }
    const sectionOverrides = { ...(allSections[sectionId] ?? {}) }
    if (patch === null) {
      delete sectionOverrides[role]
    } else {
      const current: OrchestrationPartOverride = { ...(sectionOverrides[role] ?? {}) }
      for (const [key, value] of Object.entries(patch) as Array<
        [keyof OrchestrationPartOverride, OrchestrationPartOverride[keyof OrchestrationPartOverride] | null]
      >) {
        if (value === null) delete current[key]
        else if (value !== undefined) Object.assign(current, { [key]: value })
      }
      if (Object.keys(current).length > 0) sectionOverrides[role] = current
      else delete sectionOverrides[role]
    }
    if (Object.keys(sectionOverrides).length > 0) allSections[sectionId] = sectionOverrides
    else delete allSections[sectionId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sectionOrchestrationOverrides: allSections },
    })
    get().persist()
  },

  addSection: (name, role, lengthBars) => {
    const prev = get().project
    const section: Section = {
      id: crypto.randomUUID(),
      name,
      role,
      startBar: 1,
      lengthBars,
      // Issue #41: 新規セクションも2軸モデルを明示的に持たせる(既定は従来と同じMelody+Chords)
      content: { ...DEFAULT_SECTION_CONTENT },
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: normalizeSectionTimeline([...prev.sections, section]) },
      selectedSectionId: section.id,
    })
    get().persist()
  },

  /**
   * Issue #41: セクションのリード内容/伴奏/entryOffset/pickupを更新する。
   * entryOffsetはセクション長を超えないよう丸める(完全無音は entryOffset = セクション長)。
   */
  setSectionContent: (sectionId, patch) => {
    const prev = get().project
    const beatsPerBar = parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const sections = prev.sections.map((section) => {
      if (section.id !== sectionId) return section
      const current = section.content ?? DEFAULT_SECTION_CONTENT
      const next = { ...current, ...patch }
      const sectionBeats = section.lengthBars * beatsPerBar
      return {
        ...section,
        content: {
          ...next,
          entryOffsetBeats: Math.max(0, Math.min(sectionBeats, next.entryOffsetBeats)),
        },
      }
    })
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections },
    })
    get().persist()
  },

  setSectionAccompanimentPattern: (sectionId, patternId) => {
    const prev = get().project
    if (!prev.sections.some((section) => section.id === sectionId)) return
    if (patternId && !prev.accompanimentPatterns.some((pattern) => pattern.id === patternId)) return
    const assignments = { ...prev.sectionAccompanimentPatternAssignments }
    if (patternId) assignments[sectionId] = patternId
    else delete assignments[sectionId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sectionAccompanimentPatternAssignments: assignments },
    })
    get().persist()
  },

  setAiPartnerSession: (sectionId, session) => {
    const prev = get().project
    if (!prev.sections.some((section) => section.id === sectionId)) return
    const aiPartnerSessions = { ...(prev.aiPartnerSessions ?? {}) }
    if (session) aiPartnerSessions[sectionId] = session
    else delete aiPartnerSessions[sectionId]
    set({ project: { ...prev, aiPartnerSessions } })
    get().persist()
  },

  updateSection: (sectionId, patch) => {
    const prev = get().project
    const sections = prev.sections.map((s) =>
      s.id === sectionId
        ? { ...s, ...patch, lengthBars: patch.lengthBars === undefined ? s.lengthBars : Math.max(1, patch.lengthBars) }
        : s,
    )
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: normalizeSectionTimeline(sections) },
    })
    get().persist()
  },

  removeSection: (sectionId) => {
    const prev = get().project
    const { [sectionId]: _removedAssignment, ...sectionMelodyAssignments } = prev.sectionMelodyAssignments
    const {
      [sectionId]: _removedPatternAssignment,
      ...sectionAccompanimentPatternAssignments
    } = prev.sectionAccompanimentPatternAssignments
    const {
      [sectionId]: _removedReactiveAssignment,
      ...sectionReactiveLayerAssignments
    } = prev.sectionReactiveLayerAssignments ?? {}
    const {
      [sectionId]: _removedDecorationAssignment,
      ...sectionDecorationLayerAssignments
    } = prev.sectionDecorationLayerAssignments ?? {}
    const {
      [sectionId]: _removedAiPartnerSession,
      ...aiPartnerSessions
    } = prev.aiPartnerSessions ?? {}
    const {
      [sectionId]: _removedPerformancePlan,
      ...sectionPerformancePlans
    } = prev.sectionPerformancePlans ?? {}
    void _removedAssignment
    void _removedPatternAssignment
    void _removedReactiveAssignment
    void _removedDecorationAssignment
    void _removedAiPartnerSession
    void _removedPerformancePlan
    const removedVariantIds = new Set(
      prev.melodyVariants.filter((variant) => variant.sectionId === sectionId).map((variant) => variant.id),
    )
    const removedCandidateIds = new Set([
      ...removedVariantIds,
      ...prev.phraseCandidates.filter((candidate) => candidate.sectionId === sectionId).map((candidate) => candidate.id),
      ...prev.signaturePhraseCandidates.filter((candidate) => candidate.sectionId === sectionId).map((candidate) => candidate.id),
      ...(prev.reactiveLayerCandidates ?? [])
        .filter((candidate) => candidate.sectionId === sectionId)
        .map((candidate) => candidate.id),
    ])
    const directorSectionOverrides = {
      ...(prev.arrangementDirectorOverrides?.sections ?? {}),
    }
    delete directorSectionOverrides[sectionId]
    const arrangementDirectorOverrides = {
      sections: directorSectionOverrides,
      ...(prev.arrangementDirectorOverrides?.climaxSectionId &&
      prev.arrangementDirectorOverrides.climaxSectionId !== sectionId
        ? { climaxSectionId: prev.arrangementDirectorOverrides.climaxSectionId }
        : {}),
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        sections: normalizeSectionTimeline(prev.sections.filter((s) => s.id !== sectionId)),
        chords: prev.chords.filter((c) => c.sectionId !== sectionId),
        melodyVariants: prev.melodyVariants.filter((v) => v.sectionId !== sectionId),
        phraseCandidates: prev.phraseCandidates.filter((candidate) => candidate.sectionId !== sectionId),
        signaturePhraseCandidates: prev.signaturePhraseCandidates.filter(
          (candidate) => candidate.sectionId !== sectionId,
        ),
        reactiveLayerCandidates: (prev.reactiveLayerCandidates ?? []).filter(
          (candidate) => candidate.sectionId !== sectionId,
        ),
        sectionMelodyAssignments,
        sectionAccompanimentPatternAssignments,
        sectionReactiveLayerAssignments,
        sectionDecorationLayerAssignments,
        aiPartnerSessions,
        sectionPerformancePlans,
        arrangementDirectorOverrides,
        sectionOrchestrationOverrides: Object.fromEntries(
          Object.entries(prev.sectionOrchestrationOverrides ?? {}).filter(
            ([candidateSectionId]) => candidateSectionId !== sectionId,
          ),
        ),
        candidatePerformanceReviews: Object.fromEntries(
          Object.entries(prev.candidatePerformanceReviews ?? {}).filter(
            ([candidateId]) => !removedCandidateIds.has(candidateId),
          ),
        ),
        performanceBatchRecommendations: Object.fromEntries(
          Object.entries(prev.performanceBatchRecommendations ?? {}).filter(
            ([, recommendation]) =>
              !recommendation.consideredCandidateIds.some((candidateId) =>
                removedCandidateIds.has(candidateId),
              ),
          ),
        ),
        activeMelodyId:
          prev.activeMelodyId && removedVariantIds.has(prev.activeMelodyId) ? null : prev.activeMelodyId,
      },
      selectedSectionId: prev.sections.find((s) => s.id !== sectionId)?.id ?? null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
      activeSignaturePhraseBatchId: null,
      activeSignaturePhraseCandidateIndex: 0,
      activeReactiveBatchId: null,
      activeReactiveCandidateIndex: 0,
    })
    get().persist()
  },

  duplicateSection: (sectionId) => {
    const prev = get().project
    const src = prev.sections.find((s) => s.id === sectionId)
    if (!src) return
    const newId = crypto.randomUUID()
    const copy: Section = { ...src, id: newId, name: `${src.name} copy`, startBar: 1 }
    const chordCopies = prev.chords.filter((c) => c.sectionId === sectionId).map((c) => ({ ...c, id: crypto.randomUUID(), sectionId: newId }))
    const assignedVariantId = prev.sectionMelodyAssignments[sectionId]
    const assignedVariant = assignedVariantId
      ? prev.melodyVariants.find((variant) => variant.id === assignedVariantId && variant.sectionId === sectionId)
      : undefined
    const variantCopy = assignedVariant ? duplicateVariantForSection(assignedVariant, newId) : undefined
    const sourcePatternId = prev.sectionAccompanimentPatternAssignments[sectionId]
    const sourcePerformancePlans = prev.sectionPerformancePlans?.[sectionId]
    const sourceDirectorOverride = prev.arrangementDirectorOverrides?.sections[sectionId]
    const sourceOrchestrationOverrides = prev.sectionOrchestrationOverrides?.[sectionId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        sections: normalizeSectionTimeline([...prev.sections, copy]),
        chords: [...prev.chords, ...chordCopies],
        melodyVariants: variantCopy ? [...prev.melodyVariants, variantCopy] : prev.melodyVariants,
        sectionMelodyAssignments: variantCopy
          ? { ...prev.sectionMelodyAssignments, [newId]: variantCopy.id }
          : prev.sectionMelodyAssignments,
        sectionAccompanimentPatternAssignments: sourcePatternId
          ? { ...prev.sectionAccompanimentPatternAssignments, [newId]: sourcePatternId }
          : prev.sectionAccompanimentPatternAssignments,
        sectionPerformancePlans: sourcePerformancePlans
          ? {
              ...(prev.sectionPerformancePlans ?? {}),
              [newId]: structuredClone(sourcePerformancePlans),
            }
          : prev.sectionPerformancePlans,
        arrangementDirectorOverrides: sourceDirectorOverride
          ? {
              ...(prev.arrangementDirectorOverrides ?? { sections: {} }),
              sections: {
                ...(prev.arrangementDirectorOverrides?.sections ?? {}),
                [newId]: { ...sourceDirectorOverride },
              },
            }
          : prev.arrangementDirectorOverrides,
        sectionOrchestrationOverrides: sourceOrchestrationOverrides
          ? {
              ...(prev.sectionOrchestrationOverrides ?? {}),
              [newId]: structuredClone(sourceOrchestrationOverrides),
            }
          : prev.sectionOrchestrationOverrides,
        activeMelodyId: variantCopy?.id ?? prev.activeMelodyId,
      },
      selectedSectionId: newId,
      activeBatchId: null,
      activeCandidateIndex: 0,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
      activeSignaturePhraseBatchId: null,
      activeSignaturePhraseCandidateIndex: 0,
      activeReactiveBatchId: null,
      activeReactiveCandidateIndex: 0,
    })
    get().persist()
  },

  moveSection: (sectionId, targetIndex) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: moveSectionInTimeline(prev.sections, sectionId, targetIndex) },
    })
    get().persist()
  },

  selectSection: (sectionId) =>
    set({
      selectedSectionId: sectionId,
      activeBatchId: null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
      activeSignaturePhraseBatchId: null,
      activeSignaturePhraseCandidateIndex: 0,
      activeReactiveBatchId: null,
      activeReactiveCandidateIndex: 0,
    }),

  focusCandidateWorkspace: (sectionId, generator, batchId = null) =>
    set({
      selectedSectionId: sectionId,
      activeBatchId: generator === "melody" ? batchId : null,
      activeCandidateIndex: 0,
      activePhraseBatchId: generator === "phrase" ? batchId : null,
      activePhraseCandidateIndex: 0,
      activeSignaturePhraseBatchId: generator === "signature" ? batchId : null,
      activeSignaturePhraseCandidateIndex: 0,
      activeReactiveBatchId:
        generator === "counter" || generator === "decoration" ? batchId : null,
      activeReactiveCandidateIndex: 0,
    }),

  setChordText: (sectionId, text) => {
    const prev = get().project
    const ts = parseTimeSignature(prev.song.timeSignature)
    const events = parseChordInputText(text, sectionId, ts.beatsPerBar, sectionId)
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, chords: [...prev.chords.filter((c) => c.sectionId !== sectionId), ...events] },
    })
    get().persist()
  },

  repeatSectionChords: (sectionId) => {
    const prev = get().project
    const section = prev.sections.find((s) => s.id === sectionId)
    const existing = prev.chords.filter((c) => c.sectionId === sectionId).sort((a, b) => a.startBeat - b.startBeat)
    if (!section || existing.length === 0) return

    const ts = parseTimeSignature(prev.song.timeSignature)
    const coveredBeats = Math.max(...existing.map((c) => c.startBeat + c.durationBeats))
    const copies = existing.map((c) => ({ ...c, id: crypto.randomUUID(), startBeat: c.startBeat + coveredBeats }))
    const newLengthBars = Math.max(section.lengthBars, Math.ceil((coveredBeats * 2) / ts.beatsPerBar))

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        chords: [...prev.chords, ...copies],
        sections: normalizeSectionTimeline(
          prev.sections.map((s) => (s.id === sectionId ? { ...s, lengthBars: newLengthBars } : s)),
        ),
      },
    })
    get().persist()
  },

  extendLastChordToFill: (sectionId) => {
    const prev = get().project
    const section = prev.sections.find((s) => s.id === sectionId)
    const existing = prev.chords.filter((c) => c.sectionId === sectionId).sort((a, b) => a.startBeat - b.startBeat)
    if (!section || existing.length === 0) return
    const ts = parseTimeSignature(prev.song.timeSignature)
    const sectionBeats = section.lengthBars * ts.beatsPerBar
    const last = existing[existing.length - 1]
    const covered = last.startBeat + last.durationBeats
    const gap = sectionBeats - covered
    if (gap <= 1e-6) return // 既に充足/超過している場合は何もしない
    const extendedLast = { ...last, durationBeats: Math.round((last.durationBeats + gap) * 1000) / 1000 }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        chords: prev.chords.map((c) => (c.id === last.id ? extendedLast : c)),
      },
    })
    get().persist()
  },

  setGenerationSettings: (patch) => set({ generationSettings: { ...get().generationSettings, ...patch } }),

  toggleGeneratorProfile: (profile) => {
    const current = get().generationSettings.selectedGeneratorProfiles
    const has = current.includes(profile)
    const next = has ? current.filter((p) => p !== profile) : [...current, profile]
    set({ generationSettings: { ...get().generationSettings, selectedGeneratorProfiles: next.length > 0 ? next : ["standard"] } })
  },

  extractMotifDNAFromVariant: (variantId) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((v) => v.id === variantId)
    if (!variant) return
    const chords = prev.chords.filter((c) => c.sectionId === variant.sectionId)
    const harmonicMap = buildHarmonicMap(chords)
    const dna = extractMotifDNA(variant.notes, harmonicMap)
    if (!dna) return
    set({ project: { ...prev, songMotifDNA: dna } })
    get().persist()
  },

  generateForSection: (sectionId) => {
    const prev = get().project
    const section = prev.sections.find((s) => s.id === sectionId)
    if (!section) return
    const ts = parseTimeSignature(prev.song.timeSignature)
    const chords = prev.chords.filter((c) => c.sectionId === sectionId).sort((a, b) => a.startBeat - b.startBeat)
    if (chords.length === 0) return

    const totalBeats = section.lengthBars * ts.beatsPerBar
    // Issue #12: 解析エラーのあるコードは、buildHarmonicMapが黙ってC majorへフォールバックする前に
    // ここで止める(UIのGenerateボタン無効化と合わせた二重の防御)。
    if (diagnoseChordInput(chords, totalBeats).hasError) return
    const profile = effectiveSongProfile(prev, sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const sectionContent = section.content ?? DEFAULT_SECTION_CONTENT

    // Issue #41: melody以外のリード内容は、通常のMelody Engineではなく
    // content専用の経路(計画→専用Generator→構造検証)を通す。
    if (usesContentPipeline(sectionContent.lead)) {
      const timeline = normalizeSectionTimeline(prev.sections)
      const sectionIndex = timeline.findIndex((candidate) => candidate.id === sectionId)
      const nextSection = sectionIndex >= 0 ? timeline[sectionIndex + 1] : undefined
      const nextSectionFirstChord = nextSection
        ? prev.chords
            .filter((chord) => chord.sectionId === nextSection.id)
            .sort((a, b) => a.startBeat - b.startBeat)[0]?.symbol
        : undefined
      const { candidates: contentCandidates, unresolvedCandidates } = generateSectionContent({
        chords,
        sectionId,
        sectionRole: section.role,
        songProfile: profile,
        content: sectionContent,
        range,
        totalBeats,
        beatsPerBar: ts.beatsPerBar,
        seed: createSeed(),
        key: prev.song.key,
        density: settings.density,
        drama: settings.drama,
        // Issue #41: サビが未生成ならundefinedのまま渡し、生成側で予約値へフォールバックさせる
        chorusPeakMidi: chorusPeakMidi(prev),
        nextSectionRole: nextSection?.role,
        nextSectionFirstChord,
        songMotifDNA: prev.songMotifDNA,
      })
      const contentBatchId = crypto.randomUUID()
      const contentVariants = contentCandidates.map((candidate) =>
        toMelodyVariantFromContent(sectionId, profile, candidate, contentBatchId),
      )
      set({
        history: [...get().history, snapshot(prev)],
        future: [],
        project: { ...prev, melodyVariants: [...prev.melodyVariants, ...contentVariants] },
        activeBatchId: contentBatchId,
        activeCandidateIndex: 0,
        // 作り直しの上限まで構造検証を満たせなかった場合は理由を伝える
        workflowNotice:
          unresolvedCandidates.length > 0
            ? `一部の候補が${LEAD_CONTENT_LABELS[unresolvedCandidates[0].content]}として成立していません(${unresolvedCandidates[0].problems[0]})。リード開始位置やセクション長を見直してください。`
            : null,
      })
      get().persist()
      return
    }

    const selectedProfiles: MelodyGeneratorProfile[] =
      settings.selectedGeneratorProfiles.length > 0 ? settings.selectedGeneratorProfiles : ["standard"]

    // Issue #41 / PR#43: Melodyでも entryOffset / pickup は同じ2軸設定として効かせる。
    // 窓の内側だけを生成対象にし(コードをずらして渡す)、生成後にセクション相対へ戻す。
    const window = leadWindowOf(sectionContent, totalBeats)
    const fullSection = isFullSectionWindow(window, totalBeats)
    const windowChords = fullSection ? chords : chordsForWindow(chords, window)
    const windowBeats = windowLengthBeats(window)
    if (windowChords.length === 0 || windowBeats <= 0) {
      set({ workflowNotice: "リード開始位置がセクション終端に達しているため、Melodyを生成できません。" })
      return
    }

    const baseSeed = createSeed()
    const ruleContext = {
      generatorTarget: "melody" as const,
      sectionRole: section.role,
    }
    const commonGenerationInput = {
      chords: windowChords,
      sectionId,
      sectionRole: section.role,
      songProfile: profile,
      density: settings.density,
      range,
      drama: settings.drama,
      totalBeats: windowBeats,
      seed: baseSeed,
      profiles: selectedProfiles,
      motifDNA: prev.songMotifDNA,
      key: prev.song.key,
      // セクション途中だけを生成するLead Windowでは、前セクション境界の計画を適用しない。
      transitionContext:
        window.startBeat === 0 ? buildSectionTransitionContext(prev, sectionId) : undefined,
    }
    const experimentPresetId =
      settings.techniqueExperimentPresetId
    const experimentPreset = experimentPresetId
      ? techniqueExperimentPreset(experimentPresetId)
      : null
    const generatedGroups = experimentPreset
      ? [
          {
            mode: "baseline" as const,
            candidates: generateFromChordsWithProfiles({
              ...commonGenerationInput,
              composerRules:
                resolvePublicComposerRules(ruleContext),
              techniqueFitSelectionWeight: 0,
            }).candidates,
          },
          {
            mode: "treatment" as const,
            candidates: generateFromChordsWithProfiles({
              ...commonGenerationInput,
              composerRules: resolvePublicComposerRules(
                ruleContext,
                techniqueExperimentRules(
                  experimentPreset.id,
                  ruleContext,
                ),
              ),
            }).candidates,
          },
        ]
      : [
          {
            mode: null,
            candidates: generateFromChordsWithProfiles({
              ...commonGenerationInput,
              composerRules:
                resolvePublicComposerRules(ruleContext),
            }).candidates,
          },
        ]
    const taggedCandidates = generatedGroups.flatMap((group) =>
      group.candidates.map((candidate) => ({
        candidate,
        experimentMode: group.mode,
      })),
    )

    const harmonicMap = buildHarmonicMap(chords)
    const batchId = crypto.randomUUID()
    const rawVariants: MelodyVariant[] = taggedCandidates.map(
      ({ candidate: c, experimentMode }) => {
      const v = toMelodyVariantFromProfile(sectionId, profile, c, batchId)
      if (experimentPreset && experimentMode) {
        v.techniqueExperiment = {
          presetId: experimentPreset.id,
          presetLabel: experimentPreset.label,
          mode: experimentMode,
          techniqueNames: [...experimentPreset.techniqueNames],
        }
        v.name = `${experimentMode === "baseline" ? "Normal" : experimentPreset.label} · ${v.name}`
      }
      if (!fullSection) {
        // 窓相対で作った実音をセクション相対へ戻し、Layer/notesを一致させる
        v.notes = shiftNotesToSection(v.notes, window)
        // restBeats も絶対拍位置なのでまとめてずらす
        // (ずらし忘れると計画が実音とずれ、時間単位移行でも誤った値をスケールしてしまう)
        v.phrasePlans = v.phrasePlans.map((plan) => ({
          ...plan,
          phraseStartBeat: plan.phraseStartBeat + window.startBeat,
          climaxBeat: plan.climaxBeat + window.startBeat,
          restBeats: plan.restBeats.map((beat) => beat + window.startBeat),
        }))
      }
      v.leadContent = "melody"
      const primaryNotes = v.notes
      v.layers = [
        {
          id: `${v.id}:primary`,
          partRole: "lead",
          content: "melody",
          plan: fallbackPlanFor("melody", primaryNotes),
          notes: primaryNotes,
          kind: "primary",
        },
      ]
      // pickupが有効なら、窓の外(セクション末尾)へ弱起を別Layerとして足す
      const pickupNotes = generateMelodyPickupNotes(v.seed, {
        chords,
        sectionId,
        sectionRole: section.role,
        songProfile: profile,
        content: sectionContent,
        range,
        totalBeats,
        beatsPerBar: ts.beatsPerBar,
        seed: v.seed,
        key: prev.song.key,
        chorusPeakMidi: chorusPeakMidi(prev),
      })
      if (pickupNotes.length > 0) {
        v.layers.push({
          id: `${v.id}:pickup`,
          partRole: "lead",
          content: "melody",
          plan: fallbackPlanFor("melody", pickupNotes),
          notes: pickupNotes,
          kind: "pickup",
        })
        v.notes = flattenLayerNotes(v.layers)
      }
      v.features = computeMelodyFeatures(v.notes, harmonicMap, 0, totalBeats)
      return v
      },
    )

    const melodySurpriseContext = arrangementSurpriseContext(
      prev,
      sectionId,
      [],
    )
    const variants = melodySurpriseContext
      ? annotateArrangementApproaches(rawVariants, melodySurpriseContext, {
          maximumSurpriseCount: 1,
          minimumScore: 78,
        })
      : rawVariants

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, melodyVariants: [...prev.melodyVariants, ...variants] },
      activeBatchId: batchId,
      activeCandidateIndex: 0,
      workflowNotice: null,
    })
    get().persist()
  },

  setActiveCandidateIndex: (index) => set({ activeCandidateIndex: index }),

  generatePhrasesForSection: (sectionId, lengthBars) => {
    const prev = get().project
    const settings = get().generationSettings
    const input = phraseGenerationInput(
      prev,
      sectionId,
      settings,
      createSeed(),
      lengthBars,
    )
    if (!input) {
      set({ workflowNotice: "フレーズ生成には、2小節以上のセクションと有効なコード進行が必要です。" })
      return
    }
    const ruleContext = {
      generatorTarget: "phrase" as const,
      sectionRole: input.sectionRole,
    }
    const experimentPreset = settings.techniqueExperimentPresetId
      ? techniqueExperimentPreset(
          settings.techniqueExperimentPresetId,
        )
      : null
    const experimentRules = experimentPreset
      ? resolvePublicComposerRules(
          ruleContext,
          techniqueExperimentRules(
            experimentPreset.id,
            ruleContext,
          ),
        )
      : null
    const generatedGroups = experimentPreset
      ? [
          {
            mode: "baseline" as const,
            candidates: generatePhraseCandidates({
              ...input,
              composerRules:
                resolvePublicComposerRules(ruleContext),
              techniqueFitSelectionWeight: 0,
            }),
          },
          {
            mode: "treatment" as const,
            candidates: generatePhraseCandidates({
              ...input,
              composerRules: experimentRules!,
              techniqueFitSelectionWeight: 0.1,
            }),
          },
        ]
      : [
          {
            mode: null,
            candidates: generatePhraseCandidates(input),
          },
        ]
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const rawCandidates: PhraseCandidate[] = generatedGroups.flatMap(
      (group) =>
        group.candidates.map((candidate, index) => ({
          ...candidate,
          id: crypto.randomUUID(),
          batchId,
          name: group.mode
            ? `${
                group.mode === "baseline"
                  ? "Normal"
                  : experimentPreset!.label
              } · Phrase ${index + 1}`
            : `Phrase ${index + 1}`,
          createdAt,
          techniqueFitScore:
            experimentRules && group.mode
              ? phraseTechniqueFitScore(
                  candidate.intent,
                  experimentRules,
                )
              : candidate.techniqueFitScore,
          techniqueExperiment:
            experimentPreset && group.mode
              ? {
                  presetId: experimentPreset.id,
                  presetLabel: experimentPreset.label,
                  mode: group.mode,
                  techniqueNames: [
                    ...experimentPreset.techniqueNames,
                  ],
                }
              : undefined,
        })),
    )
    const phraseSurpriseContext = arrangementSurpriseContext(
      prev,
      sectionId,
      prev.melodyVariants.find(
        (variant) =>
          variant.id === prev.sectionMelodyAssignments[sectionId] &&
          variant.sectionId === sectionId,
      )?.notes ?? [],
    )
    const candidates = phraseSurpriseContext
      ? annotateArrangementApproaches(rawCandidates, phraseSurpriseContext, {
          maximumSurpriseCount: 2,
          minimumScore: 76,
        })
      : rawCandidates
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, phraseCandidates: [...prev.phraseCandidates, ...candidates] },
      activePhraseBatchId: batchId,
      activePhraseCandidateIndex: 0,
      workflowNotice: null,
    })
    get().persist()
  },

  setActivePhraseCandidateIndex: (index) => set({ activePhraseCandidateIndex: Math.max(0, index) }),

  regeneratePhrase: (candidateId) => {
    const prev = get().project
    const current = prev.phraseCandidates.find((candidate) => candidate.id === candidateId)
    if (!current) return
    const input = phraseGenerationInput(
      prev,
      current.sectionId,
      get().generationSettings,
      current.seed + 104729,
      current.intent.lengthBars,
    )
    if (!input) return
    const ruleContext = {
      generatorTarget: "phrase" as const,
      sectionRole: input.sectionRole,
    }
    const experimentPreset = current.techniqueExperiment
      ? techniqueExperimentPreset(
          current.techniqueExperiment
            .presetId as TechniqueExperimentPresetId,
        )
      : null
    const experimentRules = experimentPreset
      ? resolvePublicComposerRules(
          ruleContext,
          techniqueExperimentRules(
            experimentPreset.id,
            ruleContext,
          ),
        )
      : null
    const regenerationInput: GeneratePhrasesInput = {
      ...input,
      composerRules:
        current.techniqueExperiment?.mode === "treatment" &&
        experimentRules
          ? experimentRules
          : resolvePublicComposerRules(ruleContext),
      techniqueFitSelectionWeight:
        current.techniqueExperiment?.mode === "treatment"
          ? 0.1
          : 0,
    }
    const siblings = prev.phraseCandidates.filter(
      (candidate) =>
        candidate.batchId === current.batchId &&
        candidate.id !== current.id &&
        candidate.techniqueExperiment?.mode ===
          current.techniqueExperiment?.mode,
    )
    const regenerated = buildRegeneratedPhrase(
      regenerationInput,
      current.seed,
      siblings,
    )
    const replacement: PhraseCandidate = {
      ...regenerated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      createdAt: new Date().toISOString(),
      techniqueFitScore: experimentRules
        ? phraseTechniqueFitScore(
            regenerated.intent,
            experimentRules,
          )
        : regenerated.techniqueFitScore,
      techniqueExperiment: current.techniqueExperiment,
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        phraseCandidates: prev.phraseCandidates.map((candidate) =>
          candidate.id === candidateId ? replacement : candidate,
        ),
      },
      workflowNotice: null,
    })
    get().persist()
  },

  generateSignaturePhrasesForSection: (sectionId, lengthBars, direction) => {
    const prev = get().project
    const input = signaturePhraseGenerationInput(
      prev,
      sectionId,
      get().generationSettings,
      createSeed(),
      lengthBars,
      direction,
    )
    if (!input) {
      set({
        workflowNotice:
          "Signature Phrase生成には、選択した長さを収められるセクションと有効なコード進行が必要です。",
      })
      return
    }
    const generated = generateSignaturePhraseCandidates(input)
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const rawCandidates: SignaturePhraseCandidate[] = generated.map(
      (candidate, index) => ({
        ...candidate,
        id: crypto.randomUUID(),
        batchId,
        name: `Signature ${index + 1}`,
        createdAt,
      }),
    )
    const signatureSurpriseContext = arrangementSurpriseContext(
      prev,
      sectionId,
      input.referenceMelody ?? [],
    )
    const candidates = signatureSurpriseContext
      ? annotateArrangementApproaches(rawCandidates, signatureSurpriseContext, {
          maximumSurpriseCount: 2,
          minimumScore: 74,
        })
      : rawCandidates
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        signaturePhraseCandidates: [
          ...prev.signaturePhraseCandidates,
          ...candidates,
        ],
      },
      activeSignaturePhraseBatchId: batchId,
      activeSignaturePhraseCandidateIndex: 0,
      workflowNotice: null,
    })
    get().persist()
  },

  setActiveSignaturePhraseCandidateIndex: (index) =>
    set({ activeSignaturePhraseCandidateIndex: Math.max(0, index) }),

  regenerateSignaturePhrase: (candidateId) => {
    const prev = get().project
    const current = prev.signaturePhraseCandidates.find(
      (candidate) => candidate.id === candidateId,
    )
    if (!current) return
    const requestedLength = current.plan.lengthBars
    const input = signaturePhraseGenerationInput(
      prev,
      current.sectionId,
      get().generationSettings,
      current.seed + 104729,
      requestedLength,
    )
    if (!input) return
    const siblings = prev.signaturePhraseCandidates.filter(
      (candidate) =>
        candidate.batchId === current.batchId &&
        candidate.id !== current.id,
    )
    const regenerated = buildRegeneratedSignaturePhrase(
      input,
      current,
      siblings,
    )
    const replacement: SignaturePhraseCandidate = {
      ...regenerated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      createdAt: new Date().toISOString(),
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        signaturePhraseCandidates:
          prev.signaturePhraseCandidates.map((candidate) =>
            candidate.id === candidateId ? replacement : candidate,
          ),
      },
      workflowNotice: null,
    })
    get().persist()
  },

  generateCounterForSection: (sectionId, preferredStyle, preferredCreativeRisk) => {
    const prev = get().project
    const baseInput = counterGenerationInput(prev, sectionId, createSeed())
    const input = baseInput
      ? {
          ...baseInput,
          ...(preferredStyle ? { preferredStyles: [preferredStyle] } : {}),
          ...(preferredCreativeRisk
            ? { preferredCreativeRisks: [preferredCreativeRisk] }
            : {}),
        }
      : null
    if (!input) {
      set({
        workflowNotice:
          "Counter生成には、有効なコード進行と採用済みActive Melodyが必要です。",
      })
      return
    }
    const ruleContext = {
      generatorTarget: "counter" as const,
      sectionRole: input.sectionRole,
    }
    const experimentPresetId =
      get().generationSettings.techniqueExperimentPresetId
    const experimentPreset = experimentPresetId
      ? techniqueExperimentPreset(experimentPresetId)
      : null
    const experimentRules = experimentPreset
      ? resolvePublicComposerRules(
          ruleContext,
          techniqueExperimentRules(
            experimentPreset.id,
            ruleContext,
          ),
        )
      : null
    const generatedGroups = experimentPreset
      ? [
          {
            mode: "baseline" as const,
            candidates: generateCounterCandidates({
              ...input,
              poolSize: 60,
              finalCount: COUNTER_EXPERIMENT_CANDIDATES_PER_MODE,
              composerRules:
                resolvePublicComposerRules(ruleContext),
              techniqueFitSelectionWeight: 0,
            }),
          },
          {
            mode: "treatment" as const,
            candidates: generateCounterCandidates({
              ...input,
              poolSize: 60,
              finalCount: COUNTER_EXPERIMENT_CANDIDATES_PER_MODE,
              composerRules: experimentRules!,
              techniqueFitSelectionWeight: 0.08,
            }),
          },
        ]
      : [
          {
            mode: null,
            candidates: generateCounterCandidates(input),
          },
        ]
    const generated = generatedGroups.flatMap((group) =>
      group.candidates.map((candidate) => ({
        candidate,
        experimentMode: group.mode,
      })),
    )
    if (generated.length === 0) {
      set({
        workflowNotice:
          "主旋律を尊重できる十分な隙間がありません。Melodyの休符または音価を調整してください。",
      })
      return
    }
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const rawCandidates: ReactiveLayerCandidate[] = generated.map(
      ({ candidate, experimentMode }, index) => ({
      ...candidate,
      id: crypto.randomUUID(),
      batchId,
      name: experimentMode
        ? `${
            experimentMode === "baseline"
              ? "Normal"
              : experimentPreset!.label
          } · ${candidate.name} ${(index % COUNTER_EXPERIMENT_CANDIDATES_PER_MODE) + 1}`
        : `${candidate.name} ${index + 1}`,
      notes: candidate.notes.map((note) => ({ ...note, id: crypto.randomUUID() })),
      createdAt,
      techniqueFitScore:
        experimentRules && experimentMode
          ? counterTechniqueFitScore(
              candidate,
              input.melody.notes,
              experimentRules,
            )
          : candidate.techniqueFitScore,
      techniqueExperiment:
        experimentPreset && experimentMode
          ? {
              presetId: experimentPreset.id,
              presetLabel: experimentPreset.label,
              mode: experimentMode,
              techniqueNames: [...experimentPreset.techniqueNames],
            }
          : undefined,
    }),
    )
    const surpriseContext = arrangementSurpriseContext(
      prev,
      sectionId,
      input.melody.notes,
      input.existingSupportNotes?.length ?? 0,
    )
    const candidates = surpriseContext
      ? annotateArrangementApproaches(rawCandidates, surpriseContext, {
          maximumSurpriseCount: 2,
          minimumScore: 74,
        })
      : rawCandidates
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        reactiveLayerCandidates: [
          ...(prev.reactiveLayerCandidates ?? []),
          ...candidates,
        ],
      },
      activeReactiveBatchId: batchId,
      activeReactiveCandidateIndex: 0,
      workflowNotice:
        candidates.length <
        COUNTER_CANDIDATE_CONFIG.finalCandidateCount
          ? `品質下限を満たすCounter候補は${candidates.length}件でした。`
          : null,
    })
    get().persist()
  },

  setActiveReactiveCandidateIndex: (index) =>
    set({ activeReactiveCandidateIndex: Math.max(0, index) }),

  regenerateCounter: (candidateId) => {
    const prev = get().project
    const current = (prev.reactiveLayerCandidates ?? []).find(
      (candidate) => candidate.id === candidateId && candidate.kind === "counter",
    )
    if (!current) return
    const input = counterGenerationInput(prev, current.sectionId, current.seed)
    if (!input || input.melody.id !== current.targetMelodyVariantId) {
      set({ workflowNotice: "Active Melodyが変更されています。Counterを新しく生成してください。" })
      return
    }
    const ruleContext = {
      generatorTarget: "counter" as const,
      sectionRole: input.sectionRole,
    }
    const experimentPreset = current.techniqueExperiment
      ? techniqueExperimentPreset(
          current.techniqueExperiment
            .presetId as TechniqueExperimentPresetId,
        )
      : null
    const experimentRules = experimentPreset
      ? resolvePublicComposerRules(
          ruleContext,
          techniqueExperimentRules(
            experimentPreset.id,
            ruleContext,
          ),
        )
      : null
    const regenerationInput: GenerateCounterInput = {
      ...input,
      composerRules:
        current.techniqueExperiment?.mode === "treatment" &&
        experimentRules
          ? experimentRules
          : resolvePublicComposerRules(ruleContext),
      techniqueFitSelectionWeight:
        current.techniqueExperiment?.mode === "treatment"
          ? 0.08
          : 0,
    }
    const siblings = (prev.reactiveLayerCandidates ?? []).filter(
      (candidate) =>
        candidate.batchId === current.batchId &&
        candidate.id !== current.id &&
        candidate.kind === "counter" &&
        candidate.techniqueExperiment?.mode ===
          current.techniqueExperiment?.mode,
    )
    const generated = buildRegeneratedCounter(
      regenerationInput,
      current,
      siblings,
    )
    if (!generated) {
      set({ workflowNotice: "品質下限を満たす別案を生成できませんでした。" })
      return
    }
    const replacement: ReactiveLayerCandidate = {
      ...generated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      notes: generated.notes.map((note) => ({ ...note, id: crypto.randomUUID() })),
      createdAt: new Date().toISOString(),
      techniqueFitScore: experimentRules
        ? counterTechniqueFitScore(
            generated,
            input.melody.notes,
            experimentRules,
          )
        : generated.techniqueFitScore,
      techniqueExperiment: current.techniqueExperiment,
    }
    const assignments = { ...(prev.sectionReactiveLayerAssignments ?? {}) }
    if (assignments[current.sectionId] === current.id) {
      assignments[current.sectionId] = replacement.id
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        reactiveLayerCandidates: (prev.reactiveLayerCandidates ?? []).map((candidate) =>
          candidate.id === current.id ? replacement : candidate,
        ),
        sectionReactiveLayerAssignments: assignments,
      },
      workflowNotice: null,
    })
    get().persist()
  },

  generateDecorationsForSection: (sectionId, settings = DEFAULT_DECORATION_SETTINGS) => {
    const prev = get().project
    const input = decorationGenerationInput(
      prev,
      sectionId,
      settings.seed ?? createSeed(),
      settings,
    )
    if (!input) {
      set({
        workflowNotice:
          "Decoration生成には、有効なコード進行を持つセクションが必要です。",
      })
      return
    }
    const need = assessDecorationNeed(input)
    const ruleContext = {
      generatorTarget: "decoration" as const,
      sectionRole: input.sectionRole,
      transition: input.nextSectionRole
        ? `${input.sectionRole}->${input.nextSectionRole}`
        : undefined,
    }
    const experimentPresetId =
      get().generationSettings.techniqueExperimentPresetId
    const experimentPreset = experimentPresetId
      ? techniqueExperimentPreset(experimentPresetId)
      : null
    const experimentRules = experimentPreset
      ? resolvePublicComposerRules(
          ruleContext,
          techniqueExperimentRules(
            experimentPreset.id,
            ruleContext,
          ),
        )
      : null
    const generatedGroups = experimentPreset
      ? [
          {
            mode: "baseline" as const,
            candidates: generateDecorationCandidates({
              ...input,
              composerRules:
                resolvePublicComposerRules(ruleContext),
              techniqueFitSelectionWeight: 0,
            }),
          },
          {
            mode: "treatment" as const,
            candidates: generateDecorationCandidates({
              ...input,
              composerRules: experimentRules!,
              techniqueFitSelectionWeight: 0.05,
            }),
          },
        ]
      : [
          {
            mode: null,
            candidates: generateDecorationCandidates(input),
          },
        ]
    const generated = generatedGroups.flatMap((group) =>
      group.candidates.map((candidate) => ({
        candidate,
        experimentMode: group.mode,
      })),
    )
    if (generated.length === 0) {
      set({ workflowNotice: "品質下限を満たすDecoration候補を生成できませんでした。" })
      return
    }
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const rawCandidates: ReactiveLayerCandidate[] = generated.map(
      ({ candidate, experimentMode }, index) => ({
      ...candidate,
      id: crypto.randomUUID(),
      batchId,
      name: experimentMode
        ? `${
            experimentMode === "baseline"
              ? "Normal"
              : experimentPreset!.label
          } · ${candidate.name} ${(index % 10) + 1}`
        : `${candidate.name} ${index + 1}`,
      notes: candidate.notes.map((note) => ({ ...note, id: crypto.randomUUID() })),
      createdAt,
      techniqueFitScore:
        experimentRules && experimentMode
          ? decorationTechniqueFitScore(
              candidate.decorationPlan,
              experimentRules,
            )
          : candidate.techniqueFitScore,
      techniqueExperiment:
        experimentPreset && experimentMode
          ? {
              presetId: experimentPreset.id,
              presetLabel: experimentPreset.label,
              mode: experimentMode,
              techniqueNames: [...experimentPreset.techniqueNames],
            }
          : undefined,
    }),
    )
    const surpriseContext = arrangementSurpriseContext(
      prev,
      sectionId,
      input.melodyNotes ?? [],
      input.existingSupportNotes?.length ?? 0,
    )
    const candidates = surpriseContext
      ? annotateArrangementApproaches(rawCandidates, surpriseContext, {
          maximumSurpriseCount: 2,
          minimumScore: 74,
        })
      : rawCandidates
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        reactiveLayerCandidates: [
          ...(prev.reactiveLayerCandidates ?? []),
          ...candidates,
        ],
      },
      activeReactiveBatchId: batchId,
      activeReactiveCandidateIndex: 0,
      workflowNotice:
        candidates.length < (experimentPreset ? 20 : 10)
          ? `品質下限を満たすDecoration候補は${candidates.length}件でした。`
          : need.level === "silence"
            ? `${need.reason} 比較用に控えめなGestureも生成しました。`
            : need.level === "optional"
              ? need.reason
              : null,
    })
    get().persist()
  },

  applyPerformanceToLatestGeneration: (sectionId, generator, plan) => {
    const state = get()
    const prev = state.project
    const section = prev.sections.find((candidate) => candidate.id === sectionId)
    if (!section) return
    const beatsPerBar = parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const totalBeats = section.lengthBars * beatsPerBar
    const sectionChords = prev.chords
      .filter((chord) => chord.sectionId === sectionId)
      .sort((left, right) => left.startBeat - right.startBeat)
    const assignedMelodyId = prev.sectionMelodyAssignments[sectionId]
    const assignedMelody = assignedMelodyId
      ? prev.melodyVariants.find(
          (variant) => variant.id === assignedMelodyId && variant.sectionId === sectionId,
        )
      : undefined
    const executionContext = {
      totalBeats,
      beatsPerBar,
      chordBoundaryBeats: sectionChords.map((chord) => chord.startBeat),
      melodyNotes: assignedMelody?.notes,
    }
    const execute = (notes: MelodyNote[]) =>
      applyPerformanceExecution(notes, plan, executionContext)
    const candidatePerformanceReviews = { ...(prev.candidatePerformanceReviews ?? {}) }
    const executeAndReview = (
      candidateId: string,
      notes: MelodyNote[],
      options: { hasBlockingCollision?: boolean } = {},
    ) => {
      const result = execute(notes)
      candidatePerformanceReviews[candidateId] = reviewPerformanceExecution(
        candidateId,
        notes,
        result,
        plan,
        executionContext,
        options,
      )
      return result.notes
    }

    let melodyVariants = prev.melodyVariants
    let phraseCandidates = prev.phraseCandidates
    let signaturePhraseCandidates = prev.signaturePhraseCandidates
    let reactiveLayerCandidates = prev.reactiveLayerCandidates ?? []
    let recommendationBatchId: string | null = null
    let recommendationCandidates: Array<{ candidateId: string; qualityScore: number }> = []

    if (generator === "melody" && state.activeBatchId) {
      recommendationBatchId = state.activeBatchId
      const harmonicMap = buildHarmonicMap(sectionChords)
      melodyVariants = prev.melodyVariants.map((variant) => {
        if (variant.sectionId !== sectionId || variant.batchId !== state.activeBatchId) return variant
        const replaced = replaceVariantNotes(
          variant,
          executeAndReview(variant.id, variant.notes),
        )
        return {
          ...replaced,
          features: computeMelodyFeatures(replaced.notes, harmonicMap, 0, totalBeats),
        }
      })
      recommendationCandidates = melodyVariants
        .filter((variant) => variant.sectionId === sectionId && variant.batchId === state.activeBatchId)
        .map((variant) => ({
          candidateId: variant.id,
          qualityScore:
            variant.generationDiagnostics?.qualityScore ??
            variant.contentQuality?.overallQuality ??
            70,
        }))
    } else if (generator === "phrase" && state.activePhraseBatchId) {
      recommendationBatchId = state.activePhraseBatchId
      phraseCandidates = prev.phraseCandidates.map((candidate) =>
        candidate.sectionId === sectionId && candidate.batchId === state.activePhraseBatchId
          ? { ...candidate, notes: executeAndReview(candidate.id, candidate.notes) }
          : candidate,
      )
      recommendationCandidates = phraseCandidates
        .filter((candidate) => candidate.sectionId === sectionId && candidate.batchId === state.activePhraseBatchId)
        .map((candidate) => ({ candidateId: candidate.id, qualityScore: candidate.qualityScore }))
    } else if (generator === "signature" && state.activeSignaturePhraseBatchId) {
      recommendationBatchId = state.activeSignaturePhraseBatchId
      signaturePhraseCandidates = prev.signaturePhraseCandidates.map((candidate) =>
        candidate.sectionId === sectionId && candidate.batchId === state.activeSignaturePhraseBatchId
          ? { ...candidate, notes: executeAndReview(candidate.id, candidate.notes) }
          : candidate,
      )
      recommendationCandidates = signaturePhraseCandidates
        .filter(
          (candidate) =>
            candidate.sectionId === sectionId &&
            candidate.batchId === state.activeSignaturePhraseBatchId,
        )
        .map((candidate) => ({ candidateId: candidate.id, qualityScore: candidate.score.overall }))
    } else if (
      (generator === "counter" || generator === "decoration") &&
      state.activeReactiveBatchId
    ) {
      const kind = generator === "counter" ? "counter" : "decoration"
      recommendationBatchId = state.activeReactiveBatchId
      const melodyNotes = assignedMelody?.notes ?? []
      const analysis = analyzeMelodyActivity(melodyNotes, totalBeats)
      reactiveLayerCandidates = reactiveLayerCandidates.map((candidate) => {
        if (
          candidate.sectionId !== sectionId ||
          candidate.batchId !== state.activeReactiveBatchId ||
          candidate.kind !== kind
        ) return candidate
        const execution = execute(candidate.notes)
        const notes = execution.notes
        const collisions = assessReactiveLayerCollisions(melodyNotes, notes, analysis)
        candidatePerformanceReviews[candidate.id] = reviewPerformanceExecution(
          candidate.id,
          candidate.notes,
          execution,
          plan,
          executionContext,
          { hasBlockingCollision: collisions.hasBlockingCollision },
        )
        return {
          ...candidate,
          notes,
          collisions,
        }
      })
      recommendationCandidates = reactiveLayerCandidates
        .filter(
          (candidate) =>
            candidate.sectionId === sectionId &&
            candidate.batchId === state.activeReactiveBatchId &&
            candidate.kind === kind,
        )
        .map((candidate) => ({
          candidateId: candidate.id,
          qualityScore: candidate.quality.overallQuality,
        }))
    }

    const sectionPlans = { ...(prev.sectionPerformancePlans?.[sectionId] ?? {}) }
    sectionPlans[plan.role] = { ...plan, velocityRange: [...plan.velocityRange] as [number, number] }
    const performanceBatchRecommendations = {
      ...(prev.performanceBatchRecommendations ?? {}),
    }
    if (recommendationBatchId && recommendationCandidates.length > 0) {
      performanceBatchRecommendations[recommendationBatchId] = recommendPerformedCandidate(
        recommendationBatchId,
        recommendationCandidates.flatMap((candidate) => {
          const review = candidatePerformanceReviews[candidate.candidateId]
          return review ? [{ ...candidate, review }] : []
        }),
      )
    }
    set({
      project: {
        ...prev,
        melodyVariants,
        phraseCandidates,
        signaturePhraseCandidates,
        reactiveLayerCandidates,
        sectionPerformancePlans: {
          ...(prev.sectionPerformancePlans ?? {}),
          [sectionId]: sectionPlans,
        },
        candidatePerformanceReviews,
        performanceBatchRecommendations,
      },
    })
    get().persist()
  },

  regenerateDecoration: (candidateId) => {
    const prev = get().project
    const current = (prev.reactiveLayerCandidates ?? []).find(
      (candidate) =>
        candidate.id === candidateId && candidate.kind === "decoration",
    )
    if (!current || !current.decorationPlan) return
    const input = decorationGenerationInput(prev, current.sectionId, current.seed, {
      type: current.decorationPlan.type,
      character: current.decorationPlan.character,
      direction: current.decorationPlan.direction,
      length:
        current.decorationPlan.lengthBeats ===
        parseTimeSignature(prev.song.timeSignature).beatsPerBar
          ? "bar"
          : current.decorationPlan.lengthBeats <= 2
            ? 2
            : 4,
      density: current.decorationPlan.density,
    })
    if (!input) return
    const ruleContext = {
      generatorTarget: "decoration" as const,
      sectionRole: input.sectionRole,
      transition: input.nextSectionRole
        ? `${input.sectionRole}->${input.nextSectionRole}`
        : undefined,
    }
    const experimentPreset = current.techniqueExperiment
      ? techniqueExperimentPreset(
          current.techniqueExperiment
            .presetId as TechniqueExperimentPresetId,
        )
      : null
    const experimentRules = experimentPreset
      ? resolvePublicComposerRules(
          ruleContext,
          techniqueExperimentRules(
            experimentPreset.id,
            ruleContext,
          ),
        )
      : null
    const regenerationInput: GenerateDecorationInput = {
      ...input,
      composerRules:
        current.techniqueExperiment?.mode === "treatment" &&
        experimentRules
          ? experimentRules
          : resolvePublicComposerRules(ruleContext),
      techniqueFitSelectionWeight:
        current.techniqueExperiment?.mode === "treatment"
          ? 0.05
          : 0,
    }
    const siblings = (prev.reactiveLayerCandidates ?? []).filter(
      (candidate) =>
        candidate.batchId === current.batchId &&
        candidate.id !== current.id &&
        candidate.kind === "decoration" &&
        candidate.techniqueExperiment?.mode ===
          current.techniqueExperiment?.mode,
    )
    const generated = buildRegeneratedDecoration(
      regenerationInput,
      current,
      siblings,
    )
    if (!generated) {
      set({ workflowNotice: "別のDecoration案を生成できませんでした。" })
      return
    }
    const replacement: ReactiveLayerCandidate = {
      ...generated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      notes: generated.notes.map((note) => ({ ...note, id: crypto.randomUUID() })),
      createdAt: new Date().toISOString(),
      techniqueFitScore: experimentRules
        ? decorationTechniqueFitScore(
            generated.decorationPlan,
            experimentRules,
          )
        : generated.techniqueFitScore,
      techniqueExperiment: current.techniqueExperiment,
    }
    const assignments = { ...(prev.sectionDecorationLayerAssignments ?? {}) }
    if (assignments[current.sectionId] === current.id) {
      assignments[current.sectionId] = replacement.id
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        reactiveLayerCandidates: (prev.reactiveLayerCandidates ?? []).map((candidate) =>
          candidate.id === current.id ? replacement : candidate,
        ),
        sectionDecorationLayerAssignments: assignments,
      },
      workflowNotice: null,
    })
    get().persist()
  },

  setReactiveLayerReviewState: (candidateId, reviewState) => {
    const prev = get().project
    set({
      project: {
        ...prev,
        reactiveLayerCandidates: (prev.reactiveLayerCandidates ?? []).map((candidate) =>
          candidate.id === candidateId ? { ...candidate, reviewState } : candidate,
        ),
      },
    })
    get().persist()
  },

  assignReactiveLayer: (candidateId) => {
    const prev = get().project
    const candidate = (prev.reactiveLayerCandidates ?? []).find(
      (item) => item.id === candidateId,
    )
    if (!candidate) return
    if (
      candidate.kind === "counter" &&
      prev.sectionMelodyAssignments[candidate.sectionId] !==
        candidate.targetMelodyVariantId
    ) {
      set({ workflowNotice: "この候補は現在のActive Melody向けではありません。" })
      return
    }
    if (candidate.kind === "decoration" && candidate.decorationPlan) {
      const currentInput = decorationGenerationInput(
        prev,
        candidate.sectionId,
        candidate.seed,
        {
          type: candidate.decorationPlan.type,
          character: candidate.decorationPlan.character,
          direction: candidate.decorationPlan.direction,
          length:
            candidate.decorationPlan.lengthBeats ===
            parseTimeSignature(prev.song.timeSignature).beatsPerBar
              ? "bar"
              : candidate.decorationPlan.lengthBeats <= 2
                ? 2
                : 4,
          density: candidate.decorationPlan.density,
        },
      )
      if (
        !currentInput ||
        decorationFingerprintForInput(currentInput) !==
          candidate.structureFingerprint
      ) {
        set({
          workflowNotice:
            "セクション構造またはコードが変更されています。Decorationを再生成してください。",
        })
        return
      }
    }
    const counterpartId =
      candidate.kind === "decoration"
        ? prev.sectionReactiveLayerAssignments?.[candidate.sectionId]
        : prev.sectionDecorationLayerAssignments?.[candidate.sectionId]
    const counterpart = counterpartId
      ? (prev.reactiveLayerCandidates ?? []).find(
          (item) => item.id === counterpartId,
        )
      : undefined
    const activeMelodyId = prev.sectionMelodyAssignments[candidate.sectionId]
    const activeMelody = prev.melodyVariants.find(
      (variant) =>
        variant.id === activeMelodyId &&
        variant.sectionId === candidate.sectionId,
    )
    const section = prev.sections.find(
      (item) => item.id === candidate.sectionId,
    )
    const totalBeats = section
      ? section.lengthBars *
        parseTimeSignature(prev.song.timeSignature).beatsPerBar
      : 0
    const compatibility = evaluateReactiveLayerCompatibility(
      activeMelody?.notes ?? [],
      counterpart ? [candidate, counterpart] : [candidate],
      totalBeats,
    )
    if (compatibility.hasBlockingConflict) {
      set({
        workflowNotice: `この候補は採用できません: ${compatibility.reasons[0]}`,
      })
      return
    }
    const assignmentPatch =
      candidate.kind === "decoration"
        ? {
            sectionDecorationLayerAssignments: {
              ...(prev.sectionDecorationLayerAssignments ?? {}),
              [candidate.sectionId]: candidate.id,
            },
          }
        : {
            sectionReactiveLayerAssignments: {
              ...(prev.sectionReactiveLayerAssignments ?? {}),
              [candidate.sectionId]: candidate.id,
            },
          }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        ...assignmentPatch,
      },
      workflowNotice: null,
    })
    get().persist()
  },

  setActiveMelody: (variantId) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((candidate) => candidate.id === variantId)
    if (!variant) return
    const sectionReactiveLayerAssignments = {
      ...(prev.sectionReactiveLayerAssignments ?? {}),
    }
    if (prev.sectionMelodyAssignments[variant.sectionId] !== variantId) {
      delete sectionReactiveLayerAssignments[variant.sectionId]
    }
    set({
      project: {
        ...prev,
        activeMelodyId: variantId,
        sectionMelodyAssignments: {
          ...prev.sectionMelodyAssignments,
          [variant.sectionId]: variantId,
        },
        sectionReactiveLayerAssignments,
      },
    })
    get().persist()
  },

  assignVariantToSection: (sectionId, variantId) => {
    const prev = get().project
    if (
      variantId &&
      !prev.melodyVariants.some((variant) => variant.id === variantId && variant.sectionId === sectionId)
    ) {
      return
    }
    const assignments = { ...prev.sectionMelodyAssignments }
    if (variantId) assignments[sectionId] = variantId
    else delete assignments[sectionId]
    const sectionReactiveLayerAssignments = {
      ...(prev.sectionReactiveLayerAssignments ?? {}),
    }
    if (prev.sectionMelodyAssignments[sectionId] !== variantId) {
      delete sectionReactiveLayerAssignments[sectionId]
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        activeMelodyId: variantId ?? prev.activeMelodyId,
        sectionMelodyAssignments: assignments,
        sectionReactiveLayerAssignments,
      },
    })
    get().persist()
  },

  setVariantReviewState: (variantId, reviewState) => {
    const prev = get().project
    set({
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((variant) =>
          variant.id === variantId ? { ...variant, reviewState } : variant,
        ),
      },
    })
    get().persist()
  },

  selectVariantFromHistory: (variantId) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((candidate) => candidate.id === variantId)
    if (!variant) return
    const sectionReactiveLayerAssignments = {
      ...(prev.sectionReactiveLayerAssignments ?? {}),
    }
    if (prev.sectionMelodyAssignments[variant.sectionId] !== variantId) {
      delete sectionReactiveLayerAssignments[variant.sectionId]
    }
    set({
      project: {
        ...prev,
        activeMelodyId: variantId,
        sectionMelodyAssignments: {
          ...prev.sectionMelodyAssignments,
          [variant.sectionId]: variantId,
        },
        sectionReactiveLayerAssignments,
      },
      activeBatchId: null,
      activeCandidateIndex: 0,
    })
    get().persist()
  },

  renameVariant: (variantId, name) => {
    const prev = get().project
    set({ project: { ...prev, melodyVariants: prev.melodyVariants.map((v) => (v.id === variantId ? { ...v, name } : v)) } })
    get().persist()
  },

  deleteVariant: (variantId) => {
    const prev = get().project
    const sectionMelodyAssignments = Object.fromEntries(
      Object.entries(prev.sectionMelodyAssignments).filter(([, assignedId]) => assignedId !== variantId),
    )
    const removedReactiveIds = new Set(
      (prev.reactiveLayerCandidates ?? [])
        .filter((candidate) => candidate.targetMelodyVariantId === variantId)
        .map((candidate) => candidate.id),
    )
    const sectionReactiveLayerAssignments = Object.fromEntries(
      Object.entries(prev.sectionReactiveLayerAssignments ?? {}).filter(
        ([, assignedId]) => !removedReactiveIds.has(assignedId),
      ),
    )
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.filter((v) => v.id !== variantId),
        activeMelodyId: prev.activeMelodyId === variantId ? null : prev.activeMelodyId,
        sectionMelodyAssignments,
        reactiveLayerCandidates: (prev.reactiveLayerCandidates ?? []).filter(
          (candidate) => candidate.targetMelodyVariantId !== variantId,
        ),
        sectionReactiveLayerAssignments,
        candidatePerformanceReviews: Object.fromEntries(
          Object.entries(prev.candidatePerformanceReviews ?? {}).filter(
            ([candidateId]) => candidateId !== variantId && !removedReactiveIds.has(candidateId),
          ),
        ),
        performanceBatchRecommendations: Object.fromEntries(
          Object.entries(prev.performanceBatchRecommendations ?? {}).filter(
            ([, recommendation]) =>
              !recommendation.consideredCandidateIds.some(
                (candidateId) => candidateId === variantId || removedReactiveIds.has(candidateId),
              ),
          ),
        ),
      },
    })
    get().persist()
  },

  toggleNoteLock: (variantId, noteId, lock) => {
    const prev = get().project
    set({
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) => {
          if (v.id !== variantId) return v
          return replaceVariantNotes(
            v,
            v.notes.map((n) => {
              if (n.id !== noteId) return n
              const has = n.locks.includes(lock)
              return { ...n, locks: has ? n.locks.filter((l) => l !== lock) : [...n.locks, lock] }
            }),
          )
        }),
      },
    })
    get().persist()
  },

  toggleBarLock: (variantId, barIndex) => {
    const prev = get().project
    set({
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) => {
          if (v.id !== variantId) return v
          const has = v.lockedBars.includes(barIndex)
          return { ...v, lockedBars: has ? v.lockedBars.filter((b) => b !== barIndex) : [...v.lockedBars, barIndex] }
        }),
      },
    })
    get().persist()
  },

  updateNote: (variantId, noteId, patch) => {
    const prev = get().project
    const editedVariant = prev.melodyVariants.find((variant) => variant.id === variantId)
    const candidatePerformanceReviews = { ...(prev.candidatePerformanceReviews ?? {}) }
    delete candidatePerformanceReviews[variantId]
    const performanceBatchRecommendations = { ...(prev.performanceBatchRecommendations ?? {}) }
    if (editedVariant?.batchId) delete performanceBatchRecommendations[editedVariant.batchId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) =>
          v.id === variantId
            ? replaceVariantNotes(v, v.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)))
            : v,
        ),
        candidatePerformanceReviews,
        performanceBatchRecommendations,
      },
    })
    get().persist()
  },

  deleteNote: (variantId, noteId) => {
    const prev = get().project
    const editedVariant = prev.melodyVariants.find((variant) => variant.id === variantId)
    const candidatePerformanceReviews = { ...(prev.candidatePerformanceReviews ?? {}) }
    delete candidatePerformanceReviews[variantId]
    const performanceBatchRecommendations = { ...(prev.performanceBatchRecommendations ?? {}) }
    if (editedVariant?.batchId) delete performanceBatchRecommendations[editedVariant.batchId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) =>
          v.id === variantId ? replaceVariantNotes(v, v.notes.filter((n) => n.id !== noteId)) : v,
        ),
        candidatePerformanceReviews,
        performanceBatchRecommendations,
      },
    })
    get().persist()
  },

  regenerateRange: (variantId, startBeat, endBeat, lockPatch = {}) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((v) => v.id === variantId)
    const section = variant && prev.sections.find((s) => s.id === variant.sectionId)
    if (!variant || !section) return
    // Issue #41: 部分再生成は歌唱メロディ専用の処理。melody以外のcontent候補へ通すと
    // 生成結果がMelody Engineの出力に置き換わり、leadContent/layersが失われてしまう。
    if (resolvedLeadContent(variant) !== "melody") {
      set({ workflowNotice: "この候補はメロディ以外の内容(Motif/Ostinato/Drone等)のため、範囲の部分再生成は使えません。Generateで作り直してください。" })
      return
    }
    const chords = prev.chords.filter((c) => c.sectionId === variant.sectionId)
    const harmonicMap = buildHarmonicMap(chords)
    const profile = effectiveSongProfile(prev, variant.sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const baseParams = resolveGenerationParams(profile, section.role, settings.density, settings.drama, prev.song.key)
    const generatorProfile = variant.generatorProfile ?? "standard"
    const params = applyProfileOverride(
      baseParams,
      generatorProfile,
      generatorProfileIntensity(generatorProfile, section.role),
    )

    const totalBeats = section.lengthBars * parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const locks: RangeRegenerationLocks = {
      pitch: false,
      rhythm: false,
      motif: false,
      opening: false,
      ending: false,
      ...lockPatch,
    }
    const baseSeed = createSeed()
    const result = generateRangeRegenerationCandidates({
      sourceNotes: variant.notes,
      phrasePlans: variant.phrasePlans,
      lockedBars: variant.lockedBars,
      timeSignature: prev.song.timeSignature,
      startBeat,
      endBeat,
      totalBeats,
      harmonicMap,
      range,
      params,
      density: settings.density,
      profile: generatorProfile,
      locks,
      seed: baseSeed,
    })
    if (result.candidates.length === 0) {
      set({
        workflowNotice:
          "品質下限を維持した候補を作れませんでした。範囲または保持条件を緩めてください。",
      })
      return
    }
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const variants: MelodyVariant[] = result.candidates.map((candidate, index) =>
      replaceVariantNotes(
        {
          ...variant,
          id: crypto.randomUUID(),
          name: `${variant.name} – Range ${index + 1}`,
          sourceMode: "regenerate-range",
          phrasePlans: candidate.plans,
          features: computeMelodyFeatures(candidate.notes, harmonicMap, 0, totalBeats),
          seed: candidate.seed,
          parentMelodyId: variant.id,
          batchId,
          createdAt,
          patternIndex: (index + 1) as 1 | 2 | 3,
          reviewState: null,
          generationDiagnostics: undefined,
          openingIntent:
            locks.opening || startBeat >= (variant.phrasePlans[0]?.phraseLengthBeats ?? 8)
              ? variant.openingIntent
              : undefined,
          candidateMelodyDNA: locks.motif ? variant.candidateMelodyDNA : undefined,
          elegiacPlan: locks.motif && locks.ending ? variant.elegiacPlan : undefined,
          profileExpressionPlan: undefined,
          prosodyPlan: locks.rhythm ? variant.prosodyPlan : undefined,
          rangeRegeneration: {
            range: { startBeat, endBeat },
            locks,
            candidatePoolIndex: candidate.candidatePoolIndex,
            qualityScore: candidate.qualityScore,
          },
        },
        candidate.notes,
      ),
    )

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: [...prev.melodyVariants, ...variants],
      },
      activeBatchId: batchId,
      activeCandidateIndex: 0,
      workflowNotice: result.overConstrained
        ? "Pitch/MotifとRhythmを保持したため実音は固定されています。Lockは解除していません。"
        : result.candidates.length < 3
          ? `品質下限を維持できた${result.candidates.length}候補だけを返しました。`
          : null,
    })
    get().persist()
  },

  applySeedOperation: (sourceVariantId, op, seedNoteIds, opts) => {
    const prev = get().project
    const source = prev.melodyVariants.find((v) => v.id === sourceVariantId)
    const section = source && prev.sections.find((s) => s.id === source.sectionId)
    if (!source || !section) return
    // Issue #41: Seed発展操作も歌唱メロディ専用。melody以外のcontent候補へは適用しない
    // (適用するとMelody Engineの出力へ置き換わり、Content Modeが失われる)。
    if (resolvedLeadContent(source) !== "melody") {
      set({ workflowNotice: "この候補はメロディ以外の内容(Motif/Ostinato/Drone等)のため、Seedの発展操作は使えません。" })
      return
    }
    const seedNotes = source.notes.filter((n) => seedNoteIds.includes(n.id))
    if (seedNotes.length === 0) return

    const chords = prev.chords.filter((c) => c.sectionId === source.sectionId)
    const harmonicMap = buildHarmonicMap(chords)
    const profile = effectiveSongProfile(prev, source.sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const params = resolveGenerationParams(profile, section.role, settings.density, settings.drama, prev.song.key)
    const seedValue = createSeed()

    let notes: MelodyNote[]
    switch (op) {
      case "continue":
        notes = seedContinue(seedNotes, (opts?.continuationBars ?? 2) * parseTimeSignature(prev.song.timeSignature).beatsPerBar, harmonicMap, range, params, seedValue)
        break
      case "expand":
        notes = seedExpand(seedNotes, (opts?.expandToBars ?? 4) * parseTimeSignature(prev.song.timeSignature).beatsPerBar, harmonicMap, range, params, seedValue)
        break
      case "answer-phrase":
        notes = seedAnswerPhrase(seedNotes, harmonicMap, range, params, seedValue)
        break
      case "variation-rhythm":
        notes = seedVariation(seedNotes, "rhythm", harmonicMap, range, params, seedValue)
        break
      case "variation-pitch":
        notes = seedVariation(seedNotes, "pitch", harmonicMap, range, params, seedValue)
        break
      case "lift":
        notes = seedLift(seedNotes, harmonicMap, range)
        break
      case "restrain":
        notes = seedRestrain(seedNotes, harmonicMap, range)
        break
      default:
        notes = seedNotes
    }

    const totalBeats = section.lengthBars * parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const features = computeMelodyFeatures(notes, harmonicMap, 0, totalBeats)
    const batchId = crypto.randomUUID()
    const newVariant: MelodyVariant = {
      id: crypto.randomUUID(),
      name: `${source.name} - ${op}`,
      sectionId: source.sectionId,
      sourceMode: "develop-seed",
      notes,
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features,
      generatorVersion: "1.0",
      seed: seedValue,
      songProfile: profile,
      parentMelodyId: source.id,
      batchId,
      createdAt: new Date().toISOString(),
    }

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, melodyVariants: [...prev.melodyVariants, newVariant] },
      activeBatchId: batchId,
      activeCandidateIndex: 0,
    })
    get().persist()
  },

  undo: () => {
    const { history, project, future } = get()
    if (history.length === 0) return
    const prevState = history[history.length - 1]
    set({ project: prevState, history: history.slice(0, -1), future: [snapshot(project), ...future] })
    get().persist()
  },

  redo: () => {
    const { future, project, history } = get()
    if (future.length === 0) return
    const nextState = future[0]
    set({ project: nextState, future: future.slice(1), history: [...history, snapshot(project)] })
    get().persist()
  },
}))
