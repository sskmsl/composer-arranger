import { beforeEach, describe, expect, it, vi } from "vitest"
import { useProjectStore } from "./useProjectStore"
import { createEmptyProject } from "@/core/project"
import { DEFAULT_SECTION_CONTENT, notesBeforeEntryOffset } from "@/core/sectionContent"
import { notesByPartRole, resolvedLeadContent } from "@/core/sectionLayers"
import type { ComposerProject } from "@/core/project"
import { parseChordInputText } from "@/core/chordInput"

vi.mock("@/core/rng", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/rng")>()
  return {
    ...actual,
    createSeed: () => 246_813_579,
  }
})

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
  const settings = useProjectStore.getState().generationSettings
  useProjectStore.setState({
    project: projectWithSection(),
    selectedSectionId: "s1",
    activeBatchId: null,
    activeCandidateIndex: 0,
    history: [],
    future: [],
    workflowNotice: null,
    generationSettings: {
      ...settings,
      selectedGeneratorProfiles: ["standard"],
      techniqueExperimentPresetId: null,
    },
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

  it("Technique実験では同じbase seedのNormal 3案とTreatment 3案を生成する", () => {
    useProjectStore.getState().setGenerationSettings({
      techniqueExperimentPresetId: "space-microvariation",
    })
    useProjectStore.getState().generateForSection("s1")
    const variants =
      useProjectStore.getState().project.melodyVariants
    expect(variants).toHaveLength(6)
    expect(
      variants.filter(
        (variant) =>
          variant.techniqueExperiment?.mode === "baseline",
      ),
    ).toHaveLength(3)
    const treatment = variants.filter(
      (variant) =>
        variant.techniqueExperiment?.mode === "treatment",
    )
    expect(treatment).toHaveLength(3)
    expect(
      treatment.every(
        (variant) =>
          variant.generationDiagnostics?.techniqueFitScore !==
          undefined,
      ),
    ).toBe(true)
    expect(
      new Set(
        variants.map(
          (variant) =>
            variant.generationDiagnostics?.batchBaseSeed,
        ),
      ).size,
    ).toBe(1)
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

  it("Autoでは品質下限を満たす3候補に2種類以上のContentが現れ、Accompaniment割り当てを壊さない", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "auto" })
    useProjectStore.getState().setSectionAccompanimentPattern("s1", "arpeggio-up")
    useProjectStore.getState().generateForSection("s1")
    const variants = useProjectStore.getState().project.melodyVariants
    expect(variants).toHaveLength(3)
    expect(new Set(variants.map((v) => resolvedLeadContent(v))).size).toBeGreaterThanOrEqual(2)
    expect(variants.every((variant) => variant.contentQuality)).toBe(true)
    expect(
      variants.every(
        (variant) =>
          (variant.contentQuality?.overallQuality ?? 0) >=
          (variant.contentSelection?.qualityFloor ?? 101),
      ),
    ).toBe(true)
    expect(useProjectStore.getState().project.sectionAccompanimentPatternAssignments.s1).toBe("arpeggio-up")
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

    const generated = useProjectStore.getState().project.melodyVariants.slice(before)
    expect(generated.length).toBeGreaterThan(0)
    for (const variant of generated) {
      expect(notesByPartRole(variant, "lead").map((note) => note.id)).toEqual(
        variant.notes.map((note) => note.id),
      )
      expect(notesByPartRole(variant, "lead").map((note) => note.pitch)).toEqual(
        variant.notes.map((note) => note.pitch),
      )
    }
  })
})

