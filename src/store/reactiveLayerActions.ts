import { parseTimeSignature } from "@/core/section"
import type { MelodyNote } from "@/core/melody"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { computeMelodyFeatures } from "@/melody-engine/features"
import { createSeed } from "@/core/rng"
import { replaceVariantNotes } from "@/core/sectionLayers"
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import { annotateArrangementApproaches } from "@/core/arrangementSurprise"
import { analyzeMelodyActivity, assessReactiveLayerCollisions, evaluateReactiveLayerCompatibility } from "@/melody-engine/reactiveLayerAnalysis"
import {
  applyPerformanceExecution,
  resolvePerformanceSpec,
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
  type GenerateDecorationInput,
} from "@/melody-engine/decorationGenerator"

import {
  resolvePublicComposerRules,
  techniqueExperimentPreset,
  techniqueExperimentRules,
  type TechniqueExperimentPresetId,
} from "@/composer-intelligence"

import {
  counterGenerationInput,
  arrangementSurpriseContext,
  decorationGenerationInput,
  performGeneratedNotes,
} from "./generationInputs"
import { snapshot } from "./storeHelpers"
import type { ProjectState } from "./useProjectStore"

const COUNTER_EXPERIMENT_CANDIDATES_PER_MODE = 5

type SetState = (partial: Partial<ProjectState>) => void
type GetState = () => ProjectState

/**
 * 対旋律(Counter)と装飾(Decoration)の生成・採用・作り直し、演奏設定の反映。
 * useProjectStore から分けた操作群。state と他の操作へは set / get 経由でアクセスする。
 */
