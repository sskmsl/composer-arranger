import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ComposerProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import { buildMultiPartArrangementPackage } from "./multiPartArrangementPackage"

function project(): ComposerProject {
  const value = createEmptyProject("Multi-Part Test")
  value.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
    { id: "verse", name: "Verse", role: "verse", startBar: 5, lengthBars: 4 },
    { id: "pre", name: "Pre", role: "pre-chorus", startBar: 9, lengthBars: 4 },
    { id: "chorus", name: "Chorus", role: "chorus", startBar: 13, lengthBars: 4 },
    { id: "outro", name: "Outro", role: "outro", startBar: 17, lengthBars: 4 },
  ]
  value.chords = value.sections.flatMap((section) => [
    { id: `${section.id}:1`, sectionId: section.id, startBeat: 0, durationBeats: 8, symbol: "Am(add9)", bass: null },
    { id: `${section.id}:2`, sectionId: section.id, startBeat: 8, durationBeats: 8, symbol: "Fmaj7", bass: null },
  ])
  value.melodyVariants = value.sections.map((section, index): MelodyVariant => ({
    id: `${section.id}:melody`, name: section.name, sectionId: section.id,
    sourceMode: "import-midi",
    notes: [{ id: `${section.id}:note`, pitch: 60 + index, startBeat: 0, durationBeats: 2, velocity: 80, locks: [] }],
    phrasePlans: [], lockedBars: [], motifLocked: false, features: null,
    generatorVersion: "test", seed: 1, songProfile: value.song.songProfile,
    parentMelodyId: null, batchId: "batch", createdAt: "2026-01-01T00:00:00.000Z",
  }))
  value.sectionMelodyAssignments = Object.fromEntries(
    value.melodyVariants.map((variant) => [variant.sectionId, variant.id]),
  )
  return value
}

describe("Multi-Part Arrangement Package", () => {
  it("全Sectionに同じRole集合と登退場を持つMatrixを作る", () => {
    const result = buildMultiPartArrangementPackage(project(), "controlled-escalation")
    expect(result.sections).toHaveLength(5)
    for (const section of result.sections) {
      expect(section.parts.map((part) => part.partRole)).toEqual([
        "lead", "bass", "rhythm", "harmony", "counter", "strings", "color", "space",
      ])
    }
    expect(result.sections.some((section) => section.parts.some(
      (part) => part.state === "withdraw" || part.state === "silence",
    ))).toBe(true)
    expect(["ready", "watch", "blocked", "pending"]).toContain(result.executionGate.status)
  })

  it("Foundation・Movement・Colorを既存Generatorへ段階分離する", () => {
    const result = buildMultiPartArrangementPackage(project(), "motif-relay")
    expect(result.stages.map((stage) => stage.id)).toEqual(["foundation", "movement", "color"])
    expect(result.stages[0].actions.every((action) => action.generator === "accompaniment")).toBe(true)
    expect(result.stages[1].actions.every((action) => action.generator === "counter")).toBe(true)
    expect(result.stages[2].actions.every((action) => ["signature", "decoration"].includes(action.generator))).toBe(true)
  })

  it("専用GeneratorがないBass・Spaceを設計として保持し、偽のMIDIを生成しない", () => {
    const result = buildMultiPartArrangementPackage(project(), "preserve-space")
    const designOnly = result.sections.flatMap((section) => section.parts).filter(
      (part) => ["bass", "space"].includes(part.partRole),
    )
    expect(designOnly.every((part) => part.execution === null)).toBe(true)
    expect(designOnly.every((part) => part.implementation === "design-only")).toBe(true)
  })

  it("Climax接近・表現SectionのStringsをString Counter候補へ接続する", () => {
    const result = buildMultiPartArrangementPackage(project(), "controlled-escalation")
    const strings = result.sections.flatMap((section) => section.parts).filter(
      (part) => part.partRole === "strings" && part.execution,
    )
    expect(strings.length).toBeGreaterThanOrEqual(1)
    expect(strings.every((part) =>
      part.execution?.generator === "counter" && part.execution.family === "strings",
    )).toBe(true)
    expect(result.stages.find((stage) => stage.id === "movement")?.actions.some(
      (action) => action.family === "strings",
    )).toBe(true)
  })

  it("Active Melody不足を実行不能としてQuality Gateへ記録する", () => {
    const value = project()
    delete value.sectionMelodyAssignments.verse
    const result = buildMultiPartArrangementPackage(value, "motif-relay")
    const verseCounter = result.sections.find((section) => section.sectionId === "verse")
      ?.parts.find((part) => part.partRole === "counter")
    expect(verseCounter?.execution).toBeNull()
    expect(verseCounter?.state).toBe("silence")
    expect(result.executionGate.findings.length).toBeGreaterThan(0)
  })

  it("同じ入力とDirectionで再現可能なPackageを返す", () => {
    const value = project()
    expect(buildMultiPartArrangementPackage(value, "motif-relay"))
      .toEqual(buildMultiPartArrangementPackage(value, "motif-relay"))
  })
})
