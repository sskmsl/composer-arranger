import type {
  GenrePrinciple,
  TechniqueDefinition,
  TechniqueLifecycleStatus,
} from "./types"

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
 * Draftは分析専用、Validatedは1 Genre内の3 Reference、
 * Canonicalは2 Genre以上で再現した場合だけExecutionへ昇格できる。
 */
export function evaluateTechniqueLifecycle(
  technique: TechniqueDefinition,
  principles: GenrePrinciple[],
): TechniqueLifecycleEvaluation {
  const evidence = eligiblePrinciples(technique, principles)
  const distinctGenreSources = new Set(
    evidence.map((principle) => principle.genreSourceId),
  ).size
  const reasons: string[] = []

  if (technique.status === "draft") {
    reasons.push("Draft TechniqueはLearning層の分析対象")
  } else if (technique.status === "retired") {
    reasons.push("Retired TechniqueはExecution対象外")
  } else if (technique.status === "validated") {
    if (distinctGenreSources < 1) {
      reasons.push(
        "Validatedには1 Genre内で3件以上の確認済みReferenceが必要",
      )
    }
  } else if (distinctGenreSources < 2) {
    reasons.push(
      "Canonicalには2 Genre以上のValidated Principleが必要",
    )
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
