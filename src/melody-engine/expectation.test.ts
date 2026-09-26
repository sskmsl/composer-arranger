import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import songExpectationJson from "./reference/songExpectation.json"
import { measureExpectation, noteInformation } from "./expectation"

const notes = (rows: readonly (readonly number[])[]): MelodyNote[] =>
  rows.map(([startBeat, durationBeats, pitch], index) => ({ id: `n${index}`, startBeat, durationBeats, pitch, velocity: 80, locks: [] }))

describe("予想しやすさ(歌502曲の音程の出やすさ)", () => {
  it("作成スクリプト(Python)と同じ値になる", () => {
    const check = songExpectationJson.selfCheck
    const values = noteInformation(notes(check.notes), check.key)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    expect(mean).toBeCloseTo(check.meanInformation, 5)
  })

  it("音階を順に動く歌は、半音階的に跳び回る旋律より予想しやすい", () => {
    const singable = notes([[0, 1, 60], [1, 1, 62], [2, 1, 64], [3, 1, 65], [4, 2, 67], [6, 1, 65], [7, 1, 64], [8, 1, 62], [9, 1, 60], [10, 2, 62], [12, 2, 60]])
    const erratic = notes([[0, 1, 60], [1, 1, 66], [2, 1, 61], [3, 1, 71], [4, 2, 63], [6, 1, 70], [7, 1, 62], [8, 1, 73], [9, 1, 64], [10, 2, 58], [12, 2, 69]])
    const a = measureExpectation(singable, "C")!
    const b = measureExpectation(erratic, "C")!
    expect(a.meanInformation).toBeLessThan(b.meanInformation - 1)
    expect(a.score).toBeGreaterThan(b.score)
    expect(b.songPercentile).toBeGreaterThan(90)
  })

  it("同じ形をくり返すと、その曲の中で予想しやすくなる(短期の予想)", () => {
    const phrase = [[0, 1, 64], [1, 1, 67], [2, 1, 69], [3, 1, 67], [4, 2, 64]]
    const once = notes(phrase)
    const twice = notes([...phrase, ...phrase.map(([s, d, p]) => [s + 8, d, p])])
    const first = noteInformation(once, "C")
    const repeated = noteInformation(twice, "C").slice(first.length + 1)
    expect(repeated.reduce((s, v) => s + v, 0) / repeated.length).toBeLessThan(first.reduce((s, v) => s + v, 0) / first.length)
  })
})
