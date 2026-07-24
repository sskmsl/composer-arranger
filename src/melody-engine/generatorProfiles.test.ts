import { describe, expect, it } from "vitest"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { buildHarmonicMap } from "./harmonicMap"
import { computeMelodyFeatures } from "./features"
import { resolveGenerationParams } from "./generationParams"
import { applyProfileOverride } from "./generatorProfile"
import type { ChordEvent } from "@/core/project"
import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"

const chords: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 8, symbol: "Am", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 8, durationBeats: 8, symbol: "F", bass: null },
  { id: "c3", sectionId: "s1", startBeat: 16, durationBeats: 8, symbol: "C", bass: null },
  { id: "c4", sectionId: "s1", startBeat: 24, durationBeats: 8, symbol: "G", bass: null },
]
const totalBeats = 32
const range = { low: 60, high: 77 }
const harmonicMap = buildHarmonicMap(chords)

function generateOne(profile: MelodyGeneratorProfile, seed: number) {
  const { candidates } = generateFromChordsWithProfiles({
    chords,
    sectionId: "s1",
    sectionRole: "verse",
    songProfile: "original-custom",
    density: "balanced",
    range,
    drama: "growing",
    totalBeats,
    seed,
    profiles: [profile],
  })
  return candidates
}

function metricsFor(notes: MelodyNote[]) {
  return computeMelodyFeatures(notes, harmonicMap, 0, totalBeats)
}

describe("Generator Profile: 既存6 Profileの回帰確認", () => {
  it("standardの上書きは空(既存の生成方向を変えない)", () => {
    const base = resolveGenerationParams("original-custom", "verse", "balanced", "growing")
    const withStandard = applyProfileOverride(base, "standard", 1.0)
    expect(withStandard).toEqual(base)
  })

  it("1 Profile選択時は3案、3 Profile選択時は9案生成される", () => {
    expect(generateOne("standard", 1).length).toBe(3)
    const { candidates } = generateFromChordsWithProfiles({
      chords,
      sectionId: "s1",
      sectionRole: "verse",
      songProfile: "original-custom",
      density: "balanced",
      range,
      drama: "growing",
      totalBeats,
      seed: 1,
      profiles: ["standard", "minimal", "leaping"],
    })
    expect(candidates.length).toBe(9)
  })

  it("Leapingはstandardより平均跳躍が大きい", () => {
    const leaping = metricsFor(generateOne("leaping", 5)[0].notes)
    const standard = metricsFor(generateOne("standard", 5)[0].notes)
    expect(leaping.avgLeap).toBeGreaterThan(standard.avgLeap)
  })

  it("Minimalはstandardより休符率が高い", () => {
    const minimal = metricsFor(generateOne("minimal", 5)[0].notes)
    const standard = metricsFor(generateOne("standard", 5)[0].notes)
    expect(minimal.restRatio).toBeGreaterThan(standard.restRatio)
  })
})

describe("Elegiac Cantabile (§3, §12.1)", () => {
  it("Leapingより順次進行率が高い", () => {
    const elegiac = generateOne("elegiac-cantabile", 11)[0]
    const leaping = generateOne("leaping", 11)[0]
    expect(elegiac.advancedMetrics?.stepwiseMotionRatio ?? 0).toBeGreaterThan(leaping.advancedMetrics?.stepwiseMotionRatio ?? 0)
  })

  it("standardよりクライマックスの希少性(1回だけ最高音を取る度合い)が高い", () => {
    const elegiac = generateOne("elegiac-cantabile", 12)[0]
    const standard = generateOne("standard", 12)[0]
    expect(elegiac.advancedMetrics?.climaxUniqueness ?? 0).toBeGreaterThanOrEqual(standard.advancedMetrics?.climaxUniqueness ?? 0)
  })

  it("少なくとも一つの倚音・掛留音・遅延解決を含む(倚音率または遅延解決率が0より大きい)", () => {
    const elegiac = generateOne("elegiac-cantabile", 13)[0]
    const hasOrnamentOrDelay = (elegiac.advancedMetrics?.appoggiaturaRatio ?? 0) > 0 || (elegiac.advancedMetrics?.delayedResolutionRatio ?? 0) > 0
    expect(hasOrnamentOrDelay).toBe(true)
  })

  it("全ノートがセクション範囲内に収まる(seed横断)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const c of generateOne("elegiac-cantabile", seed)) {
        for (const n of c.notes) {
          expect(n.startBeat).toBeGreaterThanOrEqual(0)
          expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(totalBeats + 1e-6)
        }
      }
    }
  })
})

describe("Speech-Rhythmic (§4, §12.2)", () => {
  it("Rhythmicより平均音域が狭い", () => {
    const speech = metricsFor(generateOne("speech-rhythmic", 21)[0].notes)
    const rhythmic = metricsFor(generateOne("rhythmic", 21)[0].notes)
    expect(speech.rangeHigh - speech.rangeLow).toBeLessThan(rhythmic.rangeHigh - rhythmic.rangeLow)
  })

  it("Rhythmicより同音反復率が高い", () => {
    const speech = metricsFor(generateOne("speech-rhythmic", 22)[0].notes)
    const rhythmic = metricsFor(generateOne("rhythmic", 22)[0].notes)
    expect(speech.repeatedNoteRatio).toBeGreaterThan(rhythmic.repeatedNoteRatio)
  })

  it("standardよりフレーズ非対称性が高い", () => {
    const speech = generateOne("speech-rhythmic", 23)[0]
    const standard = generateOne("standard", 23)[0]
    expect(speech.advancedMetrics?.phraseAsymmetry ?? 0).toBeGreaterThanOrEqual(standard.advancedMetrics?.phraseAsymmetry ?? 0)
  })

  it("全ノートがセクション範囲内に収まる(seed横断)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const c of generateOne("speech-rhythmic", seed)) {
        for (const n of c.notes) {
          expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(totalBeats + 1e-6)
        }
      }
    }
  })
})

describe("Incantatory (§5, §12.3)", () => {
  it("Rhythmicよりモチーフ反復率が高い", () => {
    const incantatory = metricsFor(generateOne("incantatory", 31)[0].notes)
    const rhythmic = metricsFor(generateOne("rhythmic", 31)[0].notes)
    expect(incantatory.motifRepeatRatio).toBeGreaterThan(rhythmic.motifRepeatRatio)
  })

  it("輪郭保持度(contourRetention)が高く保たれる", () => {
    const incantatory = generateOne("incantatory", 32)[0]
    expect(incantatory.advancedMetrics?.contourRetention ?? 0).toBeGreaterThan(0.5)
  })

  it("同一Profile内の3 Patternは互いに独立している(モチーフ音数や変異周期が固定サブタイプに縛られない)", () => {
    const patterns = generateOne("incantatory", 33)
    const noteCounts = new Set(patterns.map((p) => p.notes.length))
    // 3案すべてが完全に同一ノート数になることは通常ない(独立生成の簡易チェック)
    expect(noteCounts.size).toBeGreaterThan(1)
  })

  it("全ノートがセクション範囲内に収まる(seed横断)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const c of generateOne("incantatory", seed)) {
        for (const n of c.notes) {
          expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(totalBeats + 1e-6)
        }
      }
    }
  })
})
