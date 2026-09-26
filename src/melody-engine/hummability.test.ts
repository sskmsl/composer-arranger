import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { judgeCoreMotif } from "./hookFirst"
import { intervalSingability, measureHummability } from "./hummability"

const line = (pitches: number[], durations: number[]): MelodyNote[] => {
  let beat = 0
  return pitches.map((pitch, index) => {
    const note = { id: `n${index}`, startBeat: beat, durationBeats: durations[index % durations.length], pitch, velocity: 80, locks: [] }
    beat += note.durationBeats
    return note
  })
}

describe("口ずさめるか(音域の広さは問わない)", () => {
  it("4度・5度・オクターブの跳躍は歌える。増4度・7度は歌いにくいが、息継ぎの後なら歌える", () => {
    for (const interval of [0, 2, 3, 5, 7, 12, -7]) expect(intervalSingability(interval, false)).toBe(1)
    for (const interval of [6, 10, 11, 14]) expect(intervalSingability(interval, false)).toBeLessThan(0.5)
    expect(intervalSingability(11, true)).toBe(1)
  })

  it("5度を連ねてオクターブを超える核(利用者の録音の冒頭の形)を、歌いにくいと判定しない", () => {
    // B♭→E♭→B♭→F: 5度の跳躍を3回、音域は14半音
    const core = line([70, 63, 70, 77], [2, 2, 2, 2])
    expect(judgeCoreMotif(core, 8).humability).toBeGreaterThanOrEqual(0.8)
    // 増4度と7度を含む核は、同じ音数でも低くなる
    const awkward = line([70, 64, 75, 64], [2, 2, 2, 2])
    expect(judgeCoreMotif(awkward, 8).humability).toBeLessThan(judgeCoreMotif(core, 8).humability - 0.15)
  })

  it("旋律全体では、いちばん歌いにくい2小節を重く見る", () => {
    // 2小節ごとに最後の音を伸ばして息を継ぐ
    const smooth = line([67, 69, 71, 72, 71, 69, 67, 72, 71, 69, 67, 69, 71, 72], [1, 1, 1, 1, 1, 1, 2])
    const oneBadSpot = line([67, 69, 71, 72, 71, 69, 67, 72, 61, 71, 60, 69, 71, 72], [1, 1, 1, 1, 1, 1, 2])
    const good = measureHummability(smooth, 16)
    const bad = measureHummability(oneBadSpot, 16)
    expect(good.score).toBeGreaterThan(0.9)
    expect(bad.weakest).toBeLessThan(good.weakest - 0.3)
  })
})
