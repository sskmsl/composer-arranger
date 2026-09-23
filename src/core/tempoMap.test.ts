import { describe, expect, it } from "vitest"
import { createEmptyProject } from "./project"
import { createTempoMap, scaleSectionTempoChanges, sectionTempoChanges, songTempoChanges } from "./tempoMap"

describe("テンポの変化の換算", () => {
  it("一定テンポなら拍×60/BPM", () => {
    const map = createTempoMap(120)
    expect(map.seconds(8)).toBeCloseTo(4)
    expect(map.beatAt(4)).toBeCloseTo(8)
  })

  it("途中でテンポが変わると、その後の拍は新しいテンポで数える", () => {
    // 0〜8拍は120 BPM(4秒)、8拍目から60 BPM
    const map = createTempoMap(120, [{ beat: 8, bpm: 60 }])
    expect(map.seconds(8)).toBeCloseTo(4)
    expect(map.seconds(10)).toBeCloseTo(6)
    expect(map.beatAt(6)).toBeCloseTo(10)
    expect(map.bpmAt(9)).toBe(60)
  })
})

describe("セクションごとのテンポ指定", () => {
  function project() {
    const base = createEmptyProject("Tempo")
    return {
      ...base,
      song: { ...base.song, tempo: 100, timeSignature: "4/4" },
      sections: [
        { id: "a", name: "A", role: "verse" as const, startBar: 1, lengthBars: 2 },
        { id: "b", name: "B", role: "chorus" as const, startBar: 3, lengthBars: 2, tempoChanges: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 90 }] },
        { id: "c", name: "C", role: "outro" as const, startBar: 5, lengthBars: 2 },
      ],
    }
  }

  it("曲頭からの拍に直し、指定のないセクションは直前のテンポを引き継ぐ", () => {
    const p = project()
    expect(songTempoChanges(p)).toEqual([{ beat: 8, bpm: 120 }, { beat: 12, bpm: 90 }])
    // C はBの最後のテンポ(90)を引き継ぐ
    expect(sectionTempoChanges(p, "c")).toEqual([{ beat: 0, bpm: 90 }])
    expect(sectionTempoChanges(p, "b")).toEqual([{ beat: 0, bpm: 120 }, { beat: 4, bpm: 90 }])
  })

  it("曲のテンポを変えると、途中のテンポも同じ比率で変わる", () => {
    const scaled = scaleSectionTempoChanges(project().sections, 1.1)
    expect(scaled[1].tempoChanges).toEqual([{ beat: 0, bpm: 132 }, { beat: 4, bpm: 99 }])
  })
})
