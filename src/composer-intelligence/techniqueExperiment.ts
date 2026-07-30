import type {
  ComposerRule,
  ComposerRuleContext,
} from "./types"
import type { MelodyGeneratorProfile } from "@/core/melody"

export type TechniqueExperimentPresetId =
  | "space-microvariation"
  | "negative-space-groove"
  | "stable-loop-local-mutation"
  | "slow-burn-escalation"

export interface TechniqueExperimentPreset {
  id: TechniqueExperimentPresetId
  label: string
  description: string
  techniqueNames: readonly string[]
  validationLevel: "exploratory" | "confirmed"
  recommendedProfiles: readonly MelodyGeneratorProfile[]
  rules: readonly ComposerRule[]
}

const NEGATIVE_SPACE_GROOVE_RULE: ComposerRule = {
  id: "experiment:draft:negative-space-groove",
  origin: "experimental",
  status: "validated",
  priority: 20,
  confidence: 0.8,
  when: { generatorTargets: ["melody"] },
  prefer: {
    rhythmGrammar: [
      { value: "sustained", weight: 0.6 },
      { value: "balanced", weight: 0.4 },
    ],
    phraseArchitecture: [
      { value: "long-arc", weight: 0.6 },
      { value: "asymmetric", weight: 0.4 },
    ],
  },
}

const STABLE_LOOP_LOCAL_MUTATION_RULE: ComposerRule = {
  id: "experiment:draft:stable-loop-local-mutation",
  origin: "experimental",
  status: "validated",
  priority: 20,
  confidence: 0.8,
  when: { generatorTargets: ["melody"] },
  prefer: {
    motifIdentity: [
      { value: "repeated-cell", weight: 0.6 },
      { value: "turn-cell", weight: 0.4 },
    ],
    rhythmGrammar: [
      { value: "cyclic", weight: 0.65 },
      { value: "balanced", weight: 0.35 },
    ],
    developmentStrategy: [
      { value: "fragmentation", weight: 0.55 },
      { value: "delayed-return", weight: 0.45 },
    ],
  },
}

const SLOW_BURN_ESCALATION_RULE: ComposerRule = {
  id: "experiment:draft:slow-burn-escalation",
  origin: "experimental",
  status: "validated",
  priority: 20,
  confidence: 0.8,
  when: { generatorTargets: ["melody"] },
  prefer: {
    registerTrajectory: [
      { value: "rising", weight: 0.6 },
      { value: "arch", weight: 0.4 },
    ],
    climaxPlacement: [
      { value: "late", weight: 0.7 },
      { value: "middle", weight: 0.3 },
    ],
    cadenceType: [
      { value: "open", weight: 0.55 },
      { value: "carry-forward", weight: 0.45 },
    ],
  },
}

/**
 * Draft知識を永続昇格せず試すための、セッション限定・匿名化済みPreset。
 * Genre Sourceや参照曲は含めず、Execution層へは抽象Technique Ruleだけを渡す。
 */
export const TECHNIQUE_EXPERIMENT_PRESETS: readonly TechniqueExperimentPreset[] =
  [
    {
      id: "space-microvariation",
      label: "Space & Microvariation",
      description:
        "余白、局所変化、緩やかな展開を候補選抜の補助評価として試します。",
      techniqueNames: [
        "Negative-Space Groove",
        "Stable Loop with Local Mutation",
        "Slow-Burn Escalation",
      ],
      validationLevel: "exploratory",
      recommendedProfiles: [],
      rules: [
        NEGATIVE_SPACE_GROOVE_RULE,
        STABLE_LOOP_LOCAL_MUTATION_RULE,
        SLOW_BURN_ESCALATION_RULE,
      ],
    },
    {
      id: "negative-space-groove",
      label: "Negative-Space Groove",
      description:
        "休符と長い旋律弧を使い、余白そのものが印象を作るか個別確認します。",
      techniqueNames: ["Negative-Space Groove"],
      validationLevel: "exploratory",
      recommendedProfiles: [],
      rules: [NEGATIVE_SPACE_GROOVE_RULE],
    },
    {
      id: "stable-loop-local-mutation",
      label: "Stable Loop + Local Mutation",
      description:
        "核モチーフの反復と局所変化が、記憶性と候補差を両立するか個別確認します。",
      techniqueNames: ["Stable Loop with Local Mutation"],
      validationLevel: "exploratory",
      recommendedProfiles: [],
      rules: [STABLE_LOOP_LOCAL_MUTATION_RULE],
    },
    {
      id: "slow-burn-escalation",
      label: "Slow-Burn Escalation",
      description:
        "加速に頼らない音域・クライマックス・終止の展開を個別確認します。",
      techniqueNames: ["Slow-Burn Escalation"],
      validationLevel: "confirmed",
      recommendedProfiles: ["elegiac-cantabile"],
      rules: [SLOW_BURN_ESCALATION_RULE],
    },
  ]

export function techniqueExperimentPreset(
  id: TechniqueExperimentPresetId,
): TechniqueExperimentPreset {
  return TECHNIQUE_EXPERIMENT_PRESETS.find(
    (preset) => preset.id === id,
  )!
}

export function techniqueExperimentRules(
  id: TechniqueExperimentPresetId,
  context: ComposerRuleContext,
): ComposerRule[] {
  const preset = techniqueExperimentPreset(id)
  return preset.rules.map((rule) => ({
    ...structuredClone(rule),
    when: {
      ...rule.when,
      generatorTargets: [context.generatorTarget],
      sectionRoles: [context.sectionRole],
    },
  }))
}
