import { describe, expect, it } from "vitest"
import type { MelodyNote, PhrasePlan } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { buildHarmonicMap } from "./harmonicMap"
import { melodySimilarity } from "./melodySimilarity"

const chords: ChordEvent[] = [
  { id: "c", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "C", bass: null },
  { id: "g", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "G7", bass: null },
]
const map = buildHarmonicMap(chords)

function notes(pitches: number[], starts?: number[], durations?: number[]): MelodyNote[] {
  return pitches.map((pitch, index) => ({
    id: `n${index}`,
    pitch,
    startBeat: starts?.[index] ?? index,
    durationBeats: durations?.[index] ?? 1,
    velocity: 80,
    locks: [],
  }))
}

function plan(climaxBeat = 3, phraseLengths = [4, 4]): PhrasePlan[] {
  let cursor = 0
  return phraseLengths.map((phraseLengthBeats, index) => {
    const p: PhrasePlan = {
      phraseStartBeat: cursor,
      phraseLengthBeats,
      climaxBeat: index === 0 ? climaxBeat : cursor + phraseLengthBeats * 0.7,
      contour: "arch",
      restBeats: [],
      endTension: 0.3,
    }
    cursor += phraseLengthBeats
    return p
  })
}

describe("全体Melody similarity", () => {
  it("移高された同型モチーフを高いinterval similarityとして検出する", () => {
    const a = { notes: notes([60, 62, 64, 67, 65]), plans: plan() }
    const b = { notes: notes([65, 67, 69, 72, 70]), plans: plan() }
    expect(melodySimilarity(a, b, map).intervalSimilarity).toBeGreaterThan(0.85)
  })

  it("同じ音高でもリズムが異なる場合はrhythm差を検出する", () => {
    const a = { notes: notes([60, 62, 64, 67], [0, 1, 2, 3], [1, 1, 1, 1]), plans: plan() }
    const b = { notes: notes([60, 62, 64, 67], [0, 0.5, 2.5, 3.5], [0.5, 2, 0.5, 1]), plans: plan() }
    expect(melodySimilarity(a, b, map).rhythmSimilarity).toBeLessThan(0.8)
  })

  it("同じ冒頭でも中盤と終止が異なる場合は全体差を検出する", () => {
    const a = { notes: notes([60, 62, 64, 65, 67, 69, 67, 60]), plans: plan() }
    const b = { notes: notes([60, 62, 64, 59, 57, 55, 62, 66]), plans: plan(6) }
    const similarity = melodySimilarity(a, b, map)
    expect(similarity.openingSimilarity).toBeGreaterThan(0.65)
    expect(similarity.overallSimilarity).toBeLessThan(similarity.openingSimilarity)
  })

  it("異なるクライマックス位置を検出する", () => {
    const a = { notes: notes([72, 60, 62, 64, 65, 67, 69, 67]), plans: plan(0) }
    const b = { notes: notes([60, 62, 64, 65, 67, 69, 67, 72]), plans: plan(7) }
    expect(melodySimilarity(a, b, map).climaxSimilarity).toBeLessThan(0.4)
  })

  it("異なるEndingをcadence similarityで検出する", () => {
    const a = { notes: notes([60, 62, 64, 65, 67, 65, 62, 60]), plans: plan() }
    const b = { notes: notes([60, 62, 64, 65, 67, 70, 71, 74]), plans: plan() }
    expect(melodySimilarity(a, b, map).cadenceSimilarity).toBeLessThan(0.75)
  })

  it("休符位置とPhrase Boundaryを評価する", () => {
    const a = { notes: notes([60, 62, 64, 65], [0, 1, 4, 5]), plans: plan(3, [4, 4]) }
    const b = { notes: notes([60, 62, 64, 65], [0, 2, 3, 7]), plans: plan(3, [6, 2]) }
    const similarity = melodySimilarity(a, b, map)
    expect(similarity.rhythmSimilarity).toBeLessThan(0.8)
    expect(similarity.phraseSimilarity).toBeLessThan(0.9)
  })

  it("同じ音程型でも異なる音域軌跡と音域幅を検出する", () => {
    const a = { notes: notes([60, 62, 64, 65, 67, 69, 67, 65]), plans: plan() }
    const b = { notes: notes([72, 74, 76, 77, 67, 69, 67, 65]), plans: plan() }
    const similarity = melodySimilarity(a, b, map)
    expect(similarity.registerSimilarity).toBeLessThan(0.8)
    expect(similarity.intervalSimilarity).toBeGreaterThan(similarity.registerSimilarity)
  })

  it("相対的な密度曲線だけでなく絶対ノート密度の差を検出する", () => {
    const sparse = { notes: notes([60, 64, 67], [0, 3, 7], [2, 2, 1]), plans: plan() }
    const dense = {
      notes: notes([60, 62, 64, 65, 67, 69, 71, 72, 71, 69], [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7]),
      plans: plan(),
    }
    expect(melodySimilarity(sparse, dense, map).densitySimilarity).toBeLessThan(0.75)
  })
})
