import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { computeHookStrength } from "./hookStrength"
import { computeMelodyFeatures } from "./features"
import { scoreCandidate } from "./scoring"
import { resolveGenerationParams } from "./generationParams"

function notes(pitches: number[], durations = pitches.map(() => 1)): MelodyNote[] {
  let beat = 0
  return pitches.map((pitch, i) => {
    const note: MelodyNote = { id: `${i}`, pitch, startBeat: beat, durationBeats: durations[i], velocity: 80, locks: [] }
    beat += durations[i]
    return note
  })
}
const hook = [60, 64, 62, 67]
const repeated = notes([...hook, ...hook.map(p => p + 2), ...hook], [0.5, 0.5, 1, 2, 0.5, 0.5, 1, 2, 0.5, 0.5, 1, 2])

describe("hook strength", () => {
  it("recognizes a returning pitch and rhythm motif across transposition", () => {
    expect(computeHookStrength(repeated)).toBeGreaterThan(0.8)
  })
  it("does not reward a constant pulse on one pitch", () => {
    expect(computeHookStrength(notes(Array(24).fill(60)))).toBe(0)
  })
  it("distinguishes matching contour from matching intervals", () => {
    const mismatched = notes([...hook, 60, 71, 62, 74, 60, 72, 61, 76], repeated.map(n => n.durationBeats))
    expect(computeHookStrength(mismatched)).toBeLessThan(computeHookStrength(repeated))
  })
  it("requires rhythm as well as pitch identity", () => {
    const mismatched = notes(repeated.map(n => n.pitch), [0.5, 0.5, 1, 2, 2, 1, 0.5, 0.5, 1, 2, 0.5, 0.5])
    expect(computeHookStrength(mismatched)).toBeLessThan(computeHookStrength(repeated))
  })
  it("finds the hook after a pickup and is independent of absolute time and input order", () => {
    const shifted = repeated.map(n => ({ ...n, startBeat: n.startBeat + 3 }))
    expect(computeHookStrength([{ ...repeated[0], pitch: 55, startBeat: 0, durationBeats: 1 }, ...shifted].reverse())).toBeGreaterThan(0.8)
  })
  it("handles silence and short fragments without inventing recurrence", () => {
    expect(computeHookStrength([])).toBe(0)
    expect(computeHookStrength(notes(hook))).toBe(0)
  })
  it("feeds the new evidence into candidate scoring without changing the 100 point scale", () => {
    const features = computeMelodyFeatures(repeated, [], 0, 12)
    const params = resolveGenerationParams("original-custom", "chorus", "balanced", "growing")
    const score = scoreCandidate(features, params)
    expect(features.hookStrength).toBeGreaterThan(0.8)
    expect(score).toBeGreaterThan(scoreCandidate({ ...features, hookStrength: 0 }, params))
    expect(scoreCandidate(features, params, "minimal")).toBe(scoreCandidate({ ...features, hookStrength: 0 }, params, "minimal"))
    expect(score).toBeLessThanOrEqual(100)
    expect(Number.isFinite(scoreCandidate({ ...features, hookStrength: undefined }, params))).toBe(true)
  })
})
