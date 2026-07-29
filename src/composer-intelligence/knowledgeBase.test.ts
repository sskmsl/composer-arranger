import { describe, expect, it } from "vitest"
import {
  addTechniqueEvidence,
  CANONICAL_EVIDENCE_THRESHOLD,
  compileKnowledgeForExecution,
  createTechniqueKnowledgeBase,
  transitionTechniqueStatus,
  updateTechniqueConfidence,
  upsertTechniqueKnowledge,
  validateTechniqueStatus,
  type GenrePrinciple,
  type TechniqueEvidence,
  type TechniqueKnowledgeRecord,
} from "."

function knowledge(
  overrides: Partial<TechniqueKnowledgeRecord> = {},
): TechniqueKnowledgeRecord {
  return {
    id: "TECH-0001",
    version: 1,
    name: "Sparse Arrangement",
    status: "draft",
    category: "arrangement",
    observation: "同時発音数を抑えて余白を設計する",
    intent: "各パートの存在感と立体感を高める",
    confidence: 0.8,
    genreSources: [
      { id: "genre-source-001", name: "Genre A" },
    ],
    evidence: [],
    reviewHistory: [],
    reproducibilityConfirmed: false,
    extensions: {},
    ...overrides,
  }
}

function evidence(
  id: string,
  genreSourceId = "genre-source-001",
  verified = true,
): TechniqueEvidence {
  return {
    id,
    techniqueId: "TECH-0001",
    referenceId: `reference-${id}`,
    songTitle: `Internal ${id}`,
    genre: genreSourceId === "genre-source-001" ? "Genre A" : "Genre B",
    genreSourceId,
    section: "verse",
    startSeconds: verified ? 10 : null,
    endSeconds: verified ? 20 : null,
    comment: "試聴確認",
    sectionConfirmed: verified,
    intentConfirmed: verified,
    observationConfirmed: verified,
    verifiedAt: verified ? "2026-07-30T00:00:00.000Z" : null,
  }
}

function principle(
  genreSourceId = "genre-source-001",
): GenrePrinciple {
  return {
    id: `principle-${genreSourceId}`,
    version: 1,
    status: "validated",
    techniqueId: "TECH-0001",
    genreSourceId,
    observationIds: ["o1", "o2", "o3"],
    referenceCount: 3,
    statement: "余白を音楽として扱う",
    confidence: 0.9,
    generatorTargets: ["decoration"],
  }
}

const review = {
  id: "review-001",
  reviewedAt: "2026-07-30T00:00:00.000Z",
  reason: "対象SectionでTechniqueを確認",
  reviewer: "human-reviewer",
}

describe("Composer Intelligence / Knowledge Base", () => {
  it("名称変更後も永続Technique IDで同一レコードを更新する", () => {
    const initial = createTechniqueKnowledgeBase([knowledge()])
    const renamed = {
      ...knowledge(),
      name: "Intentional Sparse Arrangement",
      version: 2,
    }
    const updated = upsertTechniqueKnowledge(initial, renamed)
    expect(updated.techniques).toHaveLength(1)
    expect(updated.techniques[0]).toMatchObject({
      id: "TECH-0001",
      name: "Intentional Sparse Arrangement",
      version: 2,
    })
  })

  it("Evidenceを複数保持しGenre Sourceを自動追加する", () => {
    const first = addTechniqueEvidence(
      knowledge(),
      evidence("evidence-001"),
    )
    const second = addTechniqueEvidence(
      first,
      evidence("evidence-002", "genre-source-002"),
    )
    expect(second.evidence).toHaveLength(2)
    expect(second.genreSources).toEqual([
      { id: "genre-source-001", name: "Genre A" },
      { id: "genre-source-002", name: "Genre B" },
    ])
  })

  it("Execution変換時に曲名・Evidence・Review Historyを除去する", () => {
    const validated = knowledge({
      status: "validated",
      evidence: [evidence("evidence-private-001")],
      reviewHistory: [
        {
          id: "review-private-001",
          reviewedAt: "2026-07-30T00:00:00.000Z",
          fromStatus: "draft",
          toStatus: "validated",
          reason: "試聴確認",
          reviewer: "private-reviewer",
        },
      ],
    })
    const execution = compileKnowledgeForExecution(
      validated,
      [principle()],
      {
        generatorTargets: ["decoration"],
        rule: {
          when: { generatorTargets: ["decoration"] },
          prefer: {
            phraseDensity: [{ value: "sparse", weight: 1 }],
          },
        },
      },
    )
    expect(execution).toMatchObject({
      id: "TECH-0001",
      status: "validated",
      lifecycleEvidence: {
        verifiedEvidenceCount: 1,
        distinctGenreSourceCount: 1,
      },
    })
    const serialized = JSON.stringify(execution)
    expect(serialized).not.toContain("Internal evidence-private-001")
    expect(serialized).not.toContain("private-reviewer")
    expect(serialized).not.toContain("evidence-private-001")
  })
})

