import { describe, expect, it } from "vitest"
import { generateFromChordsWithProfiles, type GenerateProfileBatchInput } from "./generateFromChords"
import { generateRhythmMotif } from "./motifCore"
import { resolveGenerationParams } from "./generationParams"
import { SeededRandom } from "@/core/rng"
import { GENERATOR_PROFILES } from "./generatorProfile"
import { SETTINGS_APPLICABILITY, profilesIgnoring } from "./settingsApplicability"
import type { ChordEvent } from "@/core/project"
import type { Density, Drama, RangeSetting } from "./generationParams"
import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"

const chords: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 8, symbol: "Am", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 8, durationBeats: 8, symbol: "F", bass: null },
  { id: "c3", sectionId: "s1", startBeat: 16, durationBeats: 8, symbol: "C", bass: null },
  { id: "c4", sectionId: "s1", startBeat: 24, durationBeats: 8, symbol: "G", bass: null },
]
const totalBeats = 32

function gen(overrides: Partial<GenerateProfileBatchInput>): ReturnType<typeof generateFromChordsWithProfiles> {
  return generateFromChordsWithProfiles({
    chords,
    sectionId: "s1",
    sectionRole: "verse",
    songProfile: "original-custom",
    density: "balanced",
    range: { low: 60, high: 77 },
    drama: "growing",
    totalBeats,
    seed: 1,
    profiles: ["standard"],
    ...overrides,
  })
}


function stripIds(notes: MelodyNote[]) {
  return notes.map(({ startBeat, durationBeats, pitch, velocity, locks }) => ({ startBeat, durationBeats, pitch, velocity, locks }))
}

describe("Custom Range: 生成音が指定範囲を外れない", () => {
  const ranges: RangeSetting[] = [
    { low: 60, high: 72 },
    { low: 55, high: 67 },
    { low: 64, high: 84 },
  ]
  it.each(GENERATOR_PROFILES)("%s は全seed・全レンジで範囲内に収まる", (profile) => {
    for (const range of ranges) {
      for (let seed = 1; seed <= 30; seed++) {
        for (const c of gen({ profiles: [profile], range, seed }).candidates) {
          for (const n of c.notes) {
            expect(n.pitch).toBeGreaterThanOrEqual(range.low)
            expect(n.pitch).toBeLessThanOrEqual(range.high)
          }
        }
      }
    }
  })
})

describe("Density: 高いほどノート数が増える傾向(parametric/bespoke双方)", () => {
  const profiles: MelodyGeneratorProfile[] = ["standard", "rhythmic", "elegiac-cantabile", "incantatory"]
  it.each(profiles)("%s は active の総ノート数 > sparse の総ノート数", (profile) => {
    let sparseTotal = 0
    let activeTotal = 0
    for (let seed = 1; seed <= 40; seed++) {
      const sparse = (["sparse"] as Density[]).flatMap(() => gen({ profiles: [profile], density: "sparse", seed }).candidates)
      const active = (["active"] as Density[]).flatMap(() => gen({ profiles: [profile], density: "active", seed }).candidates)
      sparseTotal += sparse.reduce((a, c) => a + c.notes.length, 0)
      activeTotal += active.reduce((a, c) => a + c.notes.length, 0)
    }
    expect(activeTotal).toBeGreaterThan(sparseTotal)
  })
})

describe("Syncopation: syncopationAmountが高いほどオフビート開始が増える(parametric)", () => {
  // syncopationRatio(全体)はDensityがNote Durationを変えるため交絡する(Sparseの長い不規則音価が
  // 自然なオフビートを生む)。ここではDensityを固定し、syncopationAmountだけを変えて
  // Rhythm Motifのオフビート開始率が単調に増えることを直接検証する(Issue #13の配線の本質)。
  function offbeatRate(sync: number): number {
    const params = { ...resolveGenerationParams("original-custom", "verse", "balanced", "growing"), syncopationAmount: sync }
    let off = 0
    let total = 0
    for (let seed = 1; seed <= 400; seed++) {
      for (const e of generateRhythmMotif(new SeededRandom(seed * 101 + 7), "balanced", params)) {
        if (e.isRest) continue
        total++
        if (Math.abs((e.offsetBeats % 1) - 0.5) < 0.01) off++
      }
    }
    return off / total
  }

  it("syncopationAmount 0.15 < 0.45 < 0.80 の順にオフビート開始率が上がる", () => {
    const low = offbeatRate(0.15)
    const mid = offbeatRate(0.45)
    const high = offbeatRate(0.8)
    expect(mid).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(mid)
  })

  it("高いsyncopationAmountでは、裏拍アタックが次拍へまたがる割合も増える", () => {
    function meaningfulSyncopationRate(sync: number): number {
      const params = { ...resolveGenerationParams("original-custom", "verse", "balanced", "growing"), syncopationAmount: sync }
      let syncopated = 0
      let total = 0
      for (let seed = 1; seed <= 400; seed++) {
        for (const event of generateRhythmMotif(new SeededRandom(seed * 137 + 11), "balanced", params)) {
          if (event.isRest) continue
          total++
          const fractional = event.offsetBeats - Math.floor(event.offsetBeats)
          const nextBeat = Math.floor(event.offsetBeats) + 1
          if (fractional > 0.01 && event.offsetBeats + event.durationBeats > nextBeat + 0.01) syncopated++
        }
      }
      return syncopated / total
    }

    expect(meaningfulSyncopationRate(0.8)).toBeGreaterThan(meaningfulSyncopationRate(0.15))
  })
})

