import { validateTechniqueStatus } from "./techniqueValidation"
import type {
  ComposerGeneratorTarget,
  GenrePrinciple,
  TechniqueDefinition,
  TechniqueKnowledgeRecord,
} from "./types"

export interface TechniqueExecutionConfig {
  generatorTargets: ComposerGeneratorTarget[]
  rule: TechniqueDefinition["rule"]
}

/**
 * Learning層からExecution層へ渡す唯一の変換点。
 * Evidence、曲名、Genre名、Review Historyを除去し、匿名集計値だけを残す。
 */
export function compileKnowledgeForExecution(
  technique: TechniqueKnowledgeRecord,
  principles: GenrePrinciple[],
  config: TechniqueExecutionConfig,
): TechniqueDefinition | null {
  if (
    technique.status !== "validated" &&
    technique.status !== "canonical"
  ) {
    return null
  }
  const validation = validateTechniqueStatus(
    technique,
    technique.status,
    principles,
  )
  if (!validation.eligible) return null

  return {
    id: technique.id,
    version: technique.version,
    status: technique.status,
    category: technique.category,
    observation: technique.observation,
    intent: technique.intent,
    generatorTargets: [...config.generatorTargets],
    genreSourceIds: technique.genreSources.map((source) => source.id),
    priority: 50,
    confidence: technique.confidence,
    lifecycleEvidence: {
      verifiedEvidenceCount: validation.verifiedEvidenceCount,
      distinctGenreSourceCount:
        validation.distinctGenreSourceCount,
      reproducibilityConfirmed:
        technique.reproducibilityConfirmed,
    },
    rule: structuredClone(config.rule),
  }
}
