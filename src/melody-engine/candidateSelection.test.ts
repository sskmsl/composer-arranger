import { describe, expect, it } from "vitest"
import type { MelodyNote, PhrasePlan } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { buildHarmonicMap } from "./harmonicMap"
import {
  isStructurallyRedundant,
  selectDiverseCandidates,
  type SelectableCandidate,
} from "./candidateSelection"
import { melodySimilarity } from "./melodySimilarity"

const map = buildHarmonicMap([
  { id: "c", sectionId: "s", startBeat: 0, durationBeats: 8, symbol: "C", bass: null } satisfies ChordEvent,
])
const plans: PhrasePlan[] = [
  { phraseStartBeat: 0, phraseLengthBeats: 8, climaxBeat: 5, contour: "arch", restBeats: [], endTension: 0.2 },
]

function candidate(index: number, quality: number, pitches: number[], starts?: number[]): SelectableCandidate {
  const melody: MelodyNote[] = pitches.map((pitch, noteIndex) => ({
    id: `${index}-${noteIndex}`,
    startBeat: starts?.[noteIndex] ?? noteIndex,
    durationBeats: 1,
    pitch,
    velocity: 80,
    locks: [],
  }))
  return {
    candidatePoolIndex: index,
    qualityScore: quality,
    profileFitScore: quality,
    notes: melody,
    plans,
  }
}

describe("品質下限つき多様性選抜", () => {
  it("単純なQuality上位3件ではなく、品質を保った異なる候補を選ぶ", () => {
    const pool = [
      candidate(0, 95, [60, 62, 64, 65, 67]),
      candidate(1, 94, [60, 62, 64, 65, 67]),
      candidate(2, 93, [60, 62, 64, 65, 67]),
      candidate(3, 88, [72, 67, 63, 70, 61], [0, 0.5, 2, 4, 7]),
    ]
    const selected = selectDiverseCandidates(pool, map, 40).selected.map((item) => item.candidate.candidatePoolIndex)
    expect(selected).toContain(0)
    expect(selected).toContain(3)
    expect(selected).not.toEqual([0, 1, 2])
  })

  it("低品質候補を多様性だけで選ばない", () => {
    const pool = [
      candidate(0, 90, [60, 62, 64, 65]),
      candidate(1, 85, [67, 65, 64, 62]),
      candidate(2, 80, [60, 64, 61, 67]),
      candidate(3, 20, [84, 48, 83, 49]),
    ]
    const result = selectDiverseCandidates(pool, map, 40)
    expect(result.selected.map((item) => item.candidate.candidatePoolIndex)).not.toContain(3)
    expect(result.belowQualityFloor.map((item) => item.candidatePoolIndex)).toContain(3)
  })

  it("同じ候補プールでは選抜結果が再現される", () => {
    const pool = [
      candidate(0, 90, [60, 62, 64, 65]),
      candidate(1, 85, [67, 65, 64, 62]),
      candidate(2, 80, [60, 64, 61, 67]),
    ]
    const a = selectDiverseCandidates(pool, map, 40).selected.map((item) => item.candidate.candidatePoolIndex)
    const b = selectDiverseCandidates(pool, map, 40).selected.map((item) => item.candidate.candidatePoolIndex)
    expect(a).toEqual(b)
  })

  it("品質候補が3件未満なら品質下限を下げず不足を返す", () => {
    const pool = [
      candidate(0, 90, [60, 62, 64]),
      candidate(1, 80, [67, 65, 64]),
      candidate(2, 20, [84, 48, 83]),
    ]
    const result = selectDiverseCandidates(pool, map, 40)
    expect(result.selected).toHaveLength(2)
    expect(result.belowQualityFloor).toHaveLength(1)
  })

  it("高品質候補が似すぎる場合は閾値緩和または不足理由を記録する", () => {
    const pool = [
      candidate(0, 90, [60, 62, 64]),
      candidate(1, 89, [60, 62, 64]),
      candidate(2, 88, [60, 62, 64]),
    ]
    const result = selectDiverseCandidates(pool, map, 40)
    expect(result.selected).toHaveLength(3)
    expect(result.selected.slice(1).some((item) => item.reason !== "quality-diversity-balance")).toBe(true)
  })

  it("移高しただけの同型音程・同型リズムを構造的重複として検出する", () => {
    const original = candidate(0, 90, [60, 62, 64, 67, 65])
    const transposed = candidate(1, 89, [67, 69, 71, 74, 72])
    expect(isStructurallyRedundant(melodySimilarity(original, transposed, map))).toBe(true)
  })

  it("高品質な移高コピーより、品質下限を満たす異なる実音構造を優先する", () => {
    const pool = [
      candidate(0, 95, [60, 62, 64, 67, 65]),
      candidate(1, 94, [67, 69, 71, 74, 72]),
      candidate(2, 89, [60, 67, 63, 70, 61], [0, 0.5, 2, 4, 7]),
      candidate(3, 87, [72, 68, 65, 63, 60], [0, 1.5, 3, 5.5, 7]),
    ]
    const selected = selectDiverseCandidates(pool, map, 40).selected.map((item) => item.candidate.candidatePoolIndex)
    expect(selected).toContain(0)
    expect(selected).toContain(2)
    expect(selected).toContain(3)
    expect(selected).not.toContain(1)
  })
})
