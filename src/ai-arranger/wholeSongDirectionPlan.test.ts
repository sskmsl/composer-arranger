import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ComposerProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import {
  buildWholeSongDirectionProgram,
  intentForWholeSongAction,
  wholeSongDirectionForAiIntent,
} from "./wholeSongDirectionPlan"

function project(): ComposerProject {
  const value = createEmptyProject("Direction Test")
  value.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
    { id: "verse", name: "Verse", role: "verse", startBar: 5, lengthBars: 4 },
    { id: "pre", name: "Pre", role: "pre-chorus", startBar: 9, lengthBars: 4 },
    { id: "chorus", name: "Chorus", role: "chorus", startBar: 13, lengthBars: 4 },
  ]
  value.chords = value.sections.flatMap((section) => [
    { id: `${section.id}:1`, sectionId: section.id, startBeat: 0, durationBeats: 8, symbol: "Am(add9)", bass: null },
    { id: `${section.id}:2`, sectionId: section.id, startBeat: 8, durationBeats: 8, symbol: "Fmaj7", bass: null },
  ])
  value.melodyVariants = value.sections.map((section, index): MelodyVariant => ({
    id: `${section.id}:melody`,
    name: section.name,
    sectionId: section.id,
    sourceMode: "import-midi",
    notes: [{ id: `${section.id}:note`, pitch: 60 + index, startBeat: 0, durationBeats: 2, velocity: 80, locks: [] }],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: value.song.songProfile,
    parentMelodyId: null,
    batchId: "batch",
    createdAt: "2026-01-01T00:00:00.000Z",
  }))
  value.sectionMelodyAssignments = Object.fromEntries(
    value.melodyVariants.map((variant) => [variant.sectionId, variant.id]),
  )
  return value
}

describe("Whole-song Arrangement Direction Program", () => {
  it("同じ設計図から性格の異なる5方向を決定論的に作る", () => {
    const first = buildWholeSongDirectionProgram(project(), "冷たい余白を残したい")
    const second = buildWholeSongDirectionProgram(project(), "冷たい余白を残したい")
    expect(first).toEqual(second)
    expect(first.directions).toHaveLength(5)
    expect(new Set(first.directions.map((direction) => direction.id)).size).toBe(5)
    expect(new Set(first.directions.map((direction) => direction.character)).size).toBe(5)
    expect(new Set(first.directions.map((direction) =>
      direction.actions.map((action) => action.generator).join(","),
    )).size).toBeGreaterThanOrEqual(4)
  })

  it("言語化された世界観から推奨方向を選ぶ", () => {
    expect(buildWholeSongDirectionProgram(project(), "余白と残響を守る").recommendedDirectionId).toBe("preserve-space")
    expect(buildWholeSongDirectionProgram(project(), "サビへ段階的に盛り上げる").recommendedDirectionId).toBe("controlled-escalation")
    expect(buildWholeSongDirectionProgram(project(), "ビートとグルーヴで推進する").recommendedDirectionId).toBe("rhythmic-propulsion")
    expect(buildWholeSongDirectionProgram(project(), "短いモチーフを記憶に残す").recommendedDirectionId).toBe("motif-relay")
    expect(buildWholeSongDirectionProgram(project(), "主旋律を中心に自然なバランス").recommendedDirectionId).toBe("balanced-architecture")
    expect(buildWholeSongDirectionProgram(project(), "").recommendationReason.length).toBeGreaterThan(10)
  })

  it("原曲Melodyを書き換えるActionを作らず、Counter不足も明示する", () => {
    const value = project()
    delete value.sectionMelodyAssignments.verse
    const program = buildWholeSongDirectionProgram(value, "モチーフを受け渡す")
    expect(program.directions.flatMap((direction) => direction.actions).map((action) => String(action.generator))).not.toContain("melody")
    const verse = program.directions.find((direction) => direction.id === "motif-relay")?.actions.find((action) => action.sectionId === "verse")
    expect(verse?.generator).not.toBe("counter")
  })

  it("Actionを既存Generation Bridge互換のIntentへ変換する", () => {
    const program = buildWholeSongDirectionProgram(project(), "サビへ向かって上昇")
    const action = program.directions[1].actions.find((candidate) => candidate.status === "available")!
    const intent = intentForWholeSongAction(action)
    expect(intent.generator).toBe(action.generator)
    expect(intent.lengthBars).toBeGreaterThanOrEqual(1)
    expect(intent.generationBrief).toContain(action.purpose)
  })

  it("AIの全曲リズム案をSection別Actionを持つRhythmic方針へ接続する", () => {
    const value = project()
    const baseProgram = buildWholeSongDirectionProgram(value, "全体バランス")
    const baseAction = baseProgram.directions[4].actions.find(
      (candidate) => candidate.status === "available",
    )!
    const intent = {
      ...intentForWholeSongAction(baseAction),
      id: "ai-rhythm",
      title: "呼吸する推進力",
      generator: "rhythm" as const,
      emotionalFunction: "Sectionごとに異なる周期で全曲を前へ進める",
      generationBrief: "Aメロは抑え、サビでビートを開く",
      why: "曲全体の歩幅を作る",
      techniques: ["pulse", "groove"],
    }

    const result = wholeSongDirectionForAiIntent(value, intent)
    expect(result.direction.id).toBe("rhythmic-propulsion")
    expect(result.direction.actions).toHaveLength(value.sections.length)
    expect(new Set(result.direction.actions.map((action) => action.sectionId))).toEqual(
      new Set(value.sections.map((section) => section.id)),
    )
  })
})
