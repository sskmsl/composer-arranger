import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { observeClashes, observeParallels, observeRegister, perfectIntervalClass, silentShare, topLine } from "./arrangementObservation"

const n = (startBeat: number, pitch: number, durationBeats = 1): MelodyNote => ({
  id: `${startBeat}-${pitch}`, startBeat, durationBeats, pitch, velocity: 80, locks: [],
})
// 主旋律 C4→D4
const lead = [n(0, 60), n(1, 62)]

describe("アレンジの観測(記録用)", () => {
  it("完全5度・8度は絶対音程で判定し、4度は含めない", () => {
    expect(perfectIntervalClass(67, 60)).toBe("fifth")
    expect(perfectIntervalClass(60, 53)).toBe("fifth")
    expect(perfectIntervalClass(60, 55)).toBeNull()
    expect(perfectIntervalClass(72, 60)).toBe("octave")
    expect(perfectIntervalClass(79, 60)).toBe("fifth")
  })

  it("主旋律との平行5度・8度: 下声でも上声でも数え、平行4度は数えない", () => {
    // 下声の平行5度 F3→G3
    expect(observeParallels([n(0, 53), n(1, 55)], lead).parallelPerfect).toBe(1)
    // 下声の平行4度 G3→A3
    expect(observeParallels([n(0, 55), n(1, 57)], lead).parallelPerfect).toBe(0)
    // 上声の平行5度 G4→A4
    expect(observeParallels([n(0, 67), n(1, 69)], lead).parallelPerfect).toBe(1)
    // 下声の平行8度 C3→D3
    expect(observeParallels([n(0, 48), n(1, 50)], lead).parallelPerfect).toBe(1)
    // 反進行は判定対象(同じ向きの組)に入らない
    const contrary = observeParallels([n(0, 55), n(1, 53)], lead)
    expect(contrary).toEqual({ movingPairs: 1, similarMotionPairs: 0, parallelPerfect: 0 })
    // 5度から8度へ(種類が違う)は平行に数えない
    expect(observeParallels([n(0, 53), n(1, 50)], [n(0, 60), n(1, 62)]).parallelPerfect).toBe(0)
  })

  it("半音系のぶつかりを、短2度・長7度・複音程に分け、拍の頭と解決を残す", () => {
    const others = [n(0, 60, 2)]
    const result = observeClashes([n(0, 61, 1), n(1, 62, 1)], others)
    expect(result.minorSecond).toBe(1)
    expect(result.minorSecondOnBeat).toBe(1)
    expect(result.minorSecondResolved).toBe(1)
    expect(observeClashes([n(0, 71, 1)], others).majorSeventh).toBe(1)
    expect(observeClashes([n(0, 73, 1)], others).compound).toBe(1)
    // 0.5拍より短い重なりは数えない
    expect(observeClashes([n(1.75, 61, 1)], others).overlapNotes).toBe(0)
    // 相手も一緒に動いて短2度が続くときは、解決に数えない
    expect(observeClashes([n(0, 61, 1), n(1, 63, 1)], [n(0, 60, 1), n(1, 62, 1)]).minorSecondResolved).toBe(0)
    // 同じ開始の和音の別の音は、進む先にしない(次の異なる開始で判定する)
    expect(observeClashes([n(0, 61, 1), n(0, 62, 1), n(1, 61, 1)], others).minorSecondResolved).toBe(0)
  })

  it("重なりの拍数は、相手が替わっても和集合で数える", () => {
    // 2拍の音が、主旋律の1拍の音2つと続けて重なる
    const result = observeClashes([n(0, 61, 2)], [n(0, 60, 1), n(1, 60, 1)])
    expect(result.overlapBeats).toBeCloseTo(2, 5)
    expect(result.minorSecondBeats).toBeCloseTo(2, 5)
  })

  it("上にある割合と、上下が入れ替わる交差を分けて数える", () => {
    const line = [n(0, 64), n(1, 60), n(2, 65)]
    const register = observeRegister(line, [n(0, 62, 3)])
    expect(register).toEqual({ compared: 3, above: 2, crossings: 2 })
    // 主旋律の休みを挟んだ前後で上下が違うだけなら、交差に数えない
    const gapped = observeRegister([n(0, 64), n(2, 60)], [n(0, 62, 1), n(2, 62, 1)])
    expect(gapped).toEqual({ compared: 2, above: 1, crossings: 0 })
    // 主旋律の休みの間に鳴ったパートの音(比べられない音)も、続きを切る
    const throughRest = observeRegister([n(0, 64), n(1, 65), n(2, 60)], [n(0, 62, 1), n(2, 62, 1)])
    expect(throughRest).toEqual({ compared: 2, above: 1, crossings: 0 })
  })

  it("同じ開始の音は最高音1つにし、鳴っていない拍の割合を16分音符の格子で数える", () => {
    expect(topLine([n(0, 60), n(0, 67), n(1, 64)]).map((note) => note.pitch)).toEqual([67, 64])
    // 演奏処理で数ミリ秒ずつずれた和音の音も、同じ開始としてまとめる
    expect(topLine([n(0, 60), n(.004, 67), n(.008, 64), n(1, 62)]).map((note) => note.pitch)).toEqual([67, 62])
    expect(silentShare([[n(0, 60, 1)], [n(2, 64, 1)]], 4)).toBeCloseTo(.5, 5)
  })
})
