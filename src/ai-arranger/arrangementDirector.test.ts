import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { SectionRole } from "@/core/section"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"

function projectWithRoles(roles: SectionRole[]) {
  const project = createEmptyProject("Director test")
  project.sections = roles.map((role, index) => ({
    id: `${role}-${index}`,
    name: `${role} ${index + 1}`,
    role,
    startBar: index * 4 + 1,
    lengthBars: 4,
  }))
  return project
}

describe("Arrangement Director", () => {
  it("大サビを曲全体の頂点として選び、それ以前では資源を温存する", () => {
    const project = projectWithRoles([
      "intro",
      "verse",
      "pre-chorus",
      "chorus",
      "bridge",
      "grand-chorus",
      "outro",
    ])
    const blueprint = buildArrangementDirectorBlueprint(project)

    expect(blueprint.climaxSectionId).toBe("grand-chorus-5")
    expect(blueprint.sections[5]).toMatchObject({
      climaxPolicy: "express",
      targetEnergy: 5,
      registerFocus: "full",
      withhold: [],
    })
    expect(blueprint.sections[0].withhold).toContain("曲中の最高音")
    expect(blueprint.sections[6]).toMatchObject({
      climaxPolicy: "recover",
      targetEnergy: 1,
    })
  })

  it("大サビがない場合は最後のサビを頂点にして反復サビの役割を分ける", () => {
    const project = projectWithRoles(["verse", "chorus", "verse", "chorus"])
    const blueprint = buildArrangementDirectorBlueprint(project)

    expect(blueprint.climaxSectionId).toBe("chorus-3")
    expect(blueprint.sections[1].climaxPolicy).toBe("approach")
    expect(blueprint.sections[3].climaxPolicy).toBe("express")
  })

  it("既存レイヤーを数え、密度上限を超える追加を許可しない", () => {
    const project = projectWithRoles(["intro", "grand-chorus"])
    project.arrangementSettings.maximumParts = 4
    project.arrangementSettings.spacePriority = 0.8
    project.chords = [{
      id: "chord-1",
      sectionId: "intro-0",
      startBeat: 0,
      durationBeats: 4,
      symbol: "Am",
      bass: null,
    }]
    project.sectionMelodyAssignments["intro-0"] = "melody-1"
    project.sectionAccompanimentPatternAssignments["intro-0"] = "pattern-1"

    const intro = buildArrangementDirectorBlueprint(project).sections[0]
    expect(intro.existingLayerCount).toBe(3)
    expect(intro.densityCeiling).toBeLessThanOrEqual(4)
    expect(intro.additionBudget).toBe(0)
  })

  it("同じProject状態から常に同じ設計図を作る", () => {
    const project = projectWithRoles(["intro", "verse", "chorus", "outro"])
    expect(buildArrangementDirectorBlueprint(project)).toEqual(
      buildArrangementDirectorBlueprint(project),
    )
  })

  it("サビ系Sectionが未設定の制作途中では、勝手に頂点を決めない", () => {
    const project = projectWithRoles(["intro", "verse", "verse"])
    const blueprint = buildArrangementDirectorBlueprint(project)
    expect(blueprint.climaxSectionId).toBeNull()
    expect(blueprint.sections.every((plan) => plan.climaxPolicy === "reserve")).toBe(true)
    expect(blueprint.sections.every((plan) => plan.targetEnergy < 5)).toBe(true)
  })

  it("作曲者が指定したClimax Sectionを自動選択より優先する", () => {
    const project = projectWithRoles(["verse", "chorus", "bridge", "grand-chorus"])
    project.arrangementDirectorOverrides = {
      climaxSectionId: "bridge-2",
      sections: {},
    }
    const blueprint = buildArrangementDirectorBlueprint(project)
    expect(blueprint.climaxSectionId).toBe("bridge-2")
    expect(blueprint.sections[2]).toMatchObject({ climaxPolicy: "express", targetEnergy: 5 })
    expect(blueprint.sections[3].climaxPolicy).toBe("recover")
  })

  it("Section別Energy・密度上限の固定値を安全範囲で適用する", () => {
    const project = projectWithRoles(["verse", "pre-chorus", "chorus"])
    project.arrangementSettings.maximumParts = 4
    project.arrangementDirectorOverrides = {
      sections: {
        "verse-0": { targetEnergy: 1, densityCeiling: 2 },
        "pre-chorus-1": { targetEnergy: 4, densityCeiling: 99 },
      },
    }
    const blueprint = buildArrangementDirectorBlueprint(project)
    expect(blueprint.sections[0]).toMatchObject({ targetEnergy: 1, densityCeiling: 2 })
    expect(blueprint.sections[1]).toMatchObject({ targetEnergy: 4, densityCeiling: 4 })
    expect(blueprint.sections[0].transitionIntent).toContain("期待")
  })
})
