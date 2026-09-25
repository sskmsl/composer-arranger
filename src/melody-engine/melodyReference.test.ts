import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote } from "@/core/melody"
import { measureMelodyCraft } from "./melodyCraftMetrics"
import { bandScore, distributionOf, scoreAgainstReference, type MelodyReferenceStats } from "./melodyReference"
import referenceStats from "./reference/melodyReferenceStats.json"

const stats = referenceStats as MelodyReferenceStats

describe("実在曲を根拠にした物差し", () => {
  it("集計済みの実在曲には、Bach のコラール・Essen 民謡集・古典派の主題が入っている", () => {
    expect(stats.corpora.bach.units).toBeGreaterThan(500)
    expect(stats.corpora.essen.units).toBeGreaterThan(5000)
    expect(stats.corpora.classical.units).toBeGreaterThan(30)
    // 実在の旋律は、跳躍より順次進行がずっと多い
    expect(stats.corpora.essen.metrics.stepwise!.p50).toBeGreaterThan(stats.corpora.essen.metrics.leapRate!.p50 * 2)
  })

  it("分布の範囲(p25〜p75)に入れば1、外れるほど下がる", () => {
    const distribution = distributionOf([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
    expect(distribution.p50).toBeCloseTo(0.5)
    expect(bandScore(0.5, distribution, 0.05)).toBe(1)
    expect(bandScore(distribution.p90, distribution, 0.05)).toBeCloseTo(0.5)
    expect(bandScore(1.5, distribution, 0.05)).toBe(0)
    expect(bandScore(0.1, distribution, 0.05)).toBeLessThan(1)
  })

  it("順次進行でつながる旋律は、跳躍ばかりの旋律より点が高く、内訳に根拠の範囲が付く", () => {
    const chords = parseChordInputText("C | F | G | C", "s1", 4, "c")
    const n = (startBeat: number, pitch: number, durationBeats = 1): MelodyNote => ({ id: `${startBeat}`, startBeat, durationBeats, pitch, velocity: 90, locks: [] })
    const leaping = [n(0, 60), n(1, 67), n(2, 72), n(3, 64), n(4, 72), n(5, 65), n(6, 77), n(7, 69), n(8, 62), n(9, 74), n(10, 67), n(12, 60, 4)]
    const conjunct = [n(0, 64), n(1, 65), n(2, 67), n(3, 65), n(4, 65), n(5, 67), n(6, 69), n(7, 72), n(8, 71), n(9, 69), n(10, 67), n(12, 72, 4)]
    const score = (notes: MelodyNote[]) => scoreAgainstReference(measureMelodyCraft(notes, chords, "C"), stats, { resolving: true, totalBeats: 16 })
    expect(score(conjunct).score).toBeGreaterThan(score(leaping).score + 15)
    const stepwise = score(conjunct).items.find((item) => item.key === "stepwise")!
    expect(stepwise.corpus).toBe("Essen 民謡集")
    expect(stepwise.band[0]).toBeLessThan(stepwise.band[1])
  })
})
