import type {
  ComposerRule,
  ComposerRuleContext,
} from "./types"

export type TechniqueExperimentPresetId = "space-microvariation"

export interface TechniqueExperimentPreset {
  id: TechniqueExperimentPresetId
  label: string
  description: string
  techniqueNames: readonly string[]
  rules: readonly ComposerRule[]
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
      rules: [
        {
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
        },
        {
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
        },
        {
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
        },
      ],
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
