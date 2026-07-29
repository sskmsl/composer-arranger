import { describe, expect, it } from "vitest"
import {
  buildGenrePrinciple,
  compileTechniqueRules,
  createTechniqueLibrary,
  resolveComposerRules,
  ruleFromTechnique,
  techniquePreferenceWeight,
  type ComposerRule,
  type GenreObservation,
  type TechniqueDefinition,
} from "."

function observations(count: number): GenreObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `observation-${index}`,
    referenceId: `private-reference-${index}`,
    genreSourceId: "genre-source-core-01",
    techniqueId: "technique-transition-lift",
    observation: "匿名化された演出上の事実",
    inferredIntent: "場面転換の期待感を高める",
    confidence: 0.8 + index * 0.03,
    verifiedByHuman: true,
  }))
}

function technique(): TechniqueDefinition {
  return {
    id: "technique-transition-lift",
    version: 1,
    status: "validated",
    category: "transition",
    observation: "転換前に音域と密度が段階的に変化する",
    intent: "次セクションを自然に予告する",
    generatorTargets: ["decoration", "melody"],
    genreSourceIds: ["genre-source-core-01"],
    priority: 50,
    confidence: 0.9,
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
        techniqueId: "technique-transition-lift",
        statement: "転換前の段階的な上昇は期待を作る",
        generatorTargets: ["decoration"],
        observations: observations(2),
      }),
    ).toBeNull()

    const principle = buildGenrePrinciple({
      id: "principle-1",
      techniqueId: "technique-transition-lift",
      statement: "転換前の段階的な上昇は期待を作る",
      generatorTargets: ["decoration"],
      observations: observations(3),
    })
    expect(principle).toMatchObject({
      status: "validated",
      referenceCount: 3,
      techniqueId: "technique-transition-lift",
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
        techniqueId: "technique-transition-lift",
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
      techniqueId: "technique-transition-lift",
      statement: "転換前の段階的な上昇は期待を作る",
      generatorTargets: ["decoration"],
      observations: observations(3),
    })!
    const rule = ruleFromTechnique(technique(), principle)
    expect(rule).toMatchObject({
      origin: "technique",
      priority: 50,
      techniqueId: "technique-transition-lift",
    })
    expect(JSON.stringify(rule)).not.toContain("private-reference")
    expect(JSON.stringify(rule)).not.toContain("genre-source")

    const library = createTechniqueLibrary([technique()])
    expect(compileTechniqueRules(library, [principle])).toEqual([rule])
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
        techniqueId: "technique-1",
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
})
