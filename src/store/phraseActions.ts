import { createSeed } from "@/core/rng"
import type { PhraseCandidate } from "@/core/phrase"
import type { SignaturePhraseCandidate } from "@/core/signaturePhrase"
import {
  generatePhraseCandidates,
  phraseTechniqueFitScore,
  regeneratePhraseCandidate as buildRegeneratedPhrase,
  type GeneratePhrasesInput,
} from "@/phrase-engine/generatePhrases"
import { generateSignaturePhraseCandidates, regenerateSignaturePhraseCandidate as buildRegeneratedSignaturePhrase } from "@/phrase-engine/generateSignaturePhrases"
import { annotateArrangementApproaches } from "@/core/arrangementSurprise"

import {
  resolvePublicComposerRules,
  techniqueExperimentPreset,
  techniqueExperimentRules,
  type TechniqueExperimentPresetId,
} from "@/composer-intelligence"

import {
  phraseGenerationInput,
  signaturePhraseGenerationInput,
  arrangementSurpriseContext,
  performGeneratedNotes,
} from "./generationInputs"
import { snapshot } from "./storeHelpers"
import type { ProjectState } from "./useProjectStore"

type SetState = (partial: Partial<ProjectState>) => void
type GetState = () => ProjectState

/**
 * 短いフレーズ(Phrase)とイントロ(Signature Phrase)の生成・採用・作り直し。
 * useProjectStore から分けた操作群。state と他の操作へは set / get 経由でアクセスする。
 */
export function createPhraseActions(
  set: SetState,
  get: GetState,
): Pick<ProjectState, "generatePhrasesForSection" | "setActivePhraseCandidateIndex" | "togglePhraseAssignment" | "regeneratePhrase" | "generateSignaturePhrasesForSection" | "setActiveSignaturePhraseCandidateIndex" | "toggleSignaturePhraseAssignment" | "regenerateSignaturePhrase"> {
  return {
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
        group.candidates.map((candidate, index) => {
          const performed = performGeneratedNotes(prev, sectionId, candidate.notes, "lead-focus")
          return {
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
            notes: performed.notes,
            performanceSpec: performed.performanceSpec,
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
          }
        }),
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

  togglePhraseAssignment: (candidateId) => {
    const prev = get().project
    const candidate = prev.phraseCandidates.find((item) => item.id === candidateId)
    if (!candidate) return
    const assignments = { ...(prev.sectionPhraseAssignments ?? {}) }
    if (assignments[candidate.sectionId] === candidate.id) delete assignments[candidate.sectionId]
    else assignments[candidate.sectionId] = candidate.id
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sectionPhraseAssignments: assignments },
      workflowNotice: null,
    })
    get().persist()
  },

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
    const performed = performGeneratedNotes(
      prev,
      current.sectionId,
      regenerated.notes,
      "lead-focus",
    )
    const replacement: PhraseCandidate = {
      ...regenerated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      createdAt: new Date().toISOString(),
      notes: performed.notes,
      performanceSpec: performed.performanceSpec,
      techniqueFitScore: experimentRules
        ? phraseTechniqueFitScore(
            regenerated.intent,
            experimentRules,
          )
        : regenerated.techniqueFitScore,
      techniqueExperiment: current.techniqueExperiment,
    }
    const sectionPhraseAssignments = { ...(prev.sectionPhraseAssignments ?? {}) }
    if (sectionPhraseAssignments[current.sectionId] === current.id) {
      sectionPhraseAssignments[current.sectionId] = replacement.id
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        phraseCandidates: prev.phraseCandidates.map((candidate) =>
          candidate.id === candidateId ? replacement : candidate,
        ),
        sectionPhraseAssignments,
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
          "イントロフレーズの生成には、選んだ長さが収まるセクションと有効なコード進行が必要です。",
      })
      return
    }
    const generated = generateSignaturePhraseCandidates(input)
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const rawCandidates: SignaturePhraseCandidate[] = generated.map(
      (candidate, index) => {
        const performed = performGeneratedNotes(prev, sectionId, candidate.notes, "lead-focus")
        return {
          ...candidate,
          id: crypto.randomUUID(),
          batchId,
          name: `Signature ${index + 1}`,
          notes: performed.notes,
          performanceSpec: performed.performanceSpec,
          createdAt,
        }
      },
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

  toggleSignaturePhraseAssignment: (candidateId) => {
    const prev = get().project
    const candidate = prev.signaturePhraseCandidates.find((item) => item.id === candidateId)
    if (!candidate) return
    const assignments = { ...(prev.sectionSignaturePhraseAssignments ?? {}) }
    if (assignments[candidate.sectionId] === candidate.id) delete assignments[candidate.sectionId]
    else assignments[candidate.sectionId] = candidate.id
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sectionSignaturePhraseAssignments: assignments },
      workflowNotice: null,
    })
    get().persist()
  },

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
    const performed = performGeneratedNotes(
      prev,
      current.sectionId,
      regenerated.notes,
      "lead-focus",
    )
    const replacement: SignaturePhraseCandidate = {
      ...regenerated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      notes: performed.notes,
      performanceSpec: performed.performanceSpec,
      createdAt: new Date().toISOString(),
    }
    const sectionSignaturePhraseAssignments = {
      ...(prev.sectionSignaturePhraseAssignments ?? {}),
    }
    if (sectionSignaturePhraseAssignments[current.sectionId] === current.id) {
      sectionSignaturePhraseAssignments[current.sectionId] = replacement.id
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
        sectionSignaturePhraseAssignments,
      },
      workflowNotice: null,
    })
    get().persist()
  },
  }
}
