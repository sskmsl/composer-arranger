import { describe, expect, it } from "vitest"
import type { MelodyNote, PhrasePlan } from "@/core/melody"
import { buildHarmonicMap } from "./harmonicMap"
import { computeMelodyFeatures } from "./features"
import { resolveGenerationParams } from "./generationParams"
import { shapePhraseBreaths } from "./melodicRelease"
import { scoreCandidate } from "./scoring"

const harmony = buildHarmonicMap([{ id: "c", sectionId: "s", startBeat: 0, durationBeats: 8, symbol: "C", bass: null }])
const note = (id: string, pitch: number, startBeat: number, durationBeats = 1): MelodyNote => ({
  id, pitch, startBeat, durationBeats, velocity: 80, locks: [],
})

describe("classical principles as candidate judgments", () => {
  it("半音の違和感は解決先がある場合だけ評価し、未解決の強拍は抑える", () => {
    const resolved = computeMelodyFeatures([
      note("root", 60, 0), note("bite", 63, 1), note("resolve", 64, 2), note("fifth", 67, 3),
    ], harmony, 0, 8)
    const unresolved = computeMelodyFeatures([
      note("root", 60, 0), note("stray", 63, 1), note("fifth", 67, 2), note("third", 64, 3),
    ], harmony, 0, 8)
    expect(resolved.resolvedNonChordRatio).toBeGreaterThan(0)
    expect(unresolved.exposedUnresolvedRatio).toBeGreaterThan(0)
    const params = resolveGenerationParams("original-custom", "verse", "balanced", "growing")
    expect(scoreCandidate({ ...resolved, motifRepeatRatio: 0.5, hookStrength: 0.5 }, params)).toBeGreaterThan(
      scoreCandidate({ ...resolved, motifRepeatRatio: 0.5, hookStrength: 0.5, resolvedNonChordRatio: 0, exposedUnresolvedRatio: unresolved.exposedUnresolvedRatio }, params),
    )
  })

  it("輪郭だけの反復より音程とリズムを伴う再帰を歌メロで優先する", () => {
    const base = computeMelodyFeatures([note("a", 60, 0), note("b", 62, 1)], harmony, 0, 8)
    const params = resolveGenerationParams("original-custom", "verse", "balanced", "growing")
    expect(scoreCandidate({ ...base, motifRepeatRatio: 0.6, hookStrength: 0.8 }, params, "standard")).toBeGreaterThan(
      scoreCandidate({ ...base, motifRepeatRatio: 0.6, hookStrength: 0.1 }, params, "standard"),
    )
  })

  it("次のフレーズ前に短い吸気を作り、Minimalや保護音は維持する", () => {
    const source = [note("lead", 60, 2, 2), note("reply", 64, 4, 1)]
    const plans: PhrasePlan[] = [
      { phraseStartBeat: 0, phraseLengthBeats: 4, climaxBeat: 2, contour: "arch", restBeats: [], endTension: 0 },
      { phraseStartBeat: 4, phraseLengthBeats: 4, climaxBeat: 4, contour: "arch", restBeats: [], endTension: 0 },
    ]
    expect(shapePhraseBreaths(source, plans, "standard")[0].durationBeats).toBe(1.75)
    expect(shapePhraseBreaths(source, plans, "minimal")).toEqual(source)
    expect(shapePhraseBreaths([{ ...source[0], locks: ["pitch"] }, source[1]], plans, "standard")[0].durationBeats).toBe(2)
  })

  it("歌える近接運動を評価し、半音の情感は解決と着地がある時だけ数える", () => {
    const arrival = computeMelodyFeatures([
      note("lead", 64, 0), note("ache", 61, 1, 0.5), note("land", 60, 1.5, 1.5),
      note("answer", 62, 3), note("close", 60, 4),
    ], harmony, 0, 8)
    const stray = computeMelodyFeatures([
      note("lead", 64, 0), note("ache", 61, 1, 0.5), note("jump", 67, 1.5, 1.5),
      note("answer", 62, 3), note("close", 60, 4),
    ], harmony, 0, 8)
    expect(arrival.chromaticArrivalRatio).toBeGreaterThan(0)
    expect(stray.chromaticArrivalRatio).toBe(0)
    expect(arrival.stepwiseMotionRatio).toBeGreaterThan(stray.stepwiseMotionRatio!)
    const params = resolveGenerationParams("dark-romantic", "verse", "balanced", "growing")
    const withArrival = scoreCandidate(arrival, params, "elegiac-cantabile")
    expect(withArrival).toBeGreaterThan(scoreCandidate({ ...arrival, chromaticArrivalRatio: 0 }, params, "elegiac-cantabile"))
    expect(withArrival).toBeGreaterThan(scoreCandidate({ ...arrival, stepwiseMotionRatio: 0 }, params, "elegiac-cantabile"))
    expect(scoreCandidate(arrival, params, "minimal")).toBe(scoreCandidate({ ...arrival, stepwiseMotionRatio: 0, chromaticArrivalRatio: 0 }, params, "minimal"))
  })
})
