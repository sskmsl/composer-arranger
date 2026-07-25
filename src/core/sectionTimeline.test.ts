import { describe, expect, it } from "vitest"
import type { ComposerProject } from "./project"
import { buildSongPlaybackMaterial, moveSectionInTimeline, normalizeSectionTimeline } from "./sectionTimeline"

const sections = [
  { id: "a", name: "A", role: "verse" as const, startBar: 9, lengthBars: 2 },
  { id: "b", name: "B", role: "chorus" as const, startBar: 20, lengthBars: 4 },
]

describe("section timeline", () => {
  it("startBarを配列順に隙間なく再計算する", () => {
    expect(normalizeSectionTimeline(sections).map((section) => section.startBar)).toEqual([1, 3])
  })

  it("並べ替え後もstartBarを連続させる", () => {
    const moved = moveSectionInTimeline(sections, "b", 0)
    expect(moved.map((section) => section.id)).toEqual(["b", "a"])
    expect(moved.map((section) => section.startBar)).toEqual([1, 5])
  })

  it("セクション採用Variantとコードを曲全体の絶対拍へ配置する", () => {
    const project = {
      song: { timeSignature: "4/4" },
      sections: normalizeSectionTimeline(sections),
      chords: [
        { id: "ca", sectionId: "a", startBeat: 0, durationBeats: 8, symbol: "Am", bass: null },
        { id: "cb", sectionId: "b", startBeat: 0, durationBeats: 16, symbol: "F", bass: null },
      ],
      melodyVariants: [
        {
          id: "va",
          sectionId: "a",
          notes: [{ id: "n", startBeat: 1, durationBeats: 1, pitch: 60, velocity: 80, locks: [] }],
        },
        {
          id: "vb",
          sectionId: "b",
          notes: [{ id: "n", startBeat: 2, durationBeats: 1, pitch: 72, velocity: 80, locks: [] }],
        },
      ],
      sectionMelodyAssignments: { a: "va", b: "vb" },
    } as unknown as ComposerProject

    const material = buildSongPlaybackMaterial(project)
    expect(material.chords.map((chord) => chord.startBeat)).toEqual([0, 8])
    expect(material.melody.map((note) => note.startBeat)).toEqual([1, 10])
    expect(material.totalBeats).toBe(24)
  })
})
