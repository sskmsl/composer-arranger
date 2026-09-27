import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { contourMatches, coreContourMatches, durationContour, lhlSyncopation, povelEssensCounterEvidence } from "./rhythmMemory"

/**
 * 実験1:リズムの仕組みの対照(docs/rhythm-memory-controls.md)。4/4、2小節、和声なし、既存の曲の音型は使わない。
 * 指標が定義どおりに動くかの確認で、好みの証拠ではない。
 */
const PITCHES = [60, 62, 64, 65, 67, 69, 67, 65]
const pattern = (rhythm: [number, number][]): MelodyNote[] =>
  rhythm.map(([startBeat, durationBeats], index) => ({ id: `n${index}`, startBeat, durationBeats, pitch: PITCHES[index % PITCHES.length], velocity: 80, locks: [] }))
const legato = (durations: number[]): MelodyNote[] => {
  let beat = 0
  return pattern(durations.map((duration) => {
    const note: [number, number] = [beat, duration]
    beat += duration
    return note
  }))
}

describe("M1 拍を作る強さ(同じ音価集合の並び順。並び順・輪郭・位置をまとめて動かす)", () => {
  const a = legato([1, 1, .5, .5, 1, 2, 2])
  const b = legato([.5, 1, 1, 2, .5, 1, 2])
  it("長い音と区切りが拍の上にある A の方が、拍を強く生む(反証が少ない)", () => {
    expect(povelEssensCounterEvidence(a, 8)).toBe(8)
    expect(povelEssensCounterEvidence(b, 8)).toBe(21)
  })
  it("シンコペーションは A 0 / B 6", () => {
    expect(lhlSyncopation(a, 8)).toBe(0)
    expect(lhlSyncopation(b, 8)).toBe(6)
  })
})

describe("拍を作る強さの最小単位は、実際の発音間隔だけから求める", () => {
  it("最後の音から区間の終わりまでが短くても、それを最小単位にしない", () => {
    // 0・2・4拍の発音は間隔2の3音の組(最初と最後にアクセント)。区間の終わり(5拍)までの1拍は単位にしない
    expect(povelEssensCounterEvidence(pattern([[0, 1], [2, 1], [4, 1]]), 5)).toBe(9)
  })
})

describe("M2 シンコペーション(配置と休符だけを変える)", () => {
  const a = pattern([[0, 1], [1, 1], [2, 1], [4, 1], [5, 1], [6, 1]])
  const b = pattern([[0, 1], [1.5, 1], [2.5, 1], [4, 1], [5.5, 1], [6.5, 1]])
  it("拍の頭を裏拍からの持続が覆う B の方がシンコペーションが強い", () => {
    expect(lhlSyncopation(a, 8)).toBe(0)
    expect(lhlSyncopation(b, 8)).toBe(6)
  })
  it("拍を作る強さも A が強い", () => {
    expect(povelEssensCounterEvidence(a, 8)).toBe(10)
    expect(povelEssensCounterEvidence(b, 8)).toBe(24)
  })
})

describe("M3 単位どうしの輪郭の一致(アプリの仮説。境界は小節線で固定)", () => {
  const a = legato([1, .5, .5, 2, 1, .5, .5, 2])
  const aPrime = legato([1, .5, .5, 2, 1.5, .75, .75, 1])
  const b = legato([1, 2, .5, 1, .5, 2, .5, .5])
  it("A と、音価だけ違う A′ は一致、同じ音価を並べ替えた B は不一致", () => {
    expect(contourMatches(a, 4, 8)).toEqual({ compared: 1, matched: 1, notApplicable: 0 })
    expect(contourMatches(aPrime, 4, 8)).toEqual({ compared: 1, matched: 1, notApplicable: 0 })
    expect(contourMatches(b, 4, 8)).toEqual({ compared: 1, matched: 0, notApplicable: 0 })
  })
  it("音が3音未満の単位は 0 点にせず、比べられない単位として数える", () => {
    const short = pattern([[0, 2], [2, 2], [4, 1], [5, 1], [6, 2]])
    expect(durationContour(short.slice(0, 2))).toBeUndefined()
    expect(contourMatches(short, 4, 8)).toEqual({ compared: 0, matched: 0, notApplicable: 1 })
  })
  it("限界: 音価の並びが同じなら、発音間隔や休符が違っても一致と数える", () => {
    // 1小節目は隙間なし、2小節目は同じ音価の間に休符を挟む
    const spaced = pattern([[0, 1], [1, .5], [1.5, .5], [2, 1], [4, 1], [5.5, .5], [6, .5], [7, 1]])
    expect(contourMatches(spaced, 4, 8)).toEqual({ compared: 1, matched: 1, notApplicable: 0 })
  })
})

describe("生成時点の核を基準にした輪郭の一致(計画の位置で比べる)", () => {
  const core = [{ startBeat: 0, durationBeats: 1 }, { startBeat: 1, durationBeats: .5 }, { startBeat: 1.5, durationBeats: .5 }, { startBeat: 2, durationBeats: 2 }]
  // 冒頭は核のまま、4拍目からは音価の並びが変わり、8拍目からは核に戻る
  const notes = legato([1, .5, .5, 2, .5, .5, 1, 2, 1, .5, .5, 2])
  it("冒頭と再提示の位置を、それぞれ核と比べる", () => {
    expect(coreContourMatches(core, notes, [0], 4, 12)).toEqual({ compared: 1, matched: 1, notApplicable: 0 })
    expect(coreContourMatches(core, notes, [4, 8], 4, 12)).toEqual({ compared: 2, matched: 1, notApplicable: 0 })
  })
  it("区間の終わりを越える位置は数えず、核の音が足りなければ比べられない単位として数える", () => {
    expect(coreContourMatches(core, notes, [10], 4, 12)).toEqual({ compared: 0, matched: 0, notApplicable: 0 })
    expect(coreContourMatches(core.slice(0, 2), notes, [0, 8], 4, 12)).toEqual({ compared: 0, matched: 0, notApplicable: 2 })
  })
})

describe("区間外の音は数えない", () => {
  it("全体の音列を渡しても、冒頭の区間だけの値と同じ", () => {
    const head = pattern([[0, 1], [1.5, 1], [2.5, 1], [4, 1], [5.5, 1], [6.5, 1]])
    const whole = [...head, ...pattern([[8, 1], [9.5, 1], [11, 1]]).map((note, index) => ({ ...note, id: `tail${index}` }))]
    expect(lhlSyncopation(whole, 8)).toBe(lhlSyncopation(head, 8))
    expect(povelEssensCounterEvidence(whole, 8)).toBe(povelEssensCounterEvidence(head, 8))
  })
})

describe("M4 位相・弱起(M2 の A を半拍後ろへ。予想は置かず、値を記録する)", () => {
  it("シンコペーションの対照ではなく位相の対照として、値が変わることだけを確かめる", () => {
    const a = pattern([[0, 1], [1, 1], [2, 1], [4, 1], [5, 1], [6, 1]])
    const shifted = a.map((note) => ({ ...note, startBeat: note.startBeat + .5 }))
    expect(lhlSyncopation(shifted, 8)).not.toBe(lhlSyncopation(a, 8))
    expect(povelEssensCounterEvidence(shifted, 8)).not.toBe(povelEssensCounterEvidence(a, 8))
  })
})