export function createReactiveLayerActions(
  set: SetState,
  get: GetState,
): Pick<ProjectState, "generateCounterForSection" | "setActiveReactiveCandidateIndex" | "regenerateCounter" | "generateDecorationsForSection" | "applyPerformanceToLatestGeneration" | "regenerateDecoration" | "setReactiveLayerReviewState" | "assignReactiveLayer"> {
  return {
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
          "対旋律の生成には、有効なコード進行と採用済みの主旋律が必要です。",
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
          "主旋律に対旋律を入れる十分な隙間がありません。主旋律の休符や音の長さを調整するか、別のセクションで試してください。",
      })
      return
    }
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const rawCandidates: ReactiveLayerCandidate[] = generated.map(
      ({ candidate, experimentMode }, index) => {
        const identifiedNotes = candidate.notes.map((note) => ({
          ...note,
          id: crypto.randomUUID(),
        }))
        const performed = performGeneratedNotes(prev, sectionId, identifiedNotes, "counter-voice")
        return {
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
          notes: performed.notes,
          performanceSpec: performed.performanceSpec,
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
        }
      },
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
          ? `品質の基準を満たす対旋律候補は${candidates.length}件でした。`
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
      set({ workflowNotice: "主旋律が変わっています。対旋律を新しく生成してください。" })
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
    const identifiedNotes = generated.notes.map((note) => ({
      ...note,
      id: crypto.randomUUID(),
    }))
    const performed = performGeneratedNotes(
      prev,
      current.sectionId,
      identifiedNotes,
      "counter-voice",
    )
    const replacement: ReactiveLayerCandidate = {
      ...generated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      notes: performed.notes,
      performanceSpec: performed.performanceSpec,
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
          "装飾の生成には、有効なコード進行を持つセクションが必要です。",
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
      set({ workflowNotice: "品質の基準を満たす装飾候補を生成できませんでした。" })
      return
    }
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const rawCandidates: ReactiveLayerCandidate[] = generated.map(
      ({ candidate, experimentMode }, index) => {
        const identifiedNotes = candidate.notes.map((note) => ({
          ...note,
          id: crypto.randomUUID(),
        }))
        const performed = performGeneratedNotes(prev, sectionId, identifiedNotes, "transition-color")
        return {
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
          notes: performed.notes,
          performanceSpec: performed.performanceSpec,
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
        }
      },
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
          ? `品質の基準を満たす装飾候補は${candidates.length}件でした。`
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
      bpm: prev.song.tempo,
      chordBoundaryBeats: sectionChords.map((chord) => chord.startBeat),
      melodyNotes: assignedMelody?.notes,
    }
    const resolvedPlan: PerformanceExecutionPlan = {
      ...plan,
      performanceSpec: resolvePerformanceSpec(plan),
    }
    const execute = (notes: MelodyNote[]) =>
      applyPerformanceExecution(notes, resolvedPlan, executionContext)
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
        resolvedPlan,
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
        if (
          variant.sourceMode === "import-midi" ||
          variant.sectionId !== sectionId ||
          variant.batchId !== state.activeBatchId
        ) return variant
        const replaced = replaceVariantNotes(
          variant,
          executeAndReview(variant.id, variant.notes),
        )
        return {
          ...replaced,
          performanceSpec: resolvedPlan.performanceSpec,
          features: computeMelodyFeatures(replaced.notes, harmonicMap, 0, totalBeats),
        }
      })
      recommendationCandidates = melodyVariants
        .filter(
          (variant) =>
            variant.sourceMode !== "import-midi" &&
            variant.sectionId === sectionId &&
            variant.batchId === state.activeBatchId,
        )
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
          ? {
              ...candidate,
              notes: executeAndReview(candidate.id, candidate.notes),
              performanceSpec: resolvedPlan.performanceSpec,
            }
          : candidate,
      )
      recommendationCandidates = phraseCandidates
        .filter((candidate) => candidate.sectionId === sectionId && candidate.batchId === state.activePhraseBatchId)
        .map((candidate) => ({ candidateId: candidate.id, qualityScore: candidate.qualityScore }))
    } else if (generator === "signature" && state.activeSignaturePhraseBatchId) {
      recommendationBatchId = state.activeSignaturePhraseBatchId
      signaturePhraseCandidates = prev.signaturePhraseCandidates.map((candidate) =>
        candidate.sectionId === sectionId && candidate.batchId === state.activeSignaturePhraseBatchId
          ? {
              ...candidate,
              notes: executeAndReview(candidate.id, candidate.notes),
              performanceSpec: resolvedPlan.performanceSpec,
            }
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
          resolvedPlan,
          executionContext,
          { hasBlockingCollision: collisions.hasBlockingCollision },
        )
        return {
          ...candidate,
          notes,
          collisions,
          performanceSpec: resolvedPlan.performanceSpec,
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
    sectionPlans[resolvedPlan.role] = {
      ...resolvedPlan,
      velocityRange: [...resolvedPlan.velocityRange] as [number, number],
    }
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
      set({ workflowNotice: "別の装飾案を生成できませんでした。" })
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
    const currentAssignment = candidate.kind === "decoration"
      ? prev.sectionDecorationLayerAssignments?.[candidate.sectionId]
      : prev.sectionReactiveLayerAssignments?.[candidate.sectionId]
    if (currentAssignment === candidate.id) {
      const assignments = candidate.kind === "decoration"
        ? { ...(prev.sectionDecorationLayerAssignments ?? {}) }
        : { ...(prev.sectionReactiveLayerAssignments ?? {}) }
      delete assignments[candidate.sectionId]
      set({
        history: [...get().history, snapshot(prev)],
        future: [],
        project: candidate.kind === "decoration"
          ? { ...prev, sectionDecorationLayerAssignments: assignments }
          : { ...prev, sectionReactiveLayerAssignments: assignments },
        workflowNotice: null,
      })
      get().persist()
      return
    }
    if (
      candidate.kind === "counter" &&
      prev.sectionMelodyAssignments[candidate.sectionId] !==
        candidate.targetMelodyVariantId
    ) {
      set({ workflowNotice: "この候補は現在の主旋律向けではありません。" })
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
            "セクション構造またはコードが変わっています。装飾を生成し直してください。",
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
  }
}
