import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { contourMatches, durationContour, lhlSyncopation, povelEssensCounterEvidence } from "./rhythmMemory"

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
})

describe("M4 位相・弱起(M2 の A を半拍後ろへ。予想は置かず、値を記録する)", () => {
  it("シンコペーションの対照ではなく位相の対照として、値が変わることだけを確かめる", () => {
    const a = pattern([[0, 1], [1, 1], [2, 1], [4, 1], [5, 1], [6, 1]])
    const shifted = a.map((note) => ({ ...note, startBeat: note.startBeat + .5 }))
    expect(lhlSyncopation(shifted, 8)).not.toBe(lhlSyncopation(a, 8))
    expect(povelEssensCounterEvidence(shifted, 8)).not.toBe(povelEssensCounterEvidence(a, 8))
  })
})
