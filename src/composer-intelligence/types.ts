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
export type TechniqueLifecycleStatus =
  | "draft"
  | "validated"
  | "canonical"
  | "deprecated"
export type KnowledgeStatus = TechniqueLifecycleStatus
export type TechniqueId = `TECH-${string}`

export type TechniqueEvidenceSection =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "interlude"
  | "break"
  | "outro"
  | "transition"
  | "other"

export interface TechniqueGenreSource {
  id: string
  name: string
}

export interface TechniqueEvidence {
  id: string
  techniqueId: TechniqueId
  referenceId: string
  songTitle: string
  genre: string
  genreSourceId: string
  section: TechniqueEvidenceSection
  startSeconds: number | null
  endSeconds: number | null
  comment: string
  sectionConfirmed: boolean
  intentConfirmed: boolean
  observationConfirmed: boolean
  verifiedAt: string | null
}

export interface TechniqueReviewHistoryEntry {
  id: string
  reviewedAt: string
  fromStatus: TechniqueLifecycleStatus
  toStatus: TechniqueLifecycleStatus
  reason: string
  reviewer: string
}

/**
 * Learning層の永続レコード。Evidenceの実名情報を含むためGit管理外に置く。
 */
export interface TechniqueKnowledgeRecord {
  id: TechniqueId
  version: number
  name: string
  status: TechniqueLifecycleStatus
  category: TechniqueCategory
  observation: string
  intent: string
  confidence: number
  genreSources: TechniqueGenreSource[]
  evidence: TechniqueEvidence[]
  reviewHistory: TechniqueReviewHistoryEntry[]
  reproducibilityConfirmed: boolean
  extensions?: Record<string, unknown>
}

export interface TechniqueKnowledgeBase {
  schemaVersion: 1
  techniques: TechniqueKnowledgeRecord[]
}

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
  techniqueId?: TechniqueId
  status: KnowledgeStatus
  priority: number
  confidence: number
  when: ComposerRuleCondition
  prefer: Partial<
    Record<ComposerTechniqueAxis, WeightedTechniqueValue[]>
  >
}

export interface TechniqueDefinition {
  id: TechniqueId
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
  lifecycleEvidence: {
    verifiedEvidenceCount: number
    distinctGenreSourceCount: number
    reproducibilityConfirmed: boolean
  }
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
  techniqueId: TechniqueId
  observation: string
  inferredIntent: string
  confidence: number
  verifiedByHuman: boolean
}

export interface GenrePrinciple {
  id: string
  version: number
  status: KnowledgeStatus
  techniqueId: TechniqueId
  /** Principleが検証されたGenre Source。実行時Ruleから除去する。 */
  genreSourceId: string
  observationIds: string[]
  referenceCount: number
  statement: string
  confidence: number
  generatorTargets: ComposerGeneratorTarget[]
}

export interface TechniqueLibrary {
  schemaVersion: 2
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

export const TECHNIQUE_LIFECYCLE_WEIGHTS = {
  draft: 0,
  validated: 0.35,
  canonical: 1,
  deprecated: 0,
} as const