describe("Melody実音 / variant.notesとLayerの同期", () => {
  it("ピアノロールの音程編集を曲全体再生・MIDI参照Layerへ反映する", () => {
    useProjectStore.getState().generateForSection("s1")
    const source = useProjectStore.getState().project.melodyVariants[0]
    const targetNote = source.notes[0]

    useProjectStore.getState().updateNote(source.id, targetNote.id, { pitch: targetNote.pitch + 2 })

    const updated = useProjectStore.getState().project.melodyVariants.find((variant) => variant.id === source.id)!
    expect(updated.notes.find((note) => note.id === targetNote.id)?.pitch).toBe(targetNote.pitch + 2)
    expect(notesByPartRole(updated, "lead").find((note) => note.id === targetNote.id)?.pitch).toBe(
      targetNote.pitch + 2,
    )
  })

  it("ノート削除とLock変更もLayerへ同期する", () => {
    useProjectStore.getState().generateForSection("s1")
    const source = useProjectStore.getState().project.melodyVariants[0]
    const lockedNote = source.notes[0]
    const deletedNote = source.notes[1]

    useProjectStore.getState().toggleNoteLock(source.id, lockedNote.id, "pitch")
    useProjectStore.getState().deleteNote(source.id, deletedNote.id)

    const updated = useProjectStore.getState().project.melodyVariants.find((variant) => variant.id === source.id)!
    expect(notesByPartRole(updated, "lead").find((note) => note.id === lockedNote.id)?.locks).toContain("pitch")
    expect(notesByPartRole(updated, "lead").some((note) => note.id === deletedNote.id)).toBe(false)
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

describe("PR#43 fix3 / Melodyにも entryOffset / pickup が効く", () => {
  it("Melody + entryOffset で、指定区間へノートが入らない", () => {
    // 4小節 × 4拍 = 16拍。前半8拍(2小節)を無音にする
    useProjectStore.getState().setSectionContent("s1", { lead: "melody", entryOffsetBeats: 8 })
    useProjectStore.getState().generateForSection("s1")

    const variants = useProjectStore.getState().project.melodyVariants
    expect(variants.length).toBeGreaterThan(0)
    for (const variant of variants) {
      expect(resolvedLeadContent(variant)).toBe("melody")
      // ここが修正前の不具合(melodyはcontent pipelineを迂回するのでentryOffsetが無視されていた)
      expect(notesBeforeEntryOffset(variant.notes, 8)).toHaveLength(0)
      expect(variant.notes.length).toBeGreaterThan(0)
      // セクション終端も超えない
      for (const note of variant.notes) expect(note.startBeat + note.durationBeats).toBeLessThanOrEqual(16 + 1e-6)
    }
  })

  it("Melody + pickup で弱起Layerが作られる", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "melody", pickup: true })
    useProjectStore.getState().generateForSection("s1")

    const variants = useProjectStore.getState().project.melodyVariants
    const pickupLayers = variants.flatMap((v) => (v.layers ?? []).filter((l) => l.kind === "pickup"))
    expect(pickupLayers.length).toBeGreaterThan(0)
    for (const layer of pickupLayers) {
      expect(layer.partRole).toBe("lead")
      // 弱起はセクション末尾側(最後の1拍)にある
      for (const note of layer.notes) expect(note.startBeat).toBeGreaterThanOrEqual(15 - 1e-6)
    }
  })

  it("Melodyでもlayersが作られ、partRoleはlead", () => {
    useProjectStore.getState().generateForSection("s1")
    for (const variant of useProjectStore.getState().project.melodyVariants) {
      expect(variant.layers?.length).toBeGreaterThan(0)
      expect(variant.layers![0].partRole).toBe("lead")
      expect(variant.layers![0].content).toBe("melody")
      // notes と primary Layer の実音が一致している
      expect(variant.layers![0].notes.length).toBeGreaterThan(0)
    }
  })

  it("entryOffsetがセクション終端に達している場合は理由を通知して生成しない", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "melody", entryOffsetBeats: 16 })
    const before = useProjectStore.getState().project.melodyVariants.length
    useProjectStore.getState().generateForSection("s1")
    expect(useProjectStore.getState().project.melodyVariants).toHaveLength(before)
    expect(useProjectStore.getState().workflowNotice).toContain("リード開始位置")
  })

  it("entryOffset/pickup未指定なら従来どおりGenerator Profile候補が出る(回帰)", () => {
    useProjectStore.getState().generateForSection("s1")
    const variants = useProjectStore.getState().project.melodyVariants
    expect(variants.length).toBeGreaterThan(0)
    for (const variant of variants) {
      expect(variant.generatorProfile).toBeDefined()
      expect(variant.patternIndex).toBeDefined()
      // 全長で生成されるので先頭付近から鳴る
      expect(Math.min(...variant.notes.map((n) => n.startBeat))).toBeLessThan(8)
    }
  })
})

