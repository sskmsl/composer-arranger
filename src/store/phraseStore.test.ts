import { beforeEach, describe, expect, it } from "vitest"
import { createEmptyProject, normalizeProject } from "@/core/project"
import { parseChordInputText } from "@/core/chordInput"
import { DEFAULT_SECTION_CONTENT } from "@/core/sectionContent"
import { useProjectStore } from "./useProjectStore"

function projectWithSection() {
  const project = createEmptyProject("phrase-test")
  return {
    ...project,
    sections: [
      {
        id: "s1",
        name: "Verse",
        role: "verse" as const,
        startBar: 1,
        lengthBars: 4,
        content: { ...DEFAULT_SECTION_CONTENT },
      },
    ],
    chords: parseChordInputText("Am(add9) | D#dim | Fmaj7 | E7", "s1", 4, "c"),
  }
}

beforeEach(() => {
  const generationSettings =
    useProjectStore.getState().generationSettings
  useProjectStore.setState({
    project: projectWithSection(),
    selectedSectionId: "s1",
    activePhraseBatchId: null,
    activePhraseCandidateIndex: 0,
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

describe("Phrase Candidate store", () => {
  it("Melody Variantへ混ぜず、専用候補を同一batchで3案保存する", () => {
    useProjectStore.getState().generatePhrasesForSection("s1", 3)
    const state = useProjectStore.getState()
    expect(state.project.phraseCandidates).toHaveLength(3)
    expect(state.project.melodyVariants).toHaveLength(0)
    expect(new Set(state.project.phraseCandidates.map((candidate) => candidate.batchId)).size).toBe(1)
    expect(state.project.phraseCandidates.every((candidate) => candidate.intent.lengthBars === 3)).toBe(true)
    expect(state.activePhraseBatchId).toBe(state.project.phraseCandidates[0].batchId)
  })

  it("候補ごとの再生成は兄弟候補を保持して対象だけ置換する", () => {
    useProjectStore.getState().generatePhrasesForSection("s1", 2)
    const before = useProjectStore.getState().project.phraseCandidates
    const target = before[1]
    const siblings = before.filter((candidate) => candidate.id !== target.id)

    useProjectStore.getState().regeneratePhrase(target.id)
    const after = useProjectStore.getState().project.phraseCandidates
    expect(after).toHaveLength(3)
    expect(after.find((candidate) => candidate.id === target.id)).toBeUndefined()
    for (const sibling of siblings) {
      expect(after.find((candidate) => candidate.id === sibling.id)).toEqual(sibling)
    }
  })

  it("Technique実験では同じseed条件のNormal 3案とTreatment 3案を保存する", () => {
    useProjectStore.getState().setGenerationSettings({
      techniqueExperimentPresetId:
        "stable-loop-local-mutation",
    })
    useProjectStore.getState().generatePhrasesForSection("s1", 4)
    const candidates =
      useProjectStore.getState().project.phraseCandidates
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
          candidate.techniqueFitScore !== undefined &&
          candidate.intent.developmentStrategy !== undefined,
      ),
    ).toBe(true)
    expect(new Set(candidates.map((candidate) => candidate.batchId)).size)
      .toBe(1)

    const target = treatment[0]
    useProjectStore.getState().regeneratePhrase(target.id)
    const replacement = useProjectStore
      .getState()
      .project.phraseCandidates.find(
        (candidate) => candidate.name === target.name,
      )
    expect(replacement?.techniqueExperiment).toEqual(
      target.techniqueExperiment,
    )
    expect(replacement?.techniqueFitScore).toBeDefined()
  })

  it("8小節セクションでは5〜8小節の長さを保存できる", () => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        sections: state.project.sections.map((section) => ({ ...section, lengthBars: 8 })),
        chords: parseChordInputText(
          "Am(add9) | D#dim | Fmaj7 | E7 | Am(add9) | D#dim | Fmaj7 | E7",
          "s1",
          4,
          "long",
        ),
      },
    }))
    useProjectStore.getState().generatePhrasesForSection("s1", 8)
    const candidates = useProjectStore.getState().project.phraseCandidates
    expect(candidates).toHaveLength(3)
    expect(candidates.every((candidate) => candidate.intent.lengthBars === 8)).toBe(true)
    expect(candidates.every((candidate) => candidate.phraseLengthBeats === 32)).toBe(true)
  })

  it("2小節未満またはコードなしでは生成せず理由を通知する", () => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        sections: state.project.sections.map((section) => ({ ...section, lengthBars: 1 })),
      },
    }))
    useProjectStore.getState().generatePhrasesForSection("s1")
    expect(useProjectStore.getState().project.phraseCandidates).toHaveLength(0)
    expect(useProjectStore.getState().workflowNotice).toContain("2小節以上")
  })

  it("旧プロジェクトの読み込みではphraseCandidatesを空配列で補完する", () => {
    const { phraseCandidates: _removed, ...old } = projectWithSection()
    void _removed
    expect(normalizeProject(old).phraseCandidates).toEqual([])
  })
})
