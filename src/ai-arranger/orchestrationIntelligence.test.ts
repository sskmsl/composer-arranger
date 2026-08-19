import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import { buildOrchestrationBlueprint } from "./orchestrationIntelligence"

function project() {
  const value = createEmptyProject("Orchestration")
  value.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
    { id: "verse", name: "Verse", role: "verse", startBar: 5, lengthBars: 4 },
    { id: "grand", name: "Grand Chorus", role: "grand-chorus", startBar: 9, lengthBars: 4 },
    { id: "outro", name: "Outro", role: "outro", startBar: 13, lengthBars: 4 },
  ]
  value.sectionMelodyAssignments = { intro: "m1", verse: "m2", grand: "m3" }
  return value
}

describe("Orchestration & Performance Intelligence", () => {
  it("前半Sectionでは主役を前景、和声空間を遠景へ置き、頂点資源を温存する", () => {
    const value = project()
    const orchestration = buildOrchestrationBlueprint(
      value,
      buildArrangementDirectorBlueprint(value),
    )
    const intro = orchestration.sections[0]
    expect(intro.parts.length).toBeLessThanOrEqual(intro.maxSimultaneousParts)
    expect(intro.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "lead-focus",
        sourceState: "active",
        distance: "intimate",
      }),
      expect.objectContaining({
        role: "harmonic-space",
        family: "atmospheric-pad",
        distance: "distant",
      }),
    ]))
    expect(intro.withheldGestures.join(" ")).toContain("最高音")
  })

  it("大サビでは全音域と強いDynamicsを許し、温存一覧を解放する", () => {
    const value = project()
    const grand = buildOrchestrationBlueprint(
      value,
      buildArrangementDirectorBlueprint(value),
    ).sections[2]
    expect(grand.withheldGestures).toEqual([])
    expect(grand.parts.find((part) => part.role === "lead-focus")).toMatchObject({
      register: "middle-high",
      dynamic: "f",
    })
    expect(grand.maxSimultaneousParts).toBe(5)
  })

  it("Leadも伴奏も無いSectionは、無理に楽器を提案せず意図的な無音にする", () => {
    const value = project()
    value.sections[0].content = {
      lead: "none",
      accompaniment: "none",
      entryOffsetBeats: 0,
      pickup: false,
    }
    delete value.sectionMelodyAssignments.intro
    const intro = buildOrchestrationBlueprint(
      value,
      buildArrangementDirectorBlueprint(value),
    ).sections[0]
    expect(intro.parts).toEqual([
      expect.objectContaining({ role: "intentional-silence", family: "silence" }),
    ])
  })

  it("密度超過した既存Activeパートを隠さず、追加候補だけを抑制する", () => {
    const value = project()
    value.arrangementSettings.maximumParts = 1
    value.sectionAccompanimentPatternAssignments.verse = "pulse-root-fifth"
    value.sectionReactiveLayerAssignments = { verse: "counter" }
    value.reactiveLayerCandidates = [{ id: "counter" } as ReactiveLayerCandidate]
    const verse = buildOrchestrationBlueprint(
      value,
      buildArrangementDirectorBlueprint(value),
    ).sections[1]
    expect(verse.parts.filter((part) => part.sourceState === "active").length).toBeGreaterThan(1)
    expect(verse.parts.some((part) => part.sourceState === "recommended")).toBe(false)
  })

  it("同じProjectとDirectorから同じ演奏計画を作る", () => {
    const value = project()
    const director = buildArrangementDirectorBlueprint(value)
    expect(buildOrchestrationBlueprint(value, director)).toEqual(
      buildOrchestrationBlueprint(value, director),
    )
  })

  it("作曲者のRole別Orchestration固定値を自動設計へ重ねる", () => {
    const value = project()
    value.sectionOrchestrationOverrides = {
      verse: {
        "lead-focus": {
          family: "analog-synth",
          distance: "near",
          articulation: "detached",
          dynamic: "mp",
          timing: "slightly-ahead",
        },
      },
    }
    const lead = buildOrchestrationBlueprint(
      value,
      buildArrangementDirectorBlueprint(value),
    ).sections[1].parts.find((part) => part.role === "lead-focus")!
    expect(lead).toMatchObject({
      family: "analog-synth",
      distance: "near",
      articulation: "detached",
      dynamic: "mp",
      timing: "slightly-ahead",
      velocityRange: [58, 78],
      role: "lead-focus",
      sourceState: "active",
    })
  })
})
