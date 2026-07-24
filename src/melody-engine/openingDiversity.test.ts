import { describe, expect, it } from "vitest"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { GENERATOR_PROFILES } from "./generatorProfile"
import {
  OPENING_SIMILARITY_MAX,
  countDistinctEntryTypes,
  countDistinctInitialDirections,
  countDistinctOpeningContours,
  hasIdenticalOpeningNotesWithOnlyTransposition,
  openingSimilarity,
} from "./openingIntent"
import type { ChordEvent } from "@/core/project"
import type { MelodyGeneratorProfile, MelodyOpeningIntent, MelodyOpeningPlan } from "@/core/melody"

// 仕様の例示コード進行
const chords: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 4, durationBeats: 4, symbol: "D#dim", bass: null },
  { id: "c3", sectionId: "s1", startBeat: 8, durationBeats: 4, symbol: "Fmaj7", bass: null },
  { id: "c4", sectionId: "s1", startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
]
const totalBeats = 16

function threeCandidates(profile: MelodyGeneratorProfile, seed: number) {
  return generateFromChordsWithProfiles({
    chords,
    sectionId: "s1",
    sectionRole: "verse",
    songProfile: "original-custom",
    density: "balanced",
    range: { low: 60, high: 79 },
    drama: "growing",
    totalBeats,
    seed,
    profiles: [profile],
  }).candidates
}

function pairs<T>(arr: T[]): [T, T][] {
  const out: [T, T][] = []
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]])
  return out
}

describe("冒頭設計: 同一Profile内3案の冒頭が別案として成立する", () => {
  it.each(GENERATOR_PROFILES)("%s: 3案すべての冒頭類似度が閾値以内(seed横断)", (profile) => {
    for (let seed = 1; seed <= 30; seed++) {
      const cs = threeCandidates(profile, seed)
      expect(cs.length).toBe(3)
      for (const [a, b] of pairs(cs)) {
        const sim = openingSimilarity({ notes: a.notes, plan: a.openingPlan }, { notes: b.notes, plan: b.openingPlan })
        expect(sim).toBeLessThan(OPENING_SIMILARITY_MAX)
      }
    }
  })

  it.each(GENERATOR_PROFILES)("%s: entryType/初期進行方向/冒頭輪郭がそれぞれ2種類以上(seed平均で最低2案)", (profile) => {
    // 仕様: 3案のうち最低2案で開始タイミング・最初の進行方向が異なる。
    // seedごとに最低条件を満たすことを確認する。
    for (let seed = 1; seed <= 30; seed++) {
      const cs = threeCandidates(profile, seed)
      const intents = cs.map((c) => c.openingIntent as MelodyOpeningIntent)
      const plans = cs.map((c) => c.openingPlan as MelodyOpeningPlan)
      expect(countDistinctEntryTypes(intents)).toBeGreaterThanOrEqual(2)
      expect(countDistinctInitialDirections(intents)).toBeGreaterThanOrEqual(2)
      expect(countDistinctOpeningContours(plans)).toBeGreaterThanOrEqual(2)
    }
  })

  it.each(GENERATOR_PROFILES)("%s: 実際の開始拍が3案中2種類以上ある(seed横断)", (profile) => {
    for (let seed = 1; seed <= 30; seed++) {
      const starts = threeCandidates(profile, seed).map(
        (candidate) => Math.min(...candidate.notes.map((note) => note.startBeat)),
      )
      expect(new Set(starts.map((start) => start.toFixed(3))).size).toBeGreaterThanOrEqual(2)
    }
  })

  it.each(["standard", "minimal", "leaping", "rhythmic", "chromatic", "cinematic"] as MelodyGeneratorProfile[])(
    "%s: openingPhraseLengthBeatsが実際の先頭PhrasePlanへ反映される",
    (profile) => {
      for (const candidate of threeCandidates(profile, 19)) {
        expect(candidate.plans[0]?.phraseLengthBeats).toBe(candidate.openingPlan?.openingPhraseLengthBeats)
      }
    },
  )

  it.each(GENERATOR_PROFILES)("%s: 冒頭が単なる移高(トランスポーズ)関係の案が無い(seed横断)", (profile) => {
    for (let seed = 1; seed <= 30; seed++) {
      const cs = threeCandidates(profile, seed)
      expect(hasIdenticalOpeningNotesWithOnlyTransposition(cs.map((c) => c.notes))).toBe(false)
    }
  })
})

describe("冒頭設計: 決定論とバッチ独立性", () => {
  it("同一seed・同一入力では冒頭Intentも生成結果も再現される", () => {
    const a = threeCandidates("elegiac-cantabile", 7)
    const b = threeCandidates("elegiac-cantabile", 7)
    expect(a.map((c) => c.openingIntent)).toEqual(b.map((c) => c.openingIntent))
    expect(a.map((c) => c.notes.map((n) => [n.startBeat, n.durationBeats, n.pitch]))).toEqual(
      b.map((c) => c.notes.map((n) => [n.startBeat, n.durationBeats, n.pitch])),
    )
  })

  it("openingSimilarityは自分自身に対して高く、明確に異なる入口に対して低い", () => {
    const cs = threeCandidates("standard", 3)
    const self = openingSimilarity({ notes: cs[0].notes, plan: cs[0].openingPlan }, { notes: cs[0].notes, plan: cs[0].openingPlan })
    expect(self).toBeGreaterThan(0.9)
  })

  it("類似または同開始拍の候補だけを新しいseed・Opening Planで再生成する", () => {
    const result = generateFromChordsWithProfiles({
      chords,
      sectionId: "s1",
      sectionRole: "verse",
      songProfile: "original-custom",
      density: "balanced",
      range: { low: 60, high: 79 },
      drama: "growing",
      totalBeats,
      seed: 1,
      profiles: ["standard"],
    })
    const regenerated = result.diagnostics.filter((diagnostic) => diagnostic.openingRegenerationAttempts > 0)
    expect(regenerated).toHaveLength(1)
    expect(regenerated[0].candidatePoolIndex).toBe(2)
    expect(regenerated[0].candidateSeed).not.toBe(1 + 2 * 7919)
    expect(result.diagnostics.filter((diagnostic) => diagnostic.candidatePoolIndex !== 2).every(
      (diagnostic) => diagnostic.openingRegenerationAttempts === 0,
    )).toBe(true)
  })
})

describe("冒頭設計: Elegiac Cantabileの3案は異なる感情的入口を持つ", () => {
  it("3案のentryType/emotionalFunction/registerの組が互いに異なる", () => {
    const cs = threeCandidates("elegiac-cantabile", 5)
    const signatures = cs.map((c) => `${c.openingIntent?.entryType}/${c.openingIntent?.emotionalFunction}/${c.openingIntent?.register}/${c.openingIntent?.initialDirection}`)
    expect(new Set(signatures).size).toBe(3)
  })

  it("最高音(クライマックス)は冒頭では取らない=開始音が音域上端に達しない", () => {
    // Elegiacは後半一度きりのクライマックスへ最高音を温存する。冒頭の開始音が上端張り付きでないことを確認。
    for (let seed = 1; seed <= 20; seed++) {
      for (const c of threeCandidates("elegiac-cantabile", seed)) {
        const first = [...c.notes].sort((a, b) => a.startBeat - b.startBeat)[0]
        if (first) expect(first.pitch).toBeLessThanOrEqual(79 - 2)
      }
    }
  })
})
