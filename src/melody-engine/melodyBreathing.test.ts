import { describe, expect, it } from "vitest"
import { shapeMelodyBreathing } from "./melodyBreathing"
import { measureBreathing } from "@/store/arrangementPerformanceMeasurements"

describe("生成旋律の息継ぎ", () => {
  it("音数・音程・開始位置・終止音を保ち、4小節ごとに休符を作る", () => {
    const notes = Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, pitch: 60 + i % 5, startBeat: i * 2, durationBeats: 2, velocity: 80, locks: [] }))
    const before = structuredClone(notes)
    const result = shapeMelodyBreathing(notes, 32)
    expect(result.map((n) => [n.pitch, n.startBeat, n.velocity])).toEqual(notes.map((n) => [n.pitch, n.startBeat, n.velocity]))
    expect(result.at(-1)).toEqual(notes.at(-1))
    expect(measureBreathing(result, 32).blocks.every((b) => b.hasBreath)).toBe(true)
    expect(notes).toEqual(before)
  })
})