describe("PR#43 fix4 / 構造検証を満たせない場合はUIへ通知する", () => {
  it("Motifが成立しない設定では workflowNotice に理由が入る", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "motif", entryOffsetBeats: 15 })
    useProjectStore.getState().generateForSection("s1")
    expect(useProjectStore.getState().workflowNotice).toContain("成立していません")
  })

  it("成立する設定では通知が出ない", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "motif" })
    useProjectStore.getState().generateForSection("s1")
    expect(useProjectStore.getState().workflowNotice).toBeNull()
  })
})

describe("PR#43 自己レビュー分 / 窓シフトでPhrasePlanの拍位置が一貫している", () => {
  it("entryOffset適用時、phrasePlansの拍位置(restBeats含む)がすべてセクション相対へ揃う", () => {
    useProjectStore.getState().setSectionContent("s1", { lead: "melody", entryOffsetBeats: 8 })
    useProjectStore.getState().generateForSection("s1")

    for (const variant of useProjectStore.getState().project.melodyVariants) {
      for (const plan of variant.phrasePlans) {
        expect(plan.phraseStartBeat).toBeGreaterThanOrEqual(8 - 1e-6)
        expect(plan.climaxBeat).toBeGreaterThanOrEqual(8 - 1e-6)
        // restBeats も絶対拍位置なので、ずらし忘れると窓より前を指してしまう
        for (const beat of plan.restBeats) {
          expect(beat).toBeGreaterThanOrEqual(8 - 1e-6)
          expect(beat).toBeLessThanOrEqual(16 + 1e-6)
        }
      }
    }
  })
})

describe("セクション複製 / Active Melodyの継承", () => {
  it("Set as Active Melody済みの実音・Layer・計画を独立Variantとして複製する", () => {
    useProjectStore.getState().generateForSection("s1")
    const source = useProjectStore.getState().project.melodyVariants[0]
    useProjectStore.getState().setActiveMelody(source.id)
    useProjectStore.getState().setSectionAccompanimentPattern("s1", "arpeggio-up")
    const variantCountBefore = useProjectStore.getState().project.melodyVariants.length

    useProjectStore.getState().duplicateSection("s1")

    const state = useProjectStore.getState()
    const duplicatedSectionId = state.selectedSectionId!
    const duplicatedVariantId = state.project.sectionMelodyAssignments[duplicatedSectionId]
    const duplicated = state.project.melodyVariants.find((variant) => variant.id === duplicatedVariantId)!

    expect(duplicated).toBeDefined()
    expect(state.project.melodyVariants).toHaveLength(variantCountBefore + 1)
    expect(state.project.activeMelodyId).toBe(duplicated.id)
    expect(duplicated.id).not.toBe(source.id)
    expect(duplicated.sectionId).toBe(duplicatedSectionId)
    expect(duplicated.parentMelodyId).toBe(source.id)
    expect(duplicated.batchId).not.toBe(source.batchId)
    expect(state.project.sectionAccompanimentPatternAssignments[duplicatedSectionId]).toBe("arpeggio-up")
    expect(duplicated.notes.map(({ id: _id, ...note }) => note)).toEqual(
      source.notes.map(({ id: _id, ...note }) => note),
    )
    expect(duplicated.notes.map((note) => note.id)).not.toEqual(source.notes.map((note) => note.id))
    expect(duplicated.layers?.map((layer) => ({
      ...layer,
      id: undefined,
      notes: layer.notes.map(({ id: _id, ...note }) => note),
    }))).toEqual(source.layers?.map((layer) => ({
      ...layer,
      id: undefined,
      notes: layer.notes.map(({ id: _id, ...note }) => note),
    })))
  })

  it("Active Melody未設定なら候補を複製せず、セクションとコードだけを複製する", () => {
    useProjectStore.getState().generateForSection("s1")
    const variantCountBefore = useProjectStore.getState().project.melodyVariants.length

    useProjectStore.getState().duplicateSection("s1")

    const state = useProjectStore.getState()
    const duplicatedSectionId = state.selectedSectionId!
    expect(state.project.melodyVariants).toHaveLength(variantCountBefore)
    expect(state.project.sectionMelodyAssignments[duplicatedSectionId]).toBeUndefined()
    expect(state.project.chords.filter((chord) => chord.sectionId === duplicatedSectionId)).toHaveLength(4)
  })
})

