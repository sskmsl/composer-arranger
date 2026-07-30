import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyVariant } from "@/core/melody"
import { useProjectStore } from "./useProjectStore"

vi.mock("@/core/rng", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/rng")>()
  return { ...actual, createSeed: () => 42 }
})

function activeMelody(): MelodyVariant {
  return {
    id: "melody-a",
    name: "Active",
    sectionId: "s1",
    sourceMode: "generate",
    notes: Array.from({ length: 8 }, (_, index) => ({
      id: `m${index}`,
      startBeat: index * 2,
      durationBeats: 1,
      pitch: 64 + (index % 4),
      velocity: 80,
      locks: [],
    })),
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "melody-batch",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function project() {
  const project = createEmptyProject("counter")
  project.sections = [
    { id: "s1", name: "Verse", role: "verse", startBar: 1, lengthBars: 4 },
  ]
  project.chords = parseChordInputText("Am | F | C | G", "s1", 4, "c")
  project.melodyVariants = [activeMelody()]
  project.sectionMelodyAssignments = { s1: "melody-a" }
  return project
}

beforeEach(() => {
  const generationSettings =
    useProjectStore.getState().generationSettings
  useProjectStore.setState({
    project: project(),
    selectedSectionId: "s1",
    activeReactiveBatchId: null,
    activeReactiveCandidateIndex: 0,
    history: [],
    future: [],
    workflowNotice: null,
    generationSettings: {
      ...generationSettings,
      techniqueExperimentPresetId: null,
    },
    persist: () => {},
  })
})

describe("Issue #70 / Counter store workflow", () => {
  it("CounterをMelody Variantとは別領域へ3案保存する", () => {
    useProjectStore.getState().generateCounterForSection("s1")
    const state = useProjectStore.getState()
    expect(state.project.reactiveLayerCandidates).toHaveLength(3)
    expect(state.project.melodyVariants).toHaveLength(1)
    expect(new Set(state.project.reactiveLayerCandidates?.map((item) => item.batchId)).size).toBe(1)
    expect(state.activeReactiveBatchId).toBe(state.project.reactiveLayerCandidates?.[0].batchId)
  })

  it("候補を採用し、対象だけ再生成して採用参照も置換する", () => {
    useProjectStore.getState().generateCounterForSection("s1")
    const candidates = useProjectStore.getState().project.reactiveLayerCandidates ?? []
    const target = candidates[1]
    useProjectStore.getState().assignReactiveLayer(target.id)
    expect(useProjectStore.getState().project.sectionReactiveLayerAssignments?.s1).toBe(target.id)

    useProjectStore.getState().regenerateCounter(target.id)
    const after = useProjectStore.getState().project.reactiveLayerCandidates ?? []
    expect(after).toHaveLength(3)
    expect(after.some((candidate) => candidate.id === target.id)).toBe(false)
    expect(useProjectStore.getState().project.sectionReactiveLayerAssignments?.s1).not.toBe(target.id)
  })

  it("Active Melodyなしでは生成せず理由を通知する", () => {
    useProjectStore.setState((state) => ({
      project: { ...state.project, sectionMelodyAssignments: {} },
    }))
    useProjectStore.getState().generateCounterForSection("s1")
    expect(useProjectStore.getState().project.reactiveLayerCandidates).toHaveLength(0)
    expect(useProjectStore.getState().workflowNotice).toContain("Active Melody")
  })

  it("Technique実験ではNormal 3案とTreatment 3案を同じbatchへ保存する", () => {
    useProjectStore.getState().setGenerationSettings({
      techniqueExperimentPresetId:
        "stable-loop-local-mutation",
    })
    useProjectStore.getState().generateCounterForSection("s1")
    const candidates =
      useProjectStore.getState().project.reactiveLayerCandidates ??
      []
    expect(candidates).toHaveLength(6)
    expect(
      candidates.filter(
        (candidate) =>
          candidate.techniqueExperiment?.mode === "baseline",
      ),
    ).toHaveLength(3)
    const treatment = candidates.filter(
      (candidate) =>
        candidate.techniqueExperiment?.mode === "treatment",
    )
    expect(treatment).toHaveLength(3)
    expect(
      treatment.every(
        (candidate) =>
          candidate.techniqueFitScore !== undefined,
      ),
    ).toBe(true)
    const target = treatment[0]
    useProjectStore.getState().regenerateCounter(target.id)
    const replacement = useProjectStore
      .getState()
      .project.reactiveLayerCandidates?.find(
        (candidate) => candidate.name === target.name,
      )
    expect(replacement?.techniqueExperiment).toEqual(
      target.techniqueExperiment,
    )
  })
})
