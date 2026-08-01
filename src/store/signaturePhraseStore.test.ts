import { beforeEach, describe, expect, it } from "vitest"
import { createEmptyProject, normalizeProject } from "@/core/project"
import { parseChordInputText } from "@/core/chordInput"
import { DEFAULT_SECTION_CONTENT } from "@/core/sectionContent"
import { useProjectStore } from "./useProjectStore"

function projectWithSection() {
  const project = createEmptyProject("signature-test")
  return {
    ...project,
    sections: [
      {
        id: "s1",
        name: "Intro",
        role: "intro" as const,
        startBar: 1,
        lengthBars: 4,
        content: { ...DEFAULT_SECTION_CONTENT },
      },
    ],
    chords: parseChordInputText(
      "Am(add9) | D#dim | Fmaj7 | E7",
      "s1",
      4,
      "signature",
    ),
  }
}

beforeEach(() => {
  useProjectStore.setState({
    project: projectWithSection(),
    selectedSectionId: "s1",
    activeSignaturePhraseBatchId: null,
    activeSignaturePhraseCandidateIndex: 0,
    history: [],
    future: [],
    workflowNotice: null,
    persist: () => {},
  })
})

describe("Signature Phrase store", () => {
  it("通常PhraseやMelodyへ混ぜず専用batchへ12案保存する", () => {
    useProjectStore
      .getState()
      .generateSignaturePhrasesForSection("s1", 2)
    const state = useProjectStore.getState()
    expect(state.project.signaturePhraseCandidates).toHaveLength(12)
    expect(state.project.phraseCandidates).toHaveLength(0)
    expect(state.project.melodyVariants).toHaveLength(0)
    expect(
      new Set(
        state.project.signaturePhraseCandidates.map(
          (candidate) => candidate.batchId,
        ),
      ).size,
    ).toBe(1)
    expect(state.activeSignaturePhraseBatchId).toBe(
      state.project.signaturePhraseCandidates[0].batchId,
    )
  })

  it("候補単位の再生成で兄弟11案を保持する", () => {
    useProjectStore
      .getState()
      .generateSignaturePhrasesForSection("s1", 1)
    const before =
      useProjectStore.getState().project.signaturePhraseCandidates
    const target = before[4]
    const siblingIds = before
      .filter((candidate) => candidate.id !== target.id)
      .map((candidate) => candidate.id)

    useProjectStore.getState().regenerateSignaturePhrase(target.id)
    const after =
      useProjectStore.getState().project.signaturePhraseCandidates
    expect(after).toHaveLength(12)
    expect(after.some((candidate) => candidate.id === target.id)).toBe(false)
    expect(
      siblingIds.every((id) => after.some((candidate) => candidate.id === id)),
    ).toBe(true)
  })

  it("旧プロジェクトを読み込むと専用候補配列を補完する", () => {
    const { signaturePhraseCandidates: _removed, ...old } =
      projectWithSection()
    void _removed
    expect(normalizeProject(old).signaturePhraseCandidates).toEqual([])
  })
})
