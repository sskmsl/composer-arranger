import type {
  ComposerGeneratorTarget,
  ComposerRule,
  ComposerRuleContext,
} from "./types"
import type { MelodyGeneratorProfile } from "@/core/melody"
import type { SectionRole } from "@/core/section"

export type TechniqueExperimentPresetId =
  | "space-microvariation"
  | "negative-space-groove"
  | "stable-loop-local-mutation"
  | "slow-burn-escalation"
  | "motif-economy-reframing"

export interface TechniqueExperimentPreset {
  id: TechniqueExperimentPresetId
  label: string
  description: string
  techniqueNames: readonly string[]
  validationLevel: "exploratory" | "confirmed"
  targetValidationLevels: Partial<
    Record<ComposerGeneratorTarget, "exploratory" | "confirmed">
  >
  recommendedProfiles: readonly MelodyGeneratorProfile[]
  recommendedSectionRolesByTarget?: Partial<
    Record<ComposerGeneratorTarget, readonly SectionRole[]>
  >
  rules: readonly ComposerRule[]
  rulesByTarget?: Partial<
    Record<ComposerGeneratorTarget, readonly ComposerRule[]>
  >
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

const MOTIF_ECONOMY_REFRAMING_RULE: ComposerRule = {
  id: "experiment:draft:motif-economy-reframing",
  origin: "experimental",
  // Knowledge remains Draft. The session-only experiment wrapper is marked
  // executable so the resolver can A/B-test it without lifecycle promotion.
  status: "validated",
  priority: 20,
  confidence: 0.84,
  when: { generatorTargets: ["melody"] },
  prefer: {
    motifIdentity: [
      { value: "turn-cell", weight: 0.55 },
      { value: "repeated-cell", weight: 0.45 },
    ],
    phraseArchitecture: [
      { value: "asymmetric", weight: 0.55 },
      { value: "call-response", weight: 0.45 },
    ],
    developmentStrategy: [
      { value: "delayed-return", weight: 0.6 },
      { value: "fragmentation", weight: 0.4 },
    ],
    climaxPlacement: [
      { value: "middle", weight: 0.6 },
      { value: "late", weight: 0.4 },
    ],
  },
}

const NEGATIVE_SPACE_GROOVE_PHRASE_RULE: ComposerRule = {
  ...NEGATIVE_SPACE_GROOVE_RULE,
  id: "experiment:draft:negative-space-groove:phrase",
  when: { generatorTargets: ["phrase"] },
  prefer: {
    rhythmCharacter: [
      { value: "breathing", weight: 0.65 },
      { value: "sustained", weight: 0.35 },
    ],
    cadenceType: [
      { value: "open", weight: 0.6 },
      { value: "suspended", weight: 0.4 },
    ],
  },
}

const STABLE_LOOP_LOCAL_MUTATION_PHRASE_RULE: ComposerRule = {
  ...STABLE_LOOP_LOCAL_MUTATION_RULE,
  id: "experiment:draft:stable-loop-local-mutation:phrase",
  when: { generatorTargets: ["phrase"] },
  prefer: {
    rhythmCharacter: [
      { value: "flowing", weight: 0.6 },
      { value: "syncopated", weight: 0.4 },
    ],
    developmentStrategy: [
      { value: "fragmentation", weight: 0.55 },
      { value: "delayed-return", weight: 0.45 },
    ],
  },
}

const SLOW_BURN_ESCALATION_PHRASE_RULE: ComposerRule = {
  ...SLOW_BURN_ESCALATION_RULE,
  id: "experiment:draft:slow-burn-escalation:phrase",
  when: { generatorTargets: ["phrase"] },
  prefer: {
    phraseContour: [
      { value: "arch", weight: 0.6 },
      { value: "ascending", weight: 0.4 },
    ],
    climaxPlacement: [
      { value: "late", weight: 0.75 },
      { value: "middle", weight: 0.25 },
    ],
    cadenceType: [
      { value: "open", weight: 0.55 },
      { value: "carry-forward", weight: 0.45 },
    ],
  },
}

const MOTIF_ECONOMY_REFRAMING_PHRASE_RULE: ComposerRule = {
  ...MOTIF_ECONOMY_REFRAMING_RULE,
  id: "experiment:draft:motif-economy-reframing:phrase",
  when: { generatorTargets: ["phrase"] },
  prefer: {
    phraseContour: [
      { value: "arch", weight: 0.5 },
      { value: "ascending", weight: 0.25 },
      { value: "descending", weight: 0.25 },
    ],
    rhythmCharacter: [
      { value: "breathing", weight: 0.5 },
      { value: "flowing", weight: 0.5 },
    ],
    developmentStrategy: [
      { value: "delayed-return", weight: 0.6 },
      { value: "fragmentation", weight: 0.4 },
    ],
    cadenceType: [
      { value: "open", weight: 0.5 },
      { value: "carry-forward", weight: 0.5 },
    ],
  },
}

const NEGATIVE_SPACE_GROOVE_COUNTER_RULE: ComposerRule = {
  ...NEGATIVE_SPACE_GROOVE_RULE,
  id: "experiment:draft:negative-space-groove:counter",
  when: { generatorTargets: ["counter"] },
  prefer: {
    partRole: [
      { value: "gap-fill", weight: 0.6 },
      { value: "answer-phrase", weight: 0.4 },
    ],
    registerRelation: [
      { value: "below", weight: 0.5 },
      { value: "above", weight: 0.5 },
    ],
  },
}

const STABLE_LOOP_LOCAL_MUTATION_COUNTER_RULE: ComposerRule = {
  ...STABLE_LOOP_LOCAL_MUTATION_RULE,
  id: "experiment:draft:stable-loop-local-mutation:counter",
  when: { generatorTargets: ["counter"] },
  prefer: {
    partRole: [
      { value: "motif-echo", weight: 0.7 },
      { value: "counterline", weight: 0.3 },
    ],
    registerRelation: [
      { value: "below", weight: 0.6 },
      { value: "above", weight: 0.4 },
    ],
  },
}

const SLOW_BURN_ESCALATION_COUNTER_RULE: ComposerRule = {
  ...SLOW_BURN_ESCALATION_RULE,
  id: "experiment:draft:slow-burn-escalation:counter",
  when: { generatorTargets: ["counter"] },
  prefer: {
    partRole: [
      { value: "suspension-layer", weight: 0.65 },
      { value: "counterline", weight: 0.35 },
    ],
    registerRelation: [
      { value: "above", weight: 0.7 },
      { value: "below", weight: 0.3 },
    ],
  },
}

const MOTIF_ECONOMY_REFRAMING_COUNTER_RULE: ComposerRule = {
  ...MOTIF_ECONOMY_REFRAMING_RULE,
  id: "experiment:draft:motif-economy-reframing:counter",
  when: { generatorTargets: ["counter"] },
  prefer: {
    partRole: [
      { value: "motif-echo", weight: 0.55 },
      { value: "counterline", weight: 0.45 },
    ],
    registerRelation: [
      { value: "above", weight: 0.5 },
      { value: "below", weight: 0.5 },
    ],
  },
}

const NEGATIVE_SPACE_GROOVE_DECORATION_RULE: ComposerRule = {
  ...NEGATIVE_SPACE_GROOVE_RULE,
  id: "experiment:draft:negative-space-groove:decoration",
  when: { generatorTargets: ["decoration"] },
  prefer: {
    decorationGestureRole: [
      { value: "pedal", weight: 0.55 },
      { value: "response", weight: 0.45 },
    ],
    decorationShape: [
      { value: "sparse-accent", weight: 0.6 },
      { value: "neighbor-motion", weight: 0.4 },
    ],
    decorationRhythmStyle: [
      { value: "legato", weight: 0.6 },
      { value: "dotted", weight: 0.4 },
    ],
    phraseDensity: [{ value: "sparse", weight: 1 }],
  },
}

const STABLE_LOOP_LOCAL_MUTATION_DECORATION_RULE: ComposerRule = {
  ...STABLE_LOOP_LOCAL_MUTATION_RULE,
  id: "experiment:draft:stable-loop-local-mutation:decoration",
  when: { generatorTargets: ["decoration"] },
  prefer: {
    decorationGestureRole: [
      { value: "response", weight: 0.65 },
      { value: "pedal", weight: 0.35 },
    ],
    decorationShape: [
      { value: "repeated-sequence", weight: 0.65 },
      { value: "sequence", weight: 0.35 },
    ],
    decorationRhythmStyle: [
      { value: "syncopation", weight: 0.55 },
      { value: "dotted", weight: 0.45 },
    ],
  },
}

const SLOW_BURN_ESCALATION_DECORATION_RULE: ComposerRule = {
  ...SLOW_BURN_ESCALATION_RULE,
  id: "experiment:draft:slow-burn-escalation:decoration",
  when: { generatorTargets: ["decoration"] },
  prefer: {
    decorationGestureRole: [
      { value: "swell", weight: 0.6 },
      { value: "transition", weight: 0.4 },
    ],
    decorationShape: [
      { value: "suspense", weight: 0.55 },
      { value: "rising", weight: 0.45 },
    ],
    decorationRhythmStyle: [
      { value: "legato", weight: 0.65 },
      { value: "dotted", weight: 0.35 },
    ],
    phraseDensity: [
      { value: "sparse", weight: 0.55 },
      { value: "normal", weight: 0.45 },
    ],
  },
}

const MOTIF_ECONOMY_REFRAMING_DECORATION_RULE: ComposerRule = {
  ...MOTIF_ECONOMY_REFRAMING_RULE,
  id: "experiment:draft:motif-economy-reframing:decoration",
  when: { generatorTargets: ["decoration"] },
  prefer: {
    decorationGestureRole: [
      { value: "response", weight: 0.55 },
      { value: "transition", weight: 0.45 },
    ],
    decorationShape: [
      { value: "repeated-sequence", weight: 0.5 },
      { value: "sequence", weight: 0.5 },
    ],
    decorationRhythmStyle: [
      { value: "syncopation", weight: 0.5 },
      { value: "dotted", weight: 0.5 },
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
      targetValidationLevels: {
        melody: "exploratory",
        phrase: "exploratory",
        counter: "exploratory",
        decoration: "exploratory",
      },
      recommendedProfiles: [],
      recommendedSectionRolesByTarget: {},
      rules: [
        NEGATIVE_SPACE_GROOVE_RULE,
        STABLE_LOOP_LOCAL_MUTATION_RULE,
        SLOW_BURN_ESCALATION_RULE,
      ],
      rulesByTarget: {
        phrase: [
          NEGATIVE_SPACE_GROOVE_PHRASE_RULE,
          STABLE_LOOP_LOCAL_MUTATION_PHRASE_RULE,
          SLOW_BURN_ESCALATION_PHRASE_RULE,
        ],
        counter: [
          NEGATIVE_SPACE_GROOVE_COUNTER_RULE,
          STABLE_LOOP_LOCAL_MUTATION_COUNTER_RULE,
          SLOW_BURN_ESCALATION_COUNTER_RULE,
        ],
        decoration: [
          NEGATIVE_SPACE_GROOVE_DECORATION_RULE,
          STABLE_LOOP_LOCAL_MUTATION_DECORATION_RULE,
          SLOW_BURN_ESCALATION_DECORATION_RULE,
        ],
      },
    },
    {
      id: "negative-space-groove",
      label: "Negative-Space Groove",
      description:
        "休符と長い旋律弧を使い、余白そのものが印象を作るか個別確認します。",
      techniqueNames: ["Negative-Space Groove"],
      validationLevel: "exploratory",
      targetValidationLevels: {
        melody: "exploratory",
        phrase: "confirmed",
        counter: "confirmed",
        decoration: "confirmed",
      },
      recommendedProfiles: [],
      recommendedSectionRolesByTarget: {
        phrase: ["pre-chorus", "chorus", "outro"],
        counter: ["intro", "verse"],
        decoration: ["outro"],
      },
      rules: [NEGATIVE_SPACE_GROOVE_RULE],
      rulesByTarget: {
        phrase: [NEGATIVE_SPACE_GROOVE_PHRASE_RULE],
        counter: [NEGATIVE_SPACE_GROOVE_COUNTER_RULE],
        decoration: [NEGATIVE_SPACE_GROOVE_DECORATION_RULE],
      },
    },
    {
      id: "stable-loop-local-mutation",
      label: "Stable Loop + Local Mutation",
      description:
        "核モチーフの反復と局所変化が、記憶性と候補差を両立するか個別確認します。",
      techniqueNames: ["Stable Loop with Local Mutation"],
      validationLevel: "exploratory",
      targetValidationLevels: {
        melody: "exploratory",
        phrase: "exploratory",
        counter: "exploratory",
        decoration: "confirmed",
      },
      recommendedProfiles: [],
      recommendedSectionRolesByTarget: {
        decoration: ["outro"],
      },
      rules: [STABLE_LOOP_LOCAL_MUTATION_RULE],
      rulesByTarget: {
        phrase: [STABLE_LOOP_LOCAL_MUTATION_PHRASE_RULE],
        counter: [STABLE_LOOP_LOCAL_MUTATION_COUNTER_RULE],
        decoration: [
          STABLE_LOOP_LOCAL_MUTATION_DECORATION_RULE,
        ],
      },
    },
    {
      id: "slow-burn-escalation",
      label: "Slow-Burn Escalation",
      description:
        "加速に頼らない音域・クライマックス・終止の展開を個別確認します。",
      techniqueNames: ["Slow-Burn Escalation"],
      validationLevel: "confirmed",
      targetValidationLevels: {
        melody: "confirmed",
        phrase: "exploratory",
        counter: "exploratory",
        decoration: "exploratory",
      },
      recommendedProfiles: ["elegiac-cantabile"],
      recommendedSectionRolesByTarget: {},
      rules: [SLOW_BURN_ESCALATION_RULE],
      rulesByTarget: {
        phrase: [SLOW_BURN_ESCALATION_PHRASE_RULE],
        counter: [SLOW_BURN_ESCALATION_COUNTER_RULE],
        decoration: [SLOW_BURN_ESCALATION_DECORATION_RULE],
      },
    },
    {
      id: "motif-economy-reframing",
      label: "Motif Economy + Reframing",
      description:
        "短いMotifを断片化・遅延回帰・役割交替で再利用し、少ない音数から長い感情的因果を作れるか確認します。",
      techniqueNames: [
        "Motif Economy",
        "Fragment before Full Statement",
        "Theme Reframing",
      ],
      validationLevel: "exploratory",
      targetValidationLevels: {
        melody: "exploratory",
        phrase: "exploratory",
        counter: "exploratory",
        decoration: "confirmed",
      },
      recommendedProfiles: [],
      recommendedSectionRolesByTarget: {
        decoration: [
          "intro",
          "verse",
          "pre-chorus",
          "chorus",
          "bridge",
        ],
      },
      rules: [MOTIF_ECONOMY_REFRAMING_RULE],
      rulesByTarget: {
        phrase: [MOTIF_ECONOMY_REFRAMING_PHRASE_RULE],
        counter: [MOTIF_ECONOMY_REFRAMING_COUNTER_RULE],
        decoration: [MOTIF_ECONOMY_REFRAMING_DECORATION_RULE],
      },
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
  const rules =
    context.generatorTarget === "melody"
      ? preset.rules
      : preset.rulesByTarget?.[context.generatorTarget] ?? []
  return rules.map((rule) => ({
    ...structuredClone(rule),
    when: {
      ...rule.when,
      generatorTargets: [context.generatorTarget],
      sectionRoles: [context.sectionRole],
    },
  }))
}
