import { describe, expect, it } from "vitest"
import schema from "../../schemas/composer-intelligence.schema.json"
import example from "../../schemas/examples/composer-intelligence.anonymous.json"

describe("Composer Intelligence public schema", () => {
  it("Technique / PrincipleとPriority・Confidence制約を公開契約へ持つ", () => {
    expect(schema.$schema).toContain("2020-12")
    expect(schema.$defs.technique.properties.priority.const).toBe(50)
    expect(schema.$defs.status.enum).toContain("canonical")
    expect(schema.$defs.technique.properties.confidence).toMatchObject({
      minimum: 0,
      maximum: 1,
    })
    expect(schema.$defs.principle.properties.referenceCount.minimum).toBe(3)
    expect(schema.$defs.principle.properties.observationIds.minItems).toBe(3)
    expect(schema.$defs.principle.required).toContain("genreSourceId")
  })

  it("公開Exampleは匿名IDだけを持ち、Reference実名フィールドを持たない", () => {
    expect(example.schemaVersion).toBe(1)
    expect(example.techniques[0].genreSourceIds).toEqual([
      "genre-source-core-01",
    ])
    expect(example.principles[0].referenceCount).toBeGreaterThanOrEqual(3)
    expect(example.principles[0].genreSourceId).toBe(
      "genre-source-core-01",
    )
    const serialized = JSON.stringify(example)
    expect(serialized).not.toMatch(
      /artist|composer|vocalist|album|song|referenceSongs/i,
    )
  })
})
