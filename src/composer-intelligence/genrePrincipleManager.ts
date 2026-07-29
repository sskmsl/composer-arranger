import type {
  ComposerGeneratorTarget,
  GenreObservation,
  GenrePrinciple,
  TechniqueId,
} from "./types"

export const MINIMUM_GENRE_PRINCIPLE_REFERENCES = 3

export interface BuildGenrePrincipleInput {
  id: string
  techniqueId: TechniqueId
  genreSourceId: string
  statement: string
  generatorTargets: ComposerGeneratorTarget[]
  observations: GenreObservation[]
}

/**
 * 複数の独立Referenceで確認されたObservationだけをPrincipleへ昇格する。
 * 実名は受け取らず、Git管理外台帳が発行したreferenceIdだけを扱う。
 */
export function buildGenrePrinciple(
  input: BuildGenrePrincipleInput,
): GenrePrinciple | null {
  const observations = input.observations.filter(
    (observation) =>
      observation.techniqueId === input.techniqueId &&
      observation.genreSourceId === input.genreSourceId &&
      observation.verifiedByHuman,
  )
  const referenceIds = new Set(
    observations.map((observation) => observation.referenceId),
  )
  if (referenceIds.size < MINIMUM_GENRE_PRINCIPLE_REFERENCES) return null
  const confidence =
    observations.reduce(
      (sum, observation) => sum + observation.confidence,
      0,
    ) / Math.max(1, observations.length)
  return {
    id: input.id,
    version: 1,
    status: "validated",
    techniqueId: input.techniqueId,
    genreSourceId: input.genreSourceId,
    observationIds: observations.map((observation) => observation.id),
    referenceCount: referenceIds.size,
    statement: input.statement,
    confidence: Math.max(0, Math.min(1, confidence)),
    generatorTargets: [...new Set(input.generatorTargets)],
  }
}
