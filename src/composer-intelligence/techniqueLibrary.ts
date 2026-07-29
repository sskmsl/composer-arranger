import type {
  ComposerRule,
  GenrePrinciple,
  TechniqueDefinition,
  TechniqueLibrary,
} from "./types"
import {
  evaluateTechniqueLifecycle,
  lifecycleEligiblePrinciples,
} from "./techniqueLifecycle"

export function createTechniqueLibrary(
  techniques: TechniqueDefinition[] = [],
): TechniqueLibrary {
  return {
    schemaVersion: 1,
    techniques: techniques.map((technique) => structuredClone(technique)),
  }
}

export function upsertTechnique(
  library: TechniqueLibrary,
  technique: TechniqueDefinition,
): TechniqueLibrary {
  const techniques = library.techniques.filter(
    (candidate) => candidate.id !== technique.id,
  )
  return createTechniqueLibrary([...techniques, technique])
}

/**
 * Principleを実行可能Ruleへ変換する。Genre Sourceはここで切り落とし、
 * Composer ArrangerへはTechnique単位の匿名Ruleだけを渡す。
 */
export function ruleFromTechnique(
  technique: TechniqueDefinition,
  principleOrPrinciples: GenrePrinciple | GenrePrinciple[],
): ComposerRule | null {
  const principles = Array.isArray(principleOrPrinciples)
    ? principleOrPrinciples
    : [principleOrPrinciples]
  const lifecycle = evaluateTechniqueLifecycle(technique, principles)
  if (!lifecycle.eligible) return null
  const eligiblePrinciples = lifecycleEligiblePrinciples(
    technique,
    principles,
  )
  const principleConfidence =
    eligiblePrinciples.reduce(
      (sum, principle) => sum + principle.confidence,
      0,
    ) / eligiblePrinciples.length
  return {
    id: `technique-rule:${technique.id}:v${technique.version}`,
    origin: "technique",
    techniqueId: technique.id,
    status: technique.status,
    priority: technique.priority,
    confidence: Math.max(
      0,
      Math.min(1, technique.confidence * principleConfidence),
    ),
    when: {
      ...technique.rule.when,
      generatorTargets:
        technique.rule.when.generatorTargets ??
        technique.generatorTargets,
    },
    prefer: structuredClone(technique.rule.prefer),
  }
}