describe("Issue #45 / セクション別Accompaniment Pattern割り当て", () => {
  it("テンプレートを割り当て・解除でき、Undo/Redoにも含まれる", () => {
    expect(useProjectStore.getState().project.accompanimentPatterns.length).toBeGreaterThan(0)

    useProjectStore.getState().setSectionAccompanimentPattern("s1", "broken-ninth")
    expect(useProjectStore.getState().project.sectionAccompanimentPatternAssignments.s1).toBe("broken-ninth")

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.sectionAccompanimentPatternAssignments.s1).toBeUndefined()
    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.sectionAccompanimentPatternAssignments.s1).toBe("broken-ninth")

    useProjectStore.getState().setSectionAccompanimentPattern("s1", null)
    expect(useProjectStore.getState().project.sectionAccompanimentPatternAssignments.s1).toBeUndefined()
  })

  it("存在しないテンプレートは割り当てず、セクション削除時に割り当ても除去する", () => {
    useProjectStore.getState().setSectionAccompanimentPattern("s1", "missing")
    expect(useProjectStore.getState().project.sectionAccompanimentPatternAssignments.s1).toBeUndefined()

    useProjectStore.getState().setSectionAccompanimentPattern("s1", "syncopated")
    useProjectStore.getState().removeSection("s1")
    expect(useProjectStore.getState().project.sectionAccompanimentPatternAssignments.s1).toBeUndefined()
  })
})

describe("AI Partner / Performance Execution Bridge", () => {
  it("直前のMelody候補全体へ強弱と奏法を反映し、PitchとLayer同期を守る", () => {
    useProjectStore.getState().generateForSection("s1")
    const before = useProjectStore.getState().project.melodyVariants.map((variant) => ({
      id: variant.id,
      pitches: variant.notes.map((note) => note.pitch),
    }))

    useProjectStore.getState().applyPerformanceToLatestGeneration("s1", "melody", {
      role: "lead-focus",
      velocityRange: [52, 68],
      articulation: "detached",
      timing: "strict",
    })

    const state = useProjectStore.getState()
    for (const variant of state.project.melodyVariants) {
      expect(variant.notes.map((note) => note.pitch)).toEqual(
        before.find((candidate) => candidate.id === variant.id)?.pitches,
      )
      expect(variant.notes.every((note) => note.velocity >= 52 && note.velocity <= 68)).toBe(true)
      expect(notesByPartRole(variant, "lead")).toEqual(variant.notes)
      expect(state.project.candidatePerformanceReviews?.[variant.id]?.status)
        .toMatch(/strong|watch/)
    }
    expect(state.project.sectionPerformancePlans?.s1?.["lead-focus"]?.articulation)
      .toBe("detached")
    const batchId = state.activeBatchId!
    const recommendation = state.project.performanceBatchRecommendations?.[batchId]
    expect(recommendation?.candidateId).toBeTruthy()
    expect(
      state.project.candidatePerformanceReviews?.[recommendation!.candidateId!]?.status,
    ).not.toBe("revise")

    const recommendedVariant = state.project.melodyVariants.find(
      (candidate) => candidate.id === recommendation!.candidateId,
    )!
    useProjectStore.getState().updateNote(
      recommendedVariant.id,
      recommendedVariant.notes[0].id,
      { velocity: 50 },
    )
    expect(useProjectStore.getState().project.performanceBatchRecommendations?.[batchId])
      .toBeUndefined()
    expect(useProjectStore.getState().project.candidatePerformanceReviews?.[recommendedVariant.id])
      .toBeUndefined()
  })

  it("伴奏Performance Planはセクション複製で継承し、削除時に除去する", () => {
    useProjectStore.getState().applyPerformanceToLatestGeneration("s1", "accompaniment", {
      role: "pulse-foundation",
      velocityRange: [44, 62],
      articulation: "pulsed",
      timing: "slightly-behind",
    })
    useProjectStore.getState().duplicateSection("s1")
    const copiedId = useProjectStore.getState().selectedSectionId!
    expect(useProjectStore.getState().project.sectionPerformancePlans?.[copiedId])
      .toEqual(useProjectStore.getState().project.sectionPerformancePlans?.s1)

    useProjectStore.getState().removeSection(copiedId)
    expect(useProjectStore.getState().project.sectionPerformancePlans?.[copiedId]).toBeUndefined()
  })
})

