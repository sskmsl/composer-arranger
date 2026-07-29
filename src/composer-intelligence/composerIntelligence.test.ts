import { describe, expect, it } from "vitest"
import {
  buildGenrePrinciple,
  compileTechniqueRules,
  createTechniqueLibrary,
  evaluateTechniqueLifecycle,
  resolveComposerRules,
  ruleFromTechnique,
  techniquePreferenceWeight,
  type ComposerRule,
  type GenreObservation,
  type TechniqueDefinition,
} from "."

function observations(
  count: number,
  genreSourceId = "genre-source-core-01",
): GenreObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `observation-${genreSourceId}-${index}`,
    referenceId: `private-reference-${genreSourceId}-${index}`,
    genreSourceId,
    techniqueId: "TECH-9001",
    observation: "匿名化された演出上の事実",
    inferredIntent: "場面転換の期待感を高める",
    confidence: 0.8 + index * 0.03,
    verifiedByHuman: true,
  }))
}

function technique(
  status: TechniqueDefinition["status"] = "validated",
  genreSourceIds = ["genre-source-core-01"],
): TechniqueDefinition {
  return {
    id: "TECH-9001",
    version: 1,
    status,
    category: "transition",
    observation: "転換前に音域と密度が段階的に変化する",
    intent: "次セクションを自然に予告する",
    generatorTargets: ["decoration", "melody"],
    genreSourceIds,
    priority: 50,
    confidence: 0.9,
    lifecycleEvidence: {
      verifiedEvidenceCount: status === "draft" ? 0 : 3,
      distinctGenreSourceCount: genreSourceIds.length,
      reproducibilityConfirmed: status === "canonical",
    },
    rule: {
      when: {
        generatorTargets: ["decoration"],
        sectionRoles: ["pre-chorus"],
      },
      prefer: {
        registerDirection: [
          { value: "rising", weight: 0.7 },
          { value: "stable", weight: 0.3 },
        ],
        densityDirection: [
          { value: "increasing", weight: 1 },
        ],
      },
    },
  }
}

describe("Composer Intelligence / Genre Principle", () => {
  it("3つの独立Referenceで確認されるまでPrincipleへ昇格しない", () => {
    expect(
      buildGenrePrinciple({
        id: "principle-1",
        techniqueId: "TECH-9001",
        genreSourceId: "genre-source-core-01",
        statement: "転換前の段階的な上昇は期待を作る",
        generatorTargets: ["decoration"],
        observations: observations(2),
      }),
    ).toBeNull()

    const principle = buildGenrePrinciple({
      id: "principle-1",
      techniqueId: "TECH-9001",
      genreSourceId: "genre-source-core-01",
      statement: "転換前の段階的な上昇は期待を作る",
      generatorTargets: ["decoration"],
      observations: observations(3),
    })
    expect(principle).toMatchObject({
      status: "validated",
      referenceCount: 3,
      techniqueId: "TECH-9001",
    })
  })

  it("未確認Observationや同一Referenceの重複を件数へ含めない", () => {
    const duplicated = observations(3).map((observation) => ({
      ...observation,
      referenceId: "same-reference",
    }))
    duplicated.push({
      ...observations(1)[0],
      id: "unverified",
      referenceId: "other-reference",
      verifiedByHuman: false,
    })
    expect(
      buildGenrePrinciple({
        id: "principle-1",
        techniqueId: "TECH-9001",
        genreSourceId: "genre-source-core-01",
        statement: "原則",
        generatorTargets: ["decoration"],
        observations: duplicated,
      }),
    ).toBeNull()
  })
})

describe("Composer Intelligence / Technique Library", () => {
  it("Validated Principleからだけ匿名Technique Ruleを生成する", () => {
    const principle = buildGenrePrinciple({
      id: "principle-1",
      techniqueId: "TECH-9001",
      genreSourceId: "genre-source-core-01",
      statement: "転換前の段階的な上昇は期待を作る",
      generatorTargets: ["decoration"],
      observations: observations(3),
    })!
    const rule = ruleFromTechnique(technique(), principle)
    expect(rule).toMatchObject({
      origin: "technique",
      priority: 50,
      techniqueId: "TECH-9001",
    })
    expect(JSON.stringify(rule)).not.toContain("private-reference")
    expect(JSON.stringify(rule)).not.toContain("genre-source")

    const library = createTechniqueLibrary([technique()])
    expect(compileTechniqueRules(library, [principle])).toEqual([rule])
  })

  it("Draftは分析対象に留め、Ruleへ変換しない", () => {
    const principle = buildGenrePrinciple({
      id: "principle-draft",
      techniqueId: "TECH-9001",
      genreSourceId: "genre-source-core-01",
      statement: "原則",
      generatorTargets: ["decoration"],
      observations: observations(3),
    })!
    const draft = technique("draft")
    expect(evaluateTechniqueLifecycle(draft, [principle])).toMatchObject({
      status: "draft",
      eligible: false,
    })
    expect(ruleFromTechnique(draft, principle)).toBeNull()
  })

  it("Canonicalは2 Genre以上のValidated Principleを必要とする", () => {
    const first = buildGenrePrinciple({
      id: "principle-core-01",
      techniqueId: "TECH-9001",
      genreSourceId: "genre-source-core-01",
      statement: "原則A",
      generatorTargets: ["decoration"],
      observations: observations(3, "genre-source-core-01"),
    })!
    const second = buildGenrePrinciple({
      id: "principle-core-02",
      techniqueId: "TECH-9001",
      genreSourceId: "genre-source-core-02",
      statement: "原則B",
      generatorTargets: ["decoration"],
      observations: observations(3, "genre-source-core-02"),
    })!
    const insufficient = technique("canonical", [
      "genre-source-core-01",
    ])
    const canonical = technique("canonical", [
      "genre-source-core-01",
      "genre-source-core-02",
    ])

    expect(
      evaluateTechniqueLifecycle(insufficient, [first]),
    ).toMatchObject({
      eligible: false,
      distinctGenreSources: 1,
    })
    expect(ruleFromTechnique(insufficient, first)).toBeNull()

    const evaluation = evaluateTechniqueLifecycle(canonical, [
      first,
      second,
    ])
    expect(evaluation).toMatchObject({
      status: "canonical",
      eligible: true,
      distinctGenreSources: 2,
      validatedPrincipleCount: 2,
    })
    expect(ruleFromTechnique(canonical, [first, second])).toMatchObject({
      status: "canonical",
      priority: 50,
    })
    expect(
      compileTechniqueRules(
        createTechniqueLibrary([canonical]),
        [first, second],
      ),
    ).toHaveLength(1)
  })
})

