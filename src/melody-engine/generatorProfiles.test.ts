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

  it("Leapingはstandardより平均跳躍が大きい(seed平均)", () => {
    // Pattern 1は品質順であり固定サブタイプではないため、同一Profileの3案平均で比較する。
    // Issue #64で跳躍後の回収がランダム性を伴うため、単一seedではまれに逆転し得る。
    // 統計的性質としてseed平均で比較する(Minimalの休符率テストと同じ理由)。
    let leapingSum = 0
    let standardSum = 0
    for (let seed = 1; seed <= 10; seed++) {
      leapingSum += generateOne("leaping", seed).reduce((sum, candidate) => sum + metricsFor(candidate.notes).avgLeap, 0) / 3
      standardSum += generateOne("standard", seed).reduce((sum, candidate) => sum + metricsFor(candidate.notes).avgLeap, 0) / 3
    }
    expect(leapingSum / 10).toBeGreaterThan(standardSum / 10)
  })

  it("Minimalはstandardより休符率が高い(seed平均)", () => {
    // 冒頭設計で候補ごとの入口が変わるため、統計的性質としてseed平均で比較する
    let minimal = 0
    let standard = 0
    for (let seed = 1; seed <= 20; seed++) {
      minimal += metricsFor(generateOne("minimal", seed)[0].notes).restRatio
      standard += metricsFor(generateOne("standard", seed)[0].notes).restRatio
    }
    expect(minimal).toBeGreaterThan(standard)
  })
})

describe("Elegiac Cantabile (§3, §12.1)", () => {
  it("Leapingより順次進行率が高い", () => {
    const elegiac = generateOne("elegiac-cantabile", 11)[0]
    const leaping = generateOne("leaping", 11)[0]
    expect(elegiac.advancedMetrics?.stepwiseMotionRatio ?? 0).toBeGreaterThan(leaping.advancedMetrics?.stepwiseMotionRatio ?? 0)
  })

  it("standardよりクライマックスの希少性(1回だけ最高音を取る度合い)が高い(seed平均)", () => {
    let elegiac = 0
    let standard = 0
    for (let seed = 1; seed <= 20; seed++) {
      elegiac += generateOne("elegiac-cantabile", seed)[0].advancedMetrics?.climaxUniqueness ?? 0
      standard += generateOne("standard", seed)[0].advancedMetrics?.climaxUniqueness ?? 0
    }
    expect(elegiac).toBeGreaterThanOrEqual(standard)
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

  it("standardよりフレーズ非対称性が高い(seed平均)", () => {
    let speech = 0
    let standard = 0
    for (let seed = 1; seed <= 20; seed++) {
      speech += generateOne("speech-rhythmic", seed)[0].advancedMetrics?.phraseAsymmetry ?? 0
      standard += generateOne("standard", seed)[0].advancedMetrics?.phraseAsymmetry ?? 0
    }
    expect(speech).toBeGreaterThanOrEqual(standard)
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
  it("Rhythmicよりモチーフ反復率が高い(seed平均)", () => {
    // 冒頭設計により候補ごとの入口が変わるため、単一seedではなくseed平均で統計的性質を確認する
    let inc = 0
    let rhy = 0
    for (let seed = 31; seed <= 45; seed++) {
      inc += metricsFor(generateOne("incantatory", seed)[0].notes).motifRepeatRatio
      rhy += metricsFor(generateOne("rhythmic", seed)[0].notes).motifRepeatRatio
    }
    expect(inc).toBeGreaterThan(rhy)
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

function generateAtLength(profile: MelodyGeneratorProfile, seed: number, length: number) {
  const shortChords: ChordEvent[] = [{ id: "sc1", sectionId: "s1", startBeat: 0, durationBeats: length, symbol: "Am", bass: null }]
  const { candidates } = generateFromChordsWithProfiles({
    chords: shortChords,
    sectionId: "s1",
    sectionRole: "verse",
    songProfile: "original-custom",
    density: "balanced",
    range,
    drama: "growing",
    totalBeats: length,
    seed,
    profiles: [profile],
  })
  return candidates
}

/** レビュー指摘の再現条件(短いセクション・seed横断)に沿った回帰テスト */
describe("単旋律性・セクション境界(レビュー指摘の再現条件)", () => {
  const lengths = [1.5, 2, 4, 8, 16, 32]
  const bespokeProfiles: MelodyGeneratorProfile[] = ["elegiac-cantabile", "speech-rhythmic", "incantatory"]

  it.each(bespokeProfiles)("%sは短いセクションでもノートが重なったり終端を超えたりしない", (profile) => {
    const overlaps: string[] = []
    const overflows: string[] = []
    for (const length of lengths) {
      for (let seed = 1; seed <= 100; seed++) {
        for (const c of generateAtLength(profile, seed, length)) {
          const sorted = [...c.notes].sort((a, b) => a.startBeat - b.startBeat)
          for (let i = 0; i < sorted.length; i++) {
            const n = sorted[i]
            if (n.startBeat + n.durationBeats > length + 1e-6) {
              overflows.push(`length=${length} seed=${seed} note#${i} end=${n.startBeat + n.durationBeats}`)
            }
            const next = sorted[i + 1]
            if (next && next.startBeat < n.startBeat + n.durationBeats - 1e-6) {
              overlaps.push(`length=${length} seed=${seed} note#${i}->${i + 1} gap=${next.startBeat - (n.startBeat + n.durationBeats)}`)
            }
          }
        }
      }
    }
    expect(overflows.slice(0, 5)).toEqual([])
    expect(overlaps.slice(0, 5)).toEqual([])
  }, 15_000)
})

describe("Song Motif DNA: bespoke Profileへの反映", () => {
  const dna = {
    intervalCells: [0, 1, -1],
    rhythmCells: [0.5, 1],
    repeatedNoteTendency: 0.95,
    approachNoteTendency: 0.85,
    contourTendency: 0.3,
    phraseEndingTendency: 0.9,
    characteristicRests: [0.5],
    climaxDirection: "ascending" as const,
  }

  // id は生成のたびにcrypto.randomUUID()で変わるため、これを含めたまま比較すると
  // DNAの有無に関わらず常にnot.toEqualが成立してしまう(実際に指摘された欠陥)。
  // 音楽的に意味のあるフィールドだけを取り出して比較する。
  function stripIds(notes: { startBeat: number; durationBeats: number; pitch: number; velocity: number; locks: string[] }[]) {
    return notes.map(({ startBeat, durationBeats, pitch, velocity, locks }) => ({ startBeat, durationBeats, pitch, velocity, locks }))
  }

  function buildFor(profile: MelodyGeneratorProfile, seed: number, motifDNA?: typeof dna) {
    return generateFromChordsWithProfiles({
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
      motifDNA,
    }).candidates[0].notes
  }

  it.each<MelodyGeneratorProfile>(["elegiac-cantabile", "speech-rhythmic", "incantatory"])(
    "%sはDNAの有無でseedの半数以上、音楽的な内容(id以外)が変化する",
    (profile) => {
      let changed = 0
      for (let seed = 1; seed <= 100; seed++) {
        const without = stripIds(buildFor(profile, seed))
        const withD = stripIds(buildFor(profile, seed, dna))
        if (JSON.stringify(withD) !== JSON.stringify(without)) changed++
      }
      expect(changed).toBeGreaterThan(50)
    },
    10_000,
  )
})
