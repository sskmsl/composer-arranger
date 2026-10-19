import { describe, expect, it } from "vitest"
import principles from "./reference/arrangementEmotionPrinciples.json"
import {
  ARC_WEIGHTS,
  RETURN_STEP_DB,
  WITHHELD_DB,
  measureEmotionFromCurves,
  type EmotionCurves,
} from "./arrangementEmotion"

/** 小節ごとの dB を、区間(長さ, dB)の並びから作る。 */
function curve(parts: [number, number][]): number[] {
  return parts.flatMap(([bars, db]) => Array.from({ length: bars }, () => db))
}
const entries = (bars: number, at: Record<number, number> = {}) => Array.from({ length: bars }, (_, i) => at[i] ?? 0)

function curves(weight: number[], energy: number[], at: Record<number, number> = {}, brightness = weight): EmotionCurves {
  return { weightDb: weight, brightnessDb: brightness, energyDb: energy, entries: entries(weight.length, at) }
}

describe("emotion curve scoring (the same function scores recordings and generated arrangements)", () => {
  it("weights the mechanisms by how often the references showed them", () => {
    expect(Object.values(ARC_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6)
    const counts = principles.mechanismObservedIn as Record<string, number>
    const byWeight = Object.entries(ARC_WEIGHTS).sort((a, b) => b[1] - a[1]).map(([id]) => counts[id])
    expect([...byWeight]).toEqual([...byWeight].sort((a, b) => b - a))
  })

  it("scores a held-back foundation that arrives at once", () => {
    const weight = curve([[12, -30], [20, -6]])
    const report = measureEmotionFromCurves(curves(weight, curve([[12, -20], [20, -6], [4, -8]]).slice(0, 32), { 12: 4 }))
    const arrival = report.mechanisms["expectation-arrival"]!
    expect(arrival.present).toBe(true)
    expect(arrival.at).toBe(12)
    expect(arrival.detail.stepDb).toBeGreaterThanOrEqual(RETURN_STEP_DB)
    expect(arrival.detail.depthDb).toBeGreaterThanOrEqual(WITHHELD_DB)
  })

  it("does not score a foundation that was never held back, or one that comes back by a small step", () => {
    const flat = measureEmotionFromCurves(curves(curve([[32, -6]]), curve([[32, -6]])))
    expect(flat.mechanisms["expectation-arrival"]!.score).toBe(0)
    expect(flat.mechanisms["subtraction-contrast"]!.score).toBe(0)
    const gentle = measureEmotionFromCurves(curves(curve([[12, -12], [20, -6]]), curve([[32, -6]])))
    expect(gentle.mechanisms["expectation-arrival"]!.score, "6dBの保留は保留と見なさない").toBe(0)
  })

  it("tells an opening hold-back from a later subtraction", () => {
    const weight = [...curve([[8, -30], [16, -6], [4, -30], [16, -6]])]
    const report = measureEmotionFromCurves(curves(weight, curve([[44, -6]]), { 8: 3, 28: 3 }))
    expect(report.mechanisms["expectation-arrival"]!.at).toBe(8)
    expect(report.mechanisms["subtraction-contrast"]!.at).toBe(28)
    expect(report.mechanisms["subtraction-contrast"]!.present).toBe(true)
  })

  it("scores a closing decay by how far and how steadily the level falls over the last bars", () => {
    const steady = measureEmotionFromCurves(curves(curve([[28, -6]]), [...curve([[24, -6]]), -9, -14, -20, -28]))
    const abrupt = measureEmotionFromCurves(curves(curve([[28, -6]]), curve([[28, -6]])))
    expect(steady.mechanisms["closure-decay"]!.present).toBe(true)
    expect(abrupt.mechanisms["closure-decay"]!.score).toBe(0)
    expect(steady.arcScore).toBeGreaterThan(abrupt.arcScore)
  })

  it("scores a rising opening as accumulation", () => {
    const rising = measureEmotionFromCurves(curves(curve([[24, -6]]), [-20, -18, -15, -12, -9, -6, ...curve([[18, -6]])]))
    expect(rising.mechanisms.accumulation!.present).toBe(true)
  })

  it("returns an empty report for a song too short to judge", () => {
    expect(measureEmotionFromCurves(curves(curve([[4, -6]]), curve([[4, -6]]))).arcScore).toBe(0)
  })

  it("keeps the recorded reference summary inside the scorer's range", () => {
    const { scores, median, min, max } = principles.referenceArcScore
    expect(scores.length).toBe(principles.recordings.count)
    expect(median).toBeGreaterThan(min)
    expect(max).toBeLessThanOrEqual(100)
    expect(principles.thresholds.withheldDb).toBe(WITHHELD_DB)
    expect(principles.thresholds.returnStepDb).toBe(RETURN_STEP_DB)
  })
})