describe("Composer Intelligence / Rule Resolver", () => {
  it("Artist Priority 100をTechnique Priority 50で上書きしない", () => {
    const rules: ComposerRule[] = [
      {
        id: "artist-rule",
        origin: "artist",
        status: "validated",
        priority: 100,
        confidence: 0.8,
        when: { generatorTargets: ["melody"] },
        prefer: {
          phraseContour: [{ value: "descending", weight: 1 }],
        },
      },
      {
        id: "technique-rule",
        origin: "technique",
        techniqueId: "TECH-9002",
        status: "validated",
        priority: 50,
        confidence: 1,
        when: { generatorTargets: ["melody"] },
        prefer: {
          phraseContour: [{ value: "ascending", weight: 1 }],
          rhythmCharacter: [{ value: "breathing", weight: 1 }],
        },
      },
    ]
    const resolved = resolveComposerRules(rules, {
      generatorTarget: "melody",
      sectionRole: "verse",
    })
    expect(resolved.preferences.phraseContour).toMatchObject({
      priority: 100,
      values: [{ value: "descending", weight: 1 }],
    })
    expect(
      techniquePreferenceWeight(
        resolved,
        "phraseContour",
        "ascending",
      ),
    ).toBe(0)
    expect(
      techniquePreferenceWeight(
        resolved,
        "rhythmCharacter",
        "breathing",
      ),
    ).toBe(1)
  })

  it("Confidenceと文脈適合度を使い、同Priority内の分布を正規化する", () => {
    const rules: ComposerRule[] = [
      {
        id: "technique-a",
        origin: "technique",
        status: "validated",
        priority: 50,
        confidence: 1,
        when: {
          generatorTargets: ["phrase"],
          sectionRoles: ["pre-chorus"],
        },
        prefer: {
          cadenceType: [{ value: "open", weight: 1 }],
        },
      },
      {
        id: "technique-b",
        origin: "technique",
        status: "validated",
        priority: 50,
        confidence: 0.5,
        when: {
          generatorTargets: ["phrase"],
          sectionRoles: ["pre-chorus"],
        },
        prefer: {
          cadenceType: [{ value: "suspended", weight: 1 }],
        },
      },
      {
        id: "wrong-context",
        origin: "technique",
        status: "validated",
        priority: 50,
        confidence: 1,
        when: { generatorTargets: ["counter"] },
        prefer: {
          cadenceType: [{ value: "resolved", weight: 1 }],
        },
      },
    ]
    const resolved = resolveComposerRules(rules, {
      generatorTarget: "phrase",
      sectionRole: "pre-chorus",
    })
    expect(
      techniquePreferenceWeight(resolved, "cadenceType", "open"),
    ).toBeCloseTo(2 / 3)
    expect(
      techniquePreferenceWeight(
        resolved,
        "cadenceType",
        "suspended",
      ),
    ).toBeCloseTo(1 / 3)
    expect(
      techniquePreferenceWeight(
        resolved,
        "cadenceType",
        "resolved",
      ),
    ).toBe(0)
  })

  it("Canonicalを主成分、Validatedを補助成分として混合する", () => {
    const rules: ComposerRule[] = [
      {
        id: "canonical-technique",
        origin: "technique",
        status: "canonical",
        priority: 50,
        confidence: 1,
        when: { generatorTargets: ["decoration"] },
        prefer: {
          phraseDensity: [{ value: "sparse", weight: 1 }],
        },
      },
      {
        id: "validated-technique",
        origin: "technique",
        status: "validated",
        priority: 50,
        confidence: 1,
        when: { generatorTargets: ["decoration"] },
        prefer: {
          phraseDensity: [{ value: "rich", weight: 1 }],
        },
      },
      {
        id: "draft-technique",
        origin: "technique",
        status: "draft",
        priority: 50,
        confidence: 1,
        when: { generatorTargets: ["decoration"] },
        prefer: {
          phraseDensity: [{ value: "normal", weight: 1 }],
        },
      },
    ]
    const resolved = resolveComposerRules(rules, {
      generatorTarget: "decoration",
      sectionRole: "verse",
    })

    expect(
      techniquePreferenceWeight(
        resolved,
        "phraseDensity",
        "sparse",
      ),
    ).toBeCloseTo(1 / 1.35)
    expect(
      techniquePreferenceWeight(resolved, "phraseDensity", "rich"),
    ).toBeCloseTo(0.35 / 1.35)
    expect(
      techniquePreferenceWeight(
        resolved,
        "phraseDensity",
        "normal",
      ),
    ).toBe(0)
  })
})
