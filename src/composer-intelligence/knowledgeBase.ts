import type {
  TechniqueEvidence,
  TechniqueGenreSource,
  TechniqueId,
  TechniqueKnowledgeBase,
  TechniqueKnowledgeRecord,
} from "./types"

export const TECHNIQUE_ID_PATTERN = /^TECH-\d{4,}$/

export function isTechniqueId(value: string): value is TechniqueId {
  return TECHNIQUE_ID_PATTERN.test(value)
}

export function createTechniqueKnowledgeBase(
  techniques: TechniqueKnowledgeRecord[] = [],
): TechniqueKnowledgeBase {
  return {
    schemaVersion: 1,
    techniques: techniques.map((technique) => structuredClone(technique)),
  }
}

export function upsertTechniqueKnowledge(
  knowledgeBase: TechniqueKnowledgeBase,
  technique: TechniqueKnowledgeRecord,
): TechniqueKnowledgeBase {
  if (!isTechniqueId(technique.id)) {
    throw new Error(`Invalid persistent Technique ID: ${technique.id}`)
  }
  return createTechniqueKnowledgeBase([
    ...knowledgeBase.techniques.filter(
      (candidate) => candidate.id !== technique.id,
    ),
    technique,
  ])
}

function sourceFromEvidence(
  evidence: TechniqueEvidence,
): TechniqueGenreSource {
  return {
    id: evidence.genreSourceId,
    name: evidence.genre,
  }
}

export function addTechniqueEvidence(
  technique: TechniqueKnowledgeRecord,
  evidence: TechniqueEvidence,
): TechniqueKnowledgeRecord {
  if (evidence.techniqueId !== technique.id) {
    throw new Error("Evidence Technique ID does not match")
  }
  if (
    technique.evidence.some(
      (candidate) => candidate.id === evidence.id,
    )
  ) {
    throw new Error(`Duplicate Evidence ID: ${evidence.id}`)
  }
  const sources = new Map(
    technique.genreSources.map((source) => [source.id, source]),
  )
  const source = sourceFromEvidence(evidence)
  sources.set(source.id, source)
  return {
    ...structuredClone(technique),
    genreSources: [...sources.values()],
    evidence: [
      ...technique.evidence.map((candidate) =>
        structuredClone(candidate),
      ),
      structuredClone(evidence),
    ],
  }
}
