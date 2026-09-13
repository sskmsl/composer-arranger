import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { Section } from "@/core/section"
import { parseArrangementStructureChanges } from "./structureChanges"

const sections: Section[] = [
  { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
  { id: "verse-1", name: "Verse 1", role: "verse", startBar: 5, lengthBars: 8 },
  { id: "chorus-1", name: "Chorus 1", role: "chorus", startBar: 13, lengthBars: 8 },
  { id: "interlude", name: "Instrumental", role: "instrumental", startBar: 21, lengthBars: 4 },
  { id: "chorus-2", name: "Chorus 2", role: "chorus", startBar: 25, lengthBars: 8 },
  { id: "outro", name: "Outro", role: "outro", startBar: 33, lengthBars: 4 },
]

function project() {
  return { ...createEmptyProject("structure"), sections }
}

describe("arrangement structure changes", () => {
  it("曲固有の名前と役割名から尺変更・削除・繰り返しを解決する", () => {
    expect(parseArrangementStructureChanges(
      project(),
      "イントロを8小節に。Instrumentalを削除。最後のサビをもう1回繰り返す",
    )).toEqual([
      { kind: "resize-section", sectionId: "intro", sectionName: "Intro", lengthBars: 8 },
      { kind: "remove-section", sectionId: "interlude", sectionName: "Instrumental" },
      { kind: "duplicate-section", sectionId: "chorus-2", sectionName: "Chorus 2", copies: 1 },
    ])
  })

  it("指示文に書かれた順で移動元と移動先を判定する", () => {
    expect(parseArrangementStructureChanges(
      project(),
      "間奏をChorus 1の後へ移動",
    )).toEqual([
      {
        kind: "move-section",
        sectionId: "interlude",
        sectionName: "Instrumental",
        anchorSectionId: "chorus-1",
        anchorSectionName: "Chorus 1",
        position: "after",
      },
    ])
  })

  it("2番を、2回目のAメロから次のサビまでとして扱う", () => {
    const input = project()
    input.sections = [
      ...input.sections.slice(0, 3),
      { id: "verse-2", name: "Verse 2", role: "verse", startBar: 21, lengthBars: 8 },
      { id: "pre-2", name: "Pre 2", role: "pre-chorus", startBar: 29, lengthBars: 4 },
      { id: "chorus-2b", name: "Chorus 2", role: "chorus", startBar: 33, lengthBars: 8 },
      { id: "bridge", name: "Bridge", role: "bridge", startBar: 41, lengthBars: 8 },
    ]
    expect(parseArrangementStructureChanges(input, "2番を削除")).toEqual([
      { kind: "remove-section", sectionId: "verse-2", sectionName: "Verse 2" },
      { kind: "remove-section", sectionId: "pre-2", sectionName: "Pre 2" },
      { kind: "remove-section", sectionId: "chorus-2b", sectionName: "Chorus 2" },
    ])
  })
})
