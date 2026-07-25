import { beforeEach, describe, expect, it } from "vitest"
import { useProjectStore } from "./useProjectStore"
import { createEmptyProject } from "@/core/project"
import { DEFAULT_SECTION_CONTENT } from "@/core/sectionContent"
import { resolvedLeadContent } from "@/core/sectionLayers"
import type { ComposerProject } from "@/core/project"
import { parseChordInputText } from "@/core/chordInput"

/** persistはIndexedDBへ書くため、ストア単体テストでは無効化する */
function stubPersist() {
  useProjectStore.setState({ persist: () => {} } as never)
}

function projectWithSection(): ComposerProject {
  const base = createEmptyProject("test")
  const section = {
    id: "s1",
    name: "Intro",
    role: "intro" as const,
    startBar: 1,
    lengthBars: 4,
    content: { ...DEFAULT_SECTION_CONTENT },
  }
  return {
    ...base,
    sections: [section],
    chords: parseChordInputText("Am | F | C | G", "s1", 4, "c"),
  }
}

beforeEach(() => {
  useProjectStore.setState({
    project: projectWithSection(),
    selectedSectionId: "s1",
    activeBatchId: null,
    activeCandidateIndex: 0,
    history: [],
    future: [],
    workflowNotice: null,
  })
  stubPersist()
})

describe("Issue #41 / generateForSectionがContent設定で経路を切り替える", () => {
  it("既定(melody)では従来のMelody Engine候補が生成される", () => {
    useProjectStore.getState().generateForSection("s1")
    const variants = useProjectStore.getState().project.melodyVariants
    expect(variants.length).toBeGreaterThan(0)
    for (const variant of variants) {
      expect(resolvedLeadContent(variant)).toBe("melody")
      // 従来経路はGenerator Profileを持つ
      expect(variant.generatorProfile).toBeDefined()
    }
  })

  it("Droneを選ぶとcontent専用経路を通り、伴奏Layerを持つ候補が生成される", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "drone" })
    useProjectStore.getState().generateForSection("s1")

    const variants = useProjectStore.getState().project.melodyVariants
    expect(variants).toHaveLength(3)
    for (const variant of variants) {
      expect(resolvedLeadContent(variant)).toBe("drone")
      expect(variant.layers?.[0].partRole).toBe("accompaniment")
      expect(variant.contentPlan).toBeDefined()
      // 候補名にContent Modeが出る(候補カード表示用)
      expect(variant.name).toContain("Drone")
    }
  })

  it("Chords Only(lead=none)でもエラーにならず、0音の候補が選択できる", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "none", accompaniment: "chords" })
    useProjectStore.getState().generateForSection("s1")

    const variants = useProjectStore.getState().project.melodyVariants
    expect(variants).toHaveLength(3)
    // Active Melodyとして選べる(0音でも拒否されない)
    useProjectStore.getState().setActiveMelody(variants[0].id)
    expect(useProjectStore.getState().project.activeMelodyId).toBe(variants[0].id)
    expect(useProjectStore.getState().project.sectionMelodyAssignments.s1).toBe(variants[0].id)
  })

  it("Autoでは3候補に2種類以上のContentが現れる", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "auto" })
    useProjectStore.getState().generateForSection("s1")
    const variants = useProjectStore.getState().project.melodyVariants
    expect(new Set(variants.map((v) => resolvedLeadContent(v))).size).toBeGreaterThanOrEqual(2)
  })
})

