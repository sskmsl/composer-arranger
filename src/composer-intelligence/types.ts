import type { SectionRole } from "@/core/section"

export type ComposerGeneratorTarget =
  | "decoration"
  | "phrase"
  | "counter"
  | "melody"

export type TechniqueCategory =
  | "decoration"
  | "phrase"
  | "counter"
  | "transition"
  | "texture"
  | "dynamics"
  | "harmony"
  | "rhythm"
  | "sound-design"
  | "automation"
  | "arrangement"
  | "mix-perspective"

export type KnowledgeOrigin = "artist" | "technique" | "experimental"
export type KnowledgeStatus = "draft" | "validated" | "retired"

/**
 * Generator間で共有する抽象軸。固有名・Genre名・参照曲は実行時へ渡さない。
 * Generator固有の軸も同じRule Resolverを通すことで優先順位を一元化する。
 */
export type ComposerTechniqueAxis =
  | "melodicDirection"
  | "register"
  | "registerDirection"
  | "densityDirection"
  | "energyDirection"
  | "entryOffset"
  | "partRole"
  | "layerType"
  | "intervalCharacter"
  | "phraseContour"
  | "phraseDensity"
  | "rhythmCharacter"
  | "harmonicApproach"
  | "cadenceType"
  | "contourRelation"
  | "registerRelation"
  | "independenceLevel"
  | "motifIdentity"
  | "rhythmGrammar"
  | "phraseArchitecture"
  | "harmonicResponse"
  | "registerTrajectory"
  | "developmentStrategy"
  | "climaxPlacement"
  | "decorationGestureRole"
  | "decorationShape"
  | "decorationRhythmStyle"

export interface WeightedTechniqueValue {
  value: string
  /** 同一Rule内の相対重み。Rule Resolverで正規化する。 */
  weight: number
}

export interface ComposerRuleCondition {
  generatorTargets?: ComposerGeneratorTarget[]
  sectionRoles?: SectionRole[]
  transitions?: string[]
  targetEnergy?: ("low" | "medium" | "high")[]
}

export interface ComposerRule {
  id: string
  origin: KnowledgeOrigin
  techniqueId?: string
  status: KnowledgeStatus
  priority: number
  confidence: number
  when: ComposerRuleCondition
  prefer: Partial<
    Record<ComposerTechniqueAxis, WeightedTechniqueValue[]>
  >
}

export interface TechniqueDefinition {
  id: string
  version: number
  status: KnowledgeStatus
  category: TechniqueCategory
  observation: string
  intent: string
  generatorTargets: ComposerGeneratorTarget[]
  /** Learning層だけが利用する匿名Source ID。実行時Ruleから除去する。 */
  genreSourceIds: string[]
  priority: 50
  confidence: number
  rule: Omit<
    ComposerRule,
    "id" | "origin" | "techniqueId" | "status" | "priority" | "confidence"
  >
}

export interface GenreObservation {
  id: string
  /** 実名や曲名ではなく、Git管理外台帳が発行するopaque ID。 */
  referenceId: string
  genreSourceId: string
  techniqueId: string
  observation: string
  inferredIntent: string
  confidence: number
  verifiedByHuman: boolean
}

export interface GenrePrinciple {
  id: string
  version: number
  status: KnowledgeStatus
  techniqueId: string
  observationIds: string[]
  referenceCount: number
  statement: string
  confidence: number
  generatorTargets: ComposerGeneratorTarget[]
}

export interface TechniqueLibrary {
  schemaVersion: 1
  techniques: TechniqueDefinition[]
}

export interface ComposerRuleContext {
  generatorTarget: ComposerGeneratorTarget
  sectionRole: SectionRole
  transition?: string
  targetEnergy?: "low" | "medium" | "high"
}

export interface ResolvedAxisPreference {
  axis: ComposerTechniqueAxis
  priority: number
  values: WeightedTechniqueValue[]
  contributingRuleIds: string[]
}

/**
 * Execution層へ渡す唯一の知識表現。
 * Genre Source、Reference、Observationは意図的に含めない。
 */
export interface ResolvedComposerRules {
  context: ComposerRuleContext
  preferences: Partial<
    Record<ComposerTechniqueAxis, ResolvedAxisPreference>
  >
  appliedRuleIds: string[]
}

export const KNOWLEDGE_PRIORITIES = {
  artist: 100,
  technique: 50,
  experimental: 20,
} as const
