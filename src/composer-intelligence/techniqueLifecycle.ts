import type {
  GenrePrinciple,
  TechniqueDefinition,
  TechniqueLifecycleStatus,
} from "./types"
import {
  CANONICAL_EVIDENCE_THRESHOLD,
  MINIMUM_CANONICAL_GENRES,
  MINIMUM_VALIDATED_EVIDENCE,
} from "./techniqueValidation"

export interface TechniqueLifecycleEvaluation {
  status: TechniqueLifecycleStatus
  eligible: boolean
  distinctGenreSources: number
  validatedPrincipleCount: number
  reasons: string[]
}

function eligiblePrinciples(
  technique: TechniqueDefinition,
  principles: GenrePrinciple[],
): GenrePrinciple[] {
  return principles.filter(
    (principle) =>
      principle.techniqueId === technique.id &&
      (principle.status === "validated" ||
        principle.status === "canonical") &&
      principle.referenceCount >= 3 &&
      technique.genreSourceIds.includes(principle.genreSourceId),
  )
}

/**
 * Learning層で検証済みの集計値とPrincipleを使い、
 * 個別EvidenceをExecution層へ漏らさずRule化可否を再確認する。
 */
export function evaluateTechniqueLifecycle(
  technique: TechniqueDefinition,
  principles: GenrePrinciple[],
): TechniqueLifecycleEvaluation {
  const evidence = eligiblePrinciples(technique, principles)
  const principleGenreCount = new Set(
    evidence.map((principle) => principle.genreSourceId),
  ).size
  const evidenceCount =
    technique.lifecycleEvidence.verifiedEvidenceCount
  const aggregateGenreCount =
    technique.lifecycleEvidence.distinctGenreSourceCount
  const distinctGenreSources = Math.max(
    principleGenreCount,
    aggregateGenreCount,
  )
  const reasons: string[] = []

  if (technique.status === "draft") {
    reasons.push("Draft TechniqueはLearning層の分析対象")
  } else if (technique.status === "deprecated") {
    reasons.push("Deprecated TechniqueはExecution対象外")
  } else if (technique.status === "validated") {
    if (
      evidenceCount < MINIMUM_VALIDATED_EVIDENCE ||
      evidence.length < 1
    ) {
      reasons.push(
        "Validatedには確認済みEvidenceと成立済みGenre Principleが必要",
      )
    }
  } else {
    const enoughGenres =
      distinctGenreSources >= MINIMUM_CANONICAL_GENRES
    const enoughEvidence =
      evidenceCount >= CANONICAL_EVIDENCE_THRESHOLD
    if (evidence.length < 1) {
      reasons.push("Canonicalには成立済みGenre Principleが必要")
    }
    if (!enoughGenres && !enoughEvidence) {
      reasons.push(
        "Canonicalには複数Genreまたは十分な確認済みEvidenceが必要",
      )
    }
    if (!technique.lifecycleEvidence.reproducibilityConfirmed) {
      reasons.push("Canonicalには再現性確認が必要")
    }
  }

  return {
    status: technique.status,
    eligible: reasons.length === 0,
    distinctGenreSources,
    validatedPrincipleCount: evidence.length,
    reasons,
  }
}

export function lifecycleEligiblePrinciples(
  technique: TechniqueDefinition,
  principles: GenrePrinciple[],
): GenrePrinciple[] {
  const evaluation = evaluateTechniqueLifecycle(technique, principles)
  return evaluation.eligible
    ? eligiblePrinciples(technique, principles)
    : []
}
