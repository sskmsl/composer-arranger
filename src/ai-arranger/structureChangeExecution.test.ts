import { beforeEach, describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import { useProjectStore } from "@/store/useProjectStore"
import { executeArrangementStructureChanges } from "./structureChangeExecution"

beforeEach(() => {
  const base = createEmptyProject("form")
  useProjectStore.setState({
    project: {
      ...base,
      sections: [
        { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 2 },
        { id: "chorus", name: "Chorus", role: "chorus", startBar: 3, lengthBars: 2 },
      ],
      importedArrangement: {
        version: "1.0.0",
        sourceKind: "external-song",
        totalBeats: 16,
        tracks: [{
          sourceTrackIndex: 0,
          name: "Melody",
          role: "melody",
          notes: [
            [0, 1, 60, 90, 0],
            [8, 1, 67, 90, 0],
          ],
        }],
      },
    },
    selectedSectionId: "intro",
    history: [],
    future: [],
    persist: () => {},
  } as never)
})

describe("execute arrangement structure changes", () => {
  it("繰り返したSectionへImported MIDIの実音も複製し、Undo履歴を一つにまとめる", () => {
    const changes = [{
      kind: "duplicate-section" as const,
      sectionId: "chorus",
      sectionName: "Chorus",
      copies: 1,
    }]
    const result = executeArrangementStructureChanges(changes)
    const state = useProjectStore.getState()

    expect(result.skipped).toBe(false)
    expect(state.project.sections).toHaveLength(3)
    expect(state.project.sections.map((section) => section.startBar)).toEqual([1, 3, 5])
    expect(state.project.importedArrangement?.totalBeats).toBe(24)
    expect(state.project.importedArrangement?.tracks[0].notes.map((note) => note[0])).toEqual([0, 8, 16])
    expect(state.history).toHaveLength(1)
  })

  it("同じ構成変更を同じ案から再実行しない", () => {
    const changes = [{
      kind: "duplicate-section" as const,
      sectionId: "chorus",
      sectionName: "Chorus",
      copies: 1,
    }]
    executeArrangementStructureChanges(changes)
    const repeated = executeArrangementStructureChanges(changes, changes)
    expect(repeated.skipped).toBe(true)
    expect(useProjectStore.getState().project.sections).toHaveLength(3)
  })

  it("尺と順番の変更に合わせてImported MIDIを切り詰めて再配置する", () => {
    executeArrangementStructureChanges([
      {
        kind: "resize-section",
        sectionId: "intro",
        sectionName: "Intro",
        lengthBars: 1,
      },
      {
        kind: "move-section",
        sectionId: "chorus",
        sectionName: "Chorus",
        anchorSectionId: "intro",
        anchorSectionName: "Intro",
        position: "before",
      },
    ])
    const project = useProjectStore.getState().project
    expect(project.sections.map((section) => [section.id, section.startBar, section.lengthBars])).toEqual([
      ["chorus", 1, 2],
      ["intro", 3, 1],
    ])
    expect(project.importedArrangement?.totalBeats).toBe(12)
    expect(project.importedArrangement?.tracks[0].notes).toEqual([
      [0, 1, 67, 90, 0],
      [8, 1, 60, 90, 0],
    ])
    expect(useProjectStore.getState().history).toHaveLength(1)
  })
})