describe("Composer Intelligence / Validation", () => {
  it("Section・時間・Intent・Observation未確認ではValidatedへ昇格しない", () => {
    const draft = {
      ...knowledge(),
      evidence: [evidence("evidence-001", "genre-source-001", false)],
    }
    const result = transitionTechniqueStatus(
      draft,
      "validated",
      [principle()],
      review,
    )
    expect(result.technique).toBeNull()
    expect(result.validation.eligible).toBe(false)
    expect(result.validation.verifiedEvidenceCount).toBe(0)
  })

  it("確認済みEvidenceとGenre PrincipleでValidatedへ昇格し履歴を残す", () => {
    const draft = {
      ...knowledge(),
      evidence: [evidence("evidence-001")],
    }
    const result = transitionTechniqueStatus(
      draft,
      "validated",
      [principle()],
      review,
    )
    expect(result.validation).toMatchObject({
      eligible: true,
      verifiedEvidenceCount: 1,
      validatedPrincipleCount: 1,
    })
    expect(result.technique).toMatchObject({
      id: "TECH-0001",
      version: 2,
      status: "validated",
      reviewHistory: [
        {
          fromStatus: "draft",
          toStatus: "validated",
          reason: review.reason,
        },
      ],
    })
  })

  it("複数Genreと再現性確認でCanonicalへ昇格する", () => {
    const validated = knowledge({
      status: "validated",
      reproducibilityConfirmed: true,
      genreSources: [
        { id: "genre-source-001", name: "Genre A" },
        { id: "genre-source-002", name: "Genre B" },
      ],
      evidence: [
        evidence("evidence-001"),
        evidence("evidence-002", "genre-source-002"),
      ],
    })
    const result = transitionTechniqueStatus(
      validated,
      "canonical",
      [principle(), principle("genre-source-002")],
      { ...review, id: "review-002", reason: "複数Genreで再現" },
    )
    expect(result.validation).toMatchObject({
      eligible: true,
      distinctGenreSourceCount: 2,
    })
    expect(result.technique?.status).toBe("canonical")
  })

  it("単一Genreでも十分なEvidenceと再現性があればCanonical候補になる", () => {
    const validated = knowledge({
      status: "validated",
      reproducibilityConfirmed: true,
      evidence: Array.from(
        { length: CANONICAL_EVIDENCE_THRESHOLD },
        (_, index) => evidence(`evidence-${index}`),
      ),
    })
    expect(
      validateTechniqueStatus(
        validated,
        "canonical",
        [principle()],
      ),
    ).toMatchObject({
      eligible: true,
      verifiedEvidenceCount: CANONICAL_EVIDENCE_THRESHOLD,
      distinctGenreSourceCount: 1,
    })
  })

  it("Confidence更新とDeprecated移行をReview Historyへ記録する", () => {
    const confidenceUpdated = updateTechniqueConfidence(
      knowledge(),
      0.92,
      { ...review, reason: "Evidence追加により再評価" },
    )
    expect(confidenceUpdated).toMatchObject({
      confidence: 0.92,
      version: 2,
    })
    const deprecated = transitionTechniqueStatus(
      confidenceUpdated,
      "deprecated",
      [],
      { ...review, id: "review-003", reason: "誤分析を確認" },
    )
    expect(deprecated.technique).toMatchObject({
      status: "deprecated",
      version: 3,
    })
    expect(deprecated.technique?.reviewHistory).toHaveLength(2)
  })
})
