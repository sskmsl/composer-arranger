import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import { parseChordInputText } from "@/core/chordInput"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { DEFAULT_DECORATION_SETTINGS } from "@/melody-engine/decorationGenerator"
import { useProjectStore } from "./useProjectStore"

vi.mock("@/core/rng", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/rng")>()
  return { ...actual, createSeed: () => 42 }
})

function project() {
  const project = createEmptyProject("decoration")
  project.sections = [
    { id: "a", name: "Pre", role: "pre-chorus", startBar: 1, lengthBars: 4 },
    { id: "b", name: "Chorus", role: "chorus", startBar: 5, lengthBars: 4 },
  ]
  project.chords = [
    ...parseChordInputText("Am | F | C | G", "a", 4, "a"),
    ...parseChordInputText("C | G | Am | F", "b", 4, "b"),
  ]
  return project
}

beforeEach(() => {
  useProjectStore.setState({
    project: project(),
    selectedSectionId: "a",
    activeReactiveBatchId: null,
    activeReactiveCandidateIndex: 0,
    history: [],
    future: [],
    workflowNotice: null,
    persist: () => {},
  })
})

describe("Issue #71 / Decoration store workflow", () => {
  it("Melodyなしで10候補を保存し、採用候補を曲全体再生へ含める", () => {
    useProjectStore.getState().generateDecorationsForSection("a")
    const candidates = useProjectStore.getState().project.reactiveLayerCandidates ?? []
    expect(candidates).toHaveLength(10)
    expect(useProjectStore.getState().project.melodyVariants).toHaveLength(0)
    useProjectStore.getState().assignReactiveLayer(candidates[0].id)
    expect(useProjectStore.getState().project.sectionDecorationLayerAssignments?.a).toBe(candidates[0].id)
    expect(buildSongPlaybackMaterial(useProjectStore.getState().project).reactiveLayers.length).toBeGreaterThan(0)
  })

  it("候補ごとの再生成は兄弟を保持し、採用参照も置換する", () => {
    useProjectStore.getState().generateDecorationsForSection("a")
    const before = useProjectStore.getState().project.reactiveLayerCandidates ?? []
    const target = before[3]
    const siblingIds = before.filter((candidate) => candidate.id !== target.id).map((candidate) => candidate.id)
    useProjectStore.getState().assignReactiveLayer(target.id)
    useProjectStore.getState().regenerateDecoration(target.id)
    const after = useProjectStore.getState().project.reactiveLayerCandidates ?? []
    expect(after).toHaveLength(10)
    expect(after.some((candidate) => candidate.id === target.id)).toBe(false)
    expect(siblingIds.every((id) => after.some((candidate) => candidate.id === id))).toBe(true)
    expect(useProjectStore.getState().project.sectionDecorationLayerAssignments?.a).not.toBe(target.id)
  })

  it("生成後にコード構造が変わった候補はstaleとして採用しない", () => {
    useProjectStore.getState().generateDecorationsForSection("a", DEFAULT_DECORATION_SETTINGS)
    const target = useProjectStore.getState().project.reactiveLayerCandidates?.[0]
    useProjectStore.getState().setChordText("a", "Dm | Bb | F | C")
    useProjectStore.getState().assignReactiveLayer(target!.id)
    expect(useProjectStore.getState().project.sectionDecorationLayerAssignments?.a).toBeUndefined()
    expect(useProjectStore.getState().workflowNotice).toContain("再生成")
  })

  it("採用後に構造が変わったDecorationは曲全体再生へ混入しない", () => {
    useProjectStore.getState().generateDecorationsForSection("a")
    const target = useProjectStore.getState().project.reactiveLayerCandidates?.[0]
    useProjectStore.getState().assignReactiveLayer(target!.id)
    expect(buildSongPlaybackMaterial(useProjectStore.getState().project).reactiveLayers.length).toBeGreaterThan(0)
    useProjectStore.getState().setChordText("a", "Dm | Bb | F | C")
    expect(buildSongPlaybackMaterial(useProjectStore.getState().project).reactiveLayers).toHaveLength(0)
  })

  it("DecorationとCounterは別の採用枠を持つ", () => {
    useProjectStore.getState().generateDecorationsForSection("a")
    const decoration = useProjectStore.getState().project.reactiveLayerCandidates?.[0]
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        sectionReactiveLayerAssignments: { a: "counter-id" },
      },
    }))
    useProjectStore.getState().assignReactiveLayer(decoration!.id)
    const state = useProjectStore.getState().project
    expect(state.sectionReactiveLayerAssignments?.a).toBe("counter-id")
    expect(state.sectionDecorationLayerAssignments?.a).toBe(decoration?.id)
  })

  it("採用済みCounterと長時間衝突するDecorationは同時採用しない", () => {
    useProjectStore.getState().generateDecorationsForSection("a")
    const decoration =
      useProjectStore.getState().project.reactiveLayerCandidates?.[0]
    expect(decoration).toBeDefined()
    if (!decoration) throw new Error("Decoration candidate was not generated")
    const counter = {
      ...structuredClone(decoration),
      id: "counter-conflict",
      kind: "counter" as const,
      role: "answer-phrase" as const,
      targetMelodyVariantId: null,
      decorationPlan: undefined,
      structureFingerprint: undefined,
      notes: decoration.notes.map((note) => ({
        ...note,
        id: `counter-${note.id}`,
      })),
    }
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        reactiveLayerCandidates: [
          ...(state.project.reactiveLayerCandidates ?? []),
          counter,
        ],
        sectionReactiveLayerAssignments: { a: counter.id },
      },
    }))
    useProjectStore.getState().assignReactiveLayer(decoration.id)
    expect(useProjectStore.getState().project.sectionDecorationLayerAssignments?.a).toBeUndefined()
    expect(useProjectStore.getState().workflowNotice).toContain("採用できません")
  })
})
