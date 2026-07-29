import type {
  ComposerRule,
  GenrePrinciple,
  TechniqueDefinition,
  TechniqueLibrary,
} from "./types"

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
  principle: GenrePrinciple,
): ComposerRule | null {
  if (
    technique.status !== "validated" ||
    principle.status !== "validated" ||
    technique.id !== principle.techniqueId ||
    principle.referenceCount < 3
  ) {
    return null
  }
  return {
    id: `technique-rule:${technique.id}:v${technique.version}`,
    origin: "technique",
    techniqueId: technique.id,
    status: "validated",
    priority: technique.priority,
    confidence: Math.max(
      0,
      Math.min(1, technique.confidence * principle.confidence),
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
