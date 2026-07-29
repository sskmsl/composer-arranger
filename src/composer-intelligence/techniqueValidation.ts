import { isTechniqueId } from "./knowledgeBase"
import type {
  GenrePrinciple,
  TechniqueEvidence,
  TechniqueKnowledgeRecord,
  TechniqueLifecycleStatus,
  TechniqueReviewHistoryEntry,
} from "./types"

export const MINIMUM_VALIDATED_EVIDENCE = 1
export const CANONICAL_EVIDENCE_THRESHOLD = 6
export const MINIMUM_CANONICAL_GENRES = 2

export interface TechniqueValidationResult {
  targetStatus: TechniqueLifecycleStatus
  eligible: boolean
  verifiedEvidenceCount: number
  distinctGenreSourceCount: number
  validatedPrincipleCount: number
  reasons: string[]
}

export interface TechniqueReviewInput {
  id: string
  reviewedAt: string
  reason: string
  reviewer: string
}

export interface TechniqueTransitionResult {
  technique: TechniqueKnowledgeRecord | null
  validation: TechniqueValidationResult
}

export function isVerifiedTechniqueEvidence(
  evidence: TechniqueEvidence,
): boolean {
  return (
    evidence.sectionConfirmed &&
    evidence.intentConfirmed &&
    evidence.observationConfirmed &&
    evidence.verifiedAt !== null &&
    evidence.startSeconds !== null &&
    evidence.endSeconds !== null &&
    evidence.startSeconds >= 0 &&
    evidence.endSeconds > evidence.startSeconds
  )
}

function matchingPrinciples(
  technique: TechniqueKnowledgeRecord,
  principles: GenrePrinciple[],
): GenrePrinciple[] {
  const sourceIds = new Set(
    technique.genreSources.map((source) => source.id),
  )
  return principles.filter(
    (principle) =>
      principle.techniqueId === technique.id &&
      (principle.status === "validated" ||
        principle.status === "canonical") &&
      principle.referenceCount >= 1 &&
      sourceIds.has(principle.genreSourceId),
  )
}

export function validateTechniqueStatus(
  technique: TechniqueKnowledgeRecord,
  targetStatus: TechniqueLifecycleStatus,
  principles: GenrePrinciple[],
): TechniqueValidationResult {
  const verifiedEvidence = technique.evidence.filter(
    isVerifiedTechniqueEvidence,
  )
  const distinctGenreSourceCount = new Set(
    verifiedEvidence.map((evidence) => evidence.genreSourceId),
  ).size
  const validatedPrinciples = matchingPrinciples(
    technique,
    principles,
  )
  const reasons: string[] = []

  if (!isTechniqueId(technique.id)) {
    reasons.push("Technique IDはTECH-0001形式の永続IDが必要")
  }
  if (technique.confidence < 0 || technique.confidence > 1) {
    reasons.push("Confidenceは0.0〜1.0の範囲が必要")
  }

  if (
    targetStatus === "validated" ||
    targetStatus === "canonical"
  ) {
    if (verifiedEvidence.length < MINIMUM_VALIDATED_EVIDENCE) {
      reasons.push(
        "ValidatedにはSection・時間・Intent・Observationを確認済みのEvidenceが最低1件必要",
      )
    }
    if (validatedPrinciples.length === 0) {
      reasons.push("Validatedには成立済みGenre Principleが必要")
    }
  }

  if (targetStatus === "canonical") {
    const enoughGenres =
      distinctGenreSourceCount >= MINIMUM_CANONICAL_GENRES
    const enoughEvidence =
      verifiedEvidence.length >= CANONICAL_EVIDENCE_THRESHOLD
    if (!enoughGenres && !enoughEvidence) {
      reasons.push(
        `Canonicalには${MINIMUM_CANONICAL_GENRES} Genre以上または確認済みEvidence ${CANONICAL_EVIDENCE_THRESHOLD}件以上が必要`,
      )
    }
    if (!technique.reproducibilityConfirmed) {
      reasons.push("CanonicalにはTechniqueの再現性確認が必要")
    }
  }

  return {
    targetStatus,
    eligible: reasons.length === 0,
    verifiedEvidenceCount: verifiedEvidence.length,
    distinctGenreSourceCount,
    validatedPrincipleCount: validatedPrinciples.length,
    reasons,
  }
}

function reviewEntry(
  technique: TechniqueKnowledgeRecord,
  targetStatus: TechniqueLifecycleStatus,
  review: TechniqueReviewInput,
): TechniqueReviewHistoryEntry {
  return {
    id: review.id,
    reviewedAt: review.reviewedAt,
    fromStatus: technique.status,
    toStatus: targetStatus,
    reason: review.reason,
    reviewer: review.reviewer,
  }
}

function assertReviewInput(review: TechniqueReviewInput): void {
  if (
    !review.id.trim() ||
    !review.reviewedAt.trim() ||
    !review.reason.trim() ||
    !review.reviewer.trim() ||
    Number.isNaN(Date.parse(review.reviewedAt))
  ) {
    throw new Error(
      "Review HistoryにはID、日時、理由、Reviewerが必要",
    )
  }
}

export function transitionTechniqueStatus(
  technique: TechniqueKnowledgeRecord,
  targetStatus: TechniqueLifecycleStatus,
  principles: GenrePrinciple[],
  review: TechniqueReviewInput,
): TechniqueTransitionResult {
  assertReviewInput(review)
  if (technique.reviewHistory.some((entry) => entry.id === review.id)) {
    throw new Error(`Duplicate Review History ID: ${review.id}`)
  }
  const validation = validateTechniqueStatus(
    technique,
    targetStatus,
    principles,
  )
  if (!validation.eligible) {
    return { technique: null, validation }
  }
  if (
    targetStatus === "canonical" &&
    technique.status !== "validated" &&
    technique.status !== "canonical"
  ) {
    return {
      technique: null,
      validation: {
        ...validation,
        eligible: false,
        reasons: [
          ...validation.reasons,
          "CanonicalへはValidatedから昇格する",
        ],
      },
    }
  }
  return {
    technique: {
      ...structuredClone(technique),
      version: technique.version + 1,
      status: targetStatus,
      reviewHistory: [
        ...technique.reviewHistory.map((entry) =>
          structuredClone(entry),
        ),
        reviewEntry(technique, targetStatus, review),
      ],
    },
    validation,
  }
}

export function updateTechniqueConfidence(
  technique: TechniqueKnowledgeRecord,
  confidence: number,
  review: TechniqueReviewInput,
): TechniqueKnowledgeRecord {
  assertReviewInput(review)
  if (technique.reviewHistory.some((entry) => entry.id === review.id)) {
    throw new Error(`Duplicate Review History ID: ${review.id}`)
  }
  if (confidence < 0 || confidence > 1) {
    throw new Error("Confidence must be between 0.0 and 1.0")
  }
  return {
    ...structuredClone(technique),
    version: technique.version + 1,
    confidence,
    reviewHistory: [
      ...technique.reviewHistory.map((entry) =>
        structuredClone(entry),
      ),
      reviewEntry(technique, technique.status, review),
    ],
  }
}
