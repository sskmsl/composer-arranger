import { describe, expect, it } from "vitest"
import { SeededRandom } from "@/core/rng"
import { buildHarmonicMap } from "./harmonicMap"
import { resolveGenerationParams } from "./generationParams"
import { generatePitchMotif, type MotifEvent } from "./motifCore"
import { growSegments } from "./phraseAssembler"
import { scoreCandidate } from "./scoring"

const params = resolveGenerationParams("original-custom", "chorus", "balanced", "growing")

describe("chorus hook motion", () => {
  it("keeps a repeated anchor memorable without getting stuck on it", () => {
    const events: MotifEvent[] = Array.from({ length: 7 }, (_, i) => ({
      offsetBeats: i,
      durationBeats: 1,
      isRest: false,
    }))
    const harmony = buildHarmonicMap([{
      id: "am", sectionId: "chorus", startBeat: 0, durationBeats: 8,
      symbol: "Am", bass: null,
    }])
    for (let seed = 1; seed <= 50; seed++) {
      const pitches = generatePitchMotif(new SeededRandom(seed), events, 0, harmony, { low: 60, high: 76 }, params, undefined, true)
      let run = 1
      for (let i = 1; i < pitches.length; i++) {
        run = pitches[i] === pitches[i - 1] ? run + 1 : 1
        expect(run).toBeLessThanOrEqual(3)
      }
      expect(new Set(pitches).size).toBeGreaterThan(1)
    }
  })

  it("leaves space after the first motif when the phrase has room for an answer", () => {
    const events: MotifEvent[] = [
      { offsetBeats: 0, durationBeats: 1, isRest: false },
      { offsetBeats: 1, durationBeats: 1, isRest: false },
    ]
    const segments = growSegments(new SeededRandom(7), events, [69, 72], 0, 8, params, false, true, undefined, 1.5)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments[1].startBeat - 2).toBeGreaterThanOrEqual(1.5)
    expect(segments.every(segment => segment.startBeat + Math.max(...segment.events.map(event => event.offsetBeats + event.durationBeats)) <= 8)).toBe(true)
  })

  it("prefers a singable hook over long static runs and frequent large jumps", () => {
    const base = {
      rangeLow: 60, rangeHigh: 72, maxLeap: 9, avgLeap: 3,
      restRatio: 0.15, repeatedNoteRatio: 0.3, tensionUsageRatio: 0.15,
      chordToneUsageRatio: 0.8, syncopationRatio: 0.2, motifRepeatRatio: 0.6,
      hookStrength: 0.7, peakPosition: 0.6, leapRecoveryRatio: 0.7,
      largeLeapRatio: 0.05, longestPitchRun: 3,
    }
    const good = scoreCandidate(base, params, "standard")
    expect(scoreCandidate({ ...base, longestPitchRun: 9 }, params, "standard")).toBeLessThan(good)
    expect(scoreCandidate({ ...base, largeLeapRatio: 0.25 }, params, "standard")).toBeLessThan(good)
  })
})
