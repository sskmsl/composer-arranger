import { describe, expect, it } from "vitest"
import { candidatePlacement } from "./candidatePlacement"
import type { MelodyNote } from "./melody"
import type { Section } from "./section"

const section: Section = {
  id: "verse-1",
  name: "Aメロ",
  role: "verse",
  startBar: 17,
  lengthBars: 8,
}

function note(startBeat: number, durationBeats: number): MelodyNote {
  return {
    id: `${startBeat}`,
    pitch: 60,
    startBeat,
    durationBeats,
    velocity: 90,
    locks: [],
  }
}

describe("candidatePlacement", () => {
  it("section相対位置を曲全体の小節位置へ変換する", () => {
    expect(candidatePlacement(section, [note(4, 4)], 4)).toEqual({
      firstSectionBar: 2,
      lastSectionBar: 2,
      firstSongBar: 18,
      lastSongBar: 18,
      label: "推奨配置：曲全体の18小節目（Aメロの2小節目）",
    })
  })

  it("複数小節にまたがる候補は範囲を示す", () => {
    expect(candidatePlacement(section, [note(2, 1), note(8, 2)], 4)?.label)
      .toBe("推奨配置：曲全体の17〜19小節（Aメロの1〜3小節目）")
  })

  it("小節線で終了する音を次小節まで使用した扱いにしない", () => {
    expect(candidatePlacement(section, [note(0, 4)], 4)?.lastSongBar).toBe(17)
  })
})