describe("Rhythm quality: 拍階層・音価・終端を人間的に保つ", () => {
  it("強拍の平均音価は弱拍より長く、同音価の機械的な連続を抑える", () => {
    const params = resolveGenerationParams("original-custom", "verse", "balanced", "growing")
    let strongDuration = 0
    let strongCount = 0
    let weakDuration = 0
    let weakCount = 0
    let maxRun = 0

    for (let seed = 1; seed <= 500; seed++) {
      let previous: number | null = null
      let run = 0
      for (const event of generateRhythmMotif(new SeededRandom(seed * 173 + 19), "balanced", params)) {
        if (event.isRest) continue
        if (previous === event.durationBeats) run++
        else run = 1
        previous = event.durationBeats
        maxRun = Math.max(maxRun, run)

        const beat = Math.round(event.offsetBeats)
        if (Math.abs(event.offsetBeats - beat) >= 0.01) continue
        if (((beat % 2) + 2) % 2 === 0) {
          strongDuration += event.durationBeats
          strongCount++
        } else {
          weakDuration += event.durationBeats
          weakCount++
        }
      }
    }

    expect(strongDuration / strongCount).toBeGreaterThan(weakDuration / weakCount)
    expect(maxRun).toBeLessThanOrEqual(3)
  })

  it("全parametric Profileの完成ノートに0.25拍未満の極短音を作らない", () => {
    const profiles: MelodyGeneratorProfile[] = ["standard", "minimal", "leaping", "rhythmic", "chromatic", "cinematic"]
    for (const profile of profiles) {
      for (let seed = 1; seed <= 50; seed++) {
        for (const candidate of gen({ profiles: [profile], seed }).candidates) {
          for (const note of candidate.notes) expect(note.durationBeats).toBeGreaterThanOrEqual(0.25)
        }
      }
    }
  }, 15_000)
})

describe("Key: parametric Profileの出力へ計測可能な差を生む", () => {
  it("Key違い(C majorとF# major)でstandardの音楽的内容が過半数のseedで変化する", () => {
    let changed = 0
    for (let seed = 1; seed <= 50; seed++) {
      const cMajor = stripIds(gen({ key: "C", seed }).candidates[0].notes)
      const fsMajor = stripIds(gen({ key: "F#", seed }).candidates[0].notes)
      if (JSON.stringify(cMajor) !== JSON.stringify(fsMajor)) changed++
    }
    expect(changed).toBeGreaterThan(25)
  })
})

describe("決定論: 同一入力(id以外)は完全再現される", () => {
  it.each(GENERATOR_PROFILES)("%s は同一seed・同一設定でid以外が一致する", (profile) => {
    const a = gen({ profiles: [profile], key: "Am", seed: 7 }).candidates.map((c) => stripIds(c.notes))
    const b = gen({ profiles: [profile], key: "Am", seed: 7 }).candidates.map((c) => stripIds(c.notes))
    expect(a).toEqual(b)
  })
})

describe("設定適用マトリクスが整合している", () => {
  it("全9 Profile × 4設定が定義され、値がapplied/not-applicableのいずれか", () => {
    for (const profile of GENERATOR_PROFILES) {
      const row = SETTINGS_APPLICABILITY[profile]
      expect(row).toBeDefined()
      for (const key of ["density", "range", "drama", "key"] as const) {
        expect(["applied", "not-applicable"]).toContain(row[key])
      }
      // Rangeは音域制約として全Profileで必ず効く
      expect(row.range).toBe("applied")
    }
  })

  it("parametric 6 Profileは全設定appliedである", () => {
    for (const profile of ["standard", "minimal", "leaping", "rhythmic", "chromatic", "cinematic"] as MelodyGeneratorProfile[]) {
      const row = SETTINGS_APPLICABILITY[profile]
      expect(row).toEqual({ density: "applied", range: "applied", drama: "applied", key: "applied" })
    }
  })

  it("profilesIgnoring はnot-applicableなProfileだけを返す", () => {
    expect(profilesIgnoring("key", ["standard", "elegiac-cantabile", "incantatory"])).toEqual(["elegiac-cantabile", "incantatory"])
    expect(profilesIgnoring("range", GENERATOR_PROFILES)).toEqual([])
    expect(profilesIgnoring("drama", ["standard"])).toEqual([])
  })
})

describe("適用外の設定は実挙動にも影響しない(表と挙動の整合)", () => {
  it("elegiac-cantabileはDrama(not-applicable)を変えても出力が変わらない", () => {
    // 表で not-applicable としたDramaが、実際にelegiacの出力を変えていないことを確認する。
    // 変わってしまうなら表が誤り(=UIの注意書きが嘘になる)。
    const dramas: Drama[] = ["restrained", "growing", "open"]
    expect(SETTINGS_APPLICABILITY["elegiac-cantabile"].drama).toBe("not-applicable")
    for (let seed = 1; seed <= 30; seed++) {
      const outputs = dramas.map((drama) => stripIds(gen({ profiles: ["elegiac-cantabile"], drama, seed }).candidates[0].notes))
      expect(outputs[1]).toEqual(outputs[0])
      expect(outputs[2]).toEqual(outputs[0])
    }
  })
})