describe("Arrangement Director Override", () => {
  it("Climax・Energy・密度の固定値を保存し、Autoへ戻せる", () => {
    useProjectStore.getState().setArrangementDirectorClimax("s1")
    useProjectStore.getState().setArrangementDirectorSectionOverride("s1", {
      targetEnergy: 3,
      densityCeiling: 2,
    })
    expect(useProjectStore.getState().project.arrangementDirectorOverrides).toEqual({
      climaxSectionId: "s1",
      sections: { s1: { targetEnergy: 3, densityCeiling: 2 } },
    })

    useProjectStore.getState().setArrangementDirectorClimax(null)
    useProjectStore.getState().setArrangementDirectorSectionOverride("s1", {
      targetEnergy: null,
      densityCeiling: null,
    })
    expect(useProjectStore.getState().project.arrangementDirectorOverrides).toEqual({ sections: {} })
  })

  it("Section複製では局所固定値を継承し、削除時はClimax指定も除去する", () => {
    useProjectStore.getState().setArrangementDirectorClimax("s1")
    useProjectStore.getState().setArrangementDirectorSectionOverride("s1", {
      targetEnergy: 2,
      densityCeiling: 2,
    })
    useProjectStore.getState().duplicateSection("s1")
    const copiedId = useProjectStore.getState().selectedSectionId!
    expect(useProjectStore.getState().project.arrangementDirectorOverrides?.sections[copiedId])
      .toEqual({ targetEnergy: 2, densityCeiling: 2 })

    useProjectStore.getState().removeSection("s1")
    expect(useProjectStore.getState().project.arrangementDirectorOverrides?.climaxSectionId)
      .toBeUndefined()
  })

  it("Role別Orchestration固定値を保存・解除でき、Section複製へ継承する", () => {
    useProjectStore.getState().setSectionOrchestrationOverride("s1", "lead-focus", {
      family: "analog-synth",
      articulation: "detached",
      dynamic: "mp",
    })
    expect(useProjectStore.getState().project.sectionOrchestrationOverrides?.s1?.["lead-focus"])
      .toEqual({ family: "analog-synth", articulation: "detached", dynamic: "mp" })

    useProjectStore.getState().duplicateSection("s1")
    const copiedId = useProjectStore.getState().selectedSectionId!
    expect(useProjectStore.getState().project.sectionOrchestrationOverrides?.[copiedId]?.["lead-focus"])
      .toEqual({ family: "analog-synth", articulation: "detached", dynamic: "mp" })

    useProjectStore.getState().setSectionOrchestrationOverride(copiedId, "lead-focus", {
      articulation: null,
    })
    expect(useProjectStore.getState().project.sectionOrchestrationOverrides?.[copiedId]?.["lead-focus"])
      .toEqual({ family: "analog-synth", dynamic: "mp" })
    useProjectStore.getState().setSectionOrchestrationOverride(copiedId, "lead-focus", null)
    expect(useProjectStore.getState().project.sectionOrchestrationOverrides?.[copiedId])
      .toBeUndefined()
  })
})

describe("Arrangement Director Workspace", () => {
  it("全曲Briefと選択Directionをプロジェクトへ保持する", () => {
    useProjectStore.getState().setArrangementDirectorWorkspace({
      brief: "主旋律を守り、余白からサビへ段階的に開く",
      selectedDirectionId: "controlled-escalation",
    })
    expect(useProjectStore.getState().project.arrangementDirectorWorkspace).toEqual({
      brief: "主旋律を守り、余白からサビへ段階的に開く",
      selectedDirectionId: "controlled-escalation",
    })
  })
})
