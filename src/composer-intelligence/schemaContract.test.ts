import { describe, expect, it } from "vitest"
import schema from "../../schemas/composer-intelligence.schema.json"
import example from "../../schemas/examples/composer-intelligence.anonymous.json"
import knowledgeSchema from "../../schemas/composer-intelligence-knowledge.schema.json"
import knowledgeExample from "../../schemas/examples/composer-intelligence-knowledge.anonymous.json"

describe("Composer Intelligence public schema", () => {
  it("Technique / PrincipleとPriority・Confidence制約を公開契約へ持つ", () => {
    expect(schema.$schema).toContain("2020-12")
    expect(schema.$defs.technique.properties.priority.const).toBe(50)
    expect(schema.$defs.status.enum).toContain("canonical")
    expect(schema.$defs.status.enum).toContain("deprecated")
    expect(schema.$defs.technique.properties.id.pattern).toBe(
      "^TECH-[0-9]{4,}$",
    )
    expect(schema.$defs.technique.properties.confidence).toMatchObject({
      minimum: 0,
      maximum: 1,
    })
    expect(schema.$defs.principle.properties.referenceCount.minimum).toBe(3)
    expect(schema.$defs.principle.properties.observationIds.minItems).toBe(3)
    expect(schema.$defs.principle.required).toContain("genreSourceId")
  })

  it("公開Exampleは匿名IDだけを持ち、Reference実名フィールドを持たない", () => {
    expect(example.schemaVersion).toBe(2)
    expect(example.techniques[0].genreSourceIds).toEqual([
      "genre-source-core-01",
    ])
    expect(example.principles[0].referenceCount).toBeGreaterThanOrEqual(3)
    expect(example.principles[0].genreSourceId).toBe(
      "genre-source-core-01",
    )
    expect(example.techniques[0].id).toBe("TECH-9001")
    const serialized = JSON.stringify(example)
    expect(serialized).not.toMatch(
      /artist|composer|vocalist|album|song|referenceSongs/i,
    )
  })

  it("Learning SchemaがEvidence・Review History・将来拡張を保持する", () => {
    const technique =
      knowledgeSchema.$defs.techniqueKnowledge.properties
    expect(technique.id.$ref).toBe("#/$defs/techniqueId")
    expect(technique.evidence.items.$ref).toBe("#/$defs/evidence")
    expect(technique.reviewHistory.items.$ref).toBe(
      "#/$defs/reviewHistory",
    )
    expect(technique.extensions.type).toBe("object")
    expect(
      knowledgeSchema.$defs.evidence.required,
    ).toEqual(
      expect.arrayContaining([
        "section",
        "startSeconds",
        "endSeconds",
        "intentConfirmed",
        "observationConfirmed",
      ]),
    )
  })

  it("Learning Exampleは永続IDと複数Evidence可能な配列構造を持つ", () => {
    const technique = knowledgeExample.techniques[0]
    expect(technique.id).toBe("TECH-9001")
    expect(technique.evidence).toHaveLength(1)
    expect(technique.reviewHistory[0]).toMatchObject({
      fromStatus: "draft",
      toStatus: "validated",
    })
  })
})