describe("Issue #41 / Content Modeが操作で失われない", () => {
  it("Favorite / Active / Undo-Redo でleadContentとlayersが保たれる", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "ostinato" })
    useProjectStore.getState().generateForSection("s1")
    const target = useProjectStore.getState().project.melodyVariants[0]
    const originalLayers = target.layers

    useProjectStore.getState().setVariantReviewState(target.id, "favorite")
    useProjectStore.getState().setActiveMelody(target.id)

    const afterFlags = useProjectStore.getState().project.melodyVariants.find((v) => v.id === target.id)!
    expect(afterFlags.reviewState).toBe("favorite")
    expect(resolvedLeadContent(afterFlags)).toBe("ostinato")
    expect(afterFlags.layers).toEqual(originalLayers)

    // Undo/Redoを通しても内容が失われない
    useProjectStore.getState().undo()
    useProjectStore.getState().redo()
    const afterHistory = useProjectStore.getState().project.melodyVariants.find((v) => v.id === target.id)
    expect(afterHistory).toBeDefined()
    expect(resolvedLeadContent(afterHistory!)).toBe("ostinato")
    expect(afterHistory!.layers?.[0].partRole).toBe("accompaniment")
  })

  it("melody以外の候補へは部分再生成を適用せず、理由を通知する", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "drone" })
    useProjectStore.getState().generateForSection("s1")
    const target = useProjectStore.getState().project.melodyVariants[0]
    const before = useProjectStore.getState().project.melodyVariants.length

    useProjectStore.getState().regenerateRange(target.id, 0, 4, { pitch: false })

    // 候補は増えず、Content Modeも書き換わらない
    expect(useProjectStore.getState().project.melodyVariants).toHaveLength(before)
    expect(resolvedLeadContent(useProjectStore.getState().project.melodyVariants[0])).toBe("drone")
    expect(useProjectStore.getState().workflowNotice).toContain("部分再生成")
  })

  it("melody以外の候補へはSeed発展操作を適用せず、理由を通知する", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "motif" })
    useProjectStore.getState().generateForSection("s1")
    const target = useProjectStore.getState().project.melodyVariants[0]
    const before = useProjectStore.getState().project.melodyVariants.length

    useProjectStore.getState().applySeedOperation(target.id, "continue", [target.notes[0].id])

    expect(useProjectStore.getState().project.melodyVariants).toHaveLength(before)
    expect(useProjectStore.getState().workflowNotice).toContain("発展操作")
  })

  it("melody候補では従来どおり部分再生成が動く(回帰)", () => {
    useProjectStore.getState().generateForSection("s1")
    const target = useProjectStore.getState().project.melodyVariants[0]
    const before = useProjectStore.getState().project.melodyVariants.length

    useProjectStore.getState().regenerateRange(target.id, 0, 8, { pitch: false })

    expect(useProjectStore.getState().project.melodyVariants.length).toBeGreaterThan(before)
  })
})

describe("Issue #41 / setSectionContent", () => {
  it("entryOffsetはセクション長を超えないよう丸められる", () => {
    // 4小節 × 4拍 = 16拍
    useProjectStore.getState().setSectionContent("s1", { entryOffsetBeats: 999 })
    expect(useProjectStore.getState().project.sections[0].content!.entryOffsetBeats).toBe(16)

    useProjectStore.getState().setSectionContent("s1", { entryOffsetBeats: -4 })
    expect(useProjectStore.getState().project.sections[0].content!.entryOffsetBeats).toBe(0)
  })

  it("leadとaccompanimentを独立に設定できる(2軸)", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "drone", accompaniment: "none" })
    expect(useProjectStore.getState().project.sections[0].content).toMatchObject({
      lead: "drone",
      accompaniment: "none",
    })

    // 伴奏だけを付け替えてもleadは変わらない
    useProjectStore.getState().setSectionContent("s1", { accompaniment: "chords" })
    expect(useProjectStore.getState().project.sections[0].content).toMatchObject({
      lead: "drone",
      accompaniment: "chords",
    })
  })

  it("Undoで変更前のContent設定へ戻る", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "motif" })
    expect(useProjectStore.getState().project.sections[0].content!.lead).toBe("motif")
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.sections[0].content!.lead).toBe("melody")
  })
})

describe("Issue #41 / 既存生成の回帰", () => {
  it("イントロ以外のRoleでも既定のmelody生成が変わらず動く", () => {
    for (const role of ["verse", "chorus", "bridge", "outro"] as const) {
      useProjectStore.setState({
        project: {
          ...projectWithSection(),
          sections: [
            { id: "s1", name: "S", role, startBar: 1, lengthBars: 4, content: { ...DEFAULT_SECTION_CONTENT } },
          ],
        },
        history: [],
        future: [],
      })
      stubPersist()
      useProjectStore.getState().generateForSection("s1")
      const variants = useProjectStore.getState().project.melodyVariants
      expect(variants.length).toBeGreaterThan(0)
      for (const variant of variants) expect(resolvedLeadContent(variant)).toBe("melody")
    }
  })
})
