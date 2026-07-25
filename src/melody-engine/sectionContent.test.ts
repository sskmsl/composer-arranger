import { describe, expect, it } from "vitest"
import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import type { SectionContentSettings } from "@/core/sectionContent"
import { notesBeforeEntryOffset, partRoleFor } from "@/core/sectionContent"
import { generateSectionContent, type SectionContentCandidate } from "./generateSectionContent"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import {
  contentSimilarity,
  detectPeriodicity,
  hasSharedBaseMelody,
  isOnlyTransposedCopy,
  CONTENT_SIMILARITY_MAX,
} from "./contentStructure"
import {
  planAutoContentBatch,
  planAutoReplacement,
  planDifferenceCount,
  planReplacement,
  planSectionContentBatch,
  type ContentPlanContext,
} from "./sectionContentPlan"
import { buildHarmonicMap } from "./harmonicMap"
import { SeededRandom } from "@/core/rng"

const TOTAL_BEATS = 16
const BEATS_PER_BAR = 4

/** 4小節 / 1小節1コードの固定進行(固定seedの再現性検証に使う) */
const CHORDS: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "Am", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 4, durationBeats: 4, symbol: "F", bass: null },
  { id: "c3", sectionId: "s1", startBeat: 8, durationBeats: 4, symbol: "C", bass: null },
  { id: "c4", sectionId: "s1", startBeat: 12, durationBeats: 4, symbol: "G", bass: null },
]

function content(patch: Partial<SectionContentSettings> = {}): SectionContentSettings {
  return { lead: "melody", accompaniment: "chords", entryOffsetBeats: 0, pickup: false, ...patch }
}

function generate(settings: SectionContentSettings, seed = 12345): SectionContentCandidate[] {
  return generateSectionContent({
    chords: CHORDS,
    sectionId: "s1",
    sectionRole: "intro",
    songProfile: "dark-romantic",
    content: settings,
    range: { low: 60, high: 79 },
    totalBeats: TOTAL_BEATS,
    beatsPerBar: BEATS_PER_BAR,
    seed,
    key: "Am",
  }).candidates
}

function planContext(): ContentPlanContext {
  return {
    totalBeats: TOTAL_BEATS,
    beatsPerBar: BEATS_PER_BAR,
    sectionRole: "intro",
    songProfile: "dark-romantic",
    harmonicMap: buildHarmonicMap(CHORDS),
    range: { low: 60, high: 79 },
    keyScale: [9, 11, 0, 2, 4, 5, 7],
    requestedEntryOffsetBeats: 0,
    requestedPickup: false,
  }
}

/** id は生成ごとにUUIDで変わるため、実音の同一性だけを比較する */
function musicalShape(notes: MelodyNote[]) {
  return notes.map((n) => [n.startBeat, n.durationBeats, n.pitch, n.velocity])
}

describe("Issue #41 / Content別Generatorが専用の文法を通る", () => {
  it("Motifは2〜5音の核を持ち、余白を挟んで疎に反復する", () => {
    for (const candidate of generate(content({ lead: "motif" }))) {
      expect(candidate.content).toBe("motif")
      expect(candidate.plan.cellDurations.length).toBeGreaterThanOrEqual(2)
      expect(candidate.plan.cellDurations.length).toBeLessThanOrEqual(5)
      expect(candidate.plan.recurrenceStrategy).toBe("sparse-return")
      // 隙間なく詰まっていない(通常フレーズ化していない)
      expect(candidate.features.restRatio).toBeGreaterThan(0.1)
      expect(candidate.problems).toEqual([])
    }
  })

  it("Ostinatoは周期性を持ち、最低2周期以上を同じ周期位置へ再出現させる", () => {
    for (const candidate of generate(content({ lead: "ostinato" }))) {
      expect(candidate.content).toBe("ostinato")
      expect(candidate.plan.recurrenceStrategy).toBe("periodic-cycle")
      expect(candidate.plan.repetitionCount).toBeGreaterThanOrEqual(2)
      const periodicity = detectPeriodicity(candidate.notes, candidate.plan.cellLengthBeats)
      expect(periodicity.strength).toBeGreaterThan(0.5)
      expect(candidate.problems).toEqual([])
    }
  })

  it("Droneは1〜2ピッチクラスと高いsustain比率を満たす", () => {
    for (const candidate of generate(content({ lead: "drone" }))) {
      expect(candidate.content).toBe("drone")
      expect(candidate.features.pitchClassCardinality).toBeLessThanOrEqual(2)
      expect(candidate.features.pitchClassCardinality).toBeGreaterThanOrEqual(1)
      expect(candidate.features.sustainRatio).toBeGreaterThan(0.8)
      expect(candidate.problems).toEqual([])
    }
  })

  it("Droneの保持音はコード境界で分割・再スナップされない", () => {
    for (const candidate of generate(content({ lead: "drone" }))) {
      // コード境界は4/8/12拍。保持音がそこで切られていないこと
      const boundaries = [4, 8, 12]
      const crossing = candidate.notes.filter((note) =>
        boundaries.some((b) => note.startBeat < b - 1e-6 && note.startBeat + note.durationBeats > b + 1e-6),
      )
      expect(crossing.length).toBeGreaterThan(0)
      // 保持中にピッチクラスが差し替わっていない
      const classes = new Set(candidate.notes.map((n) => ((n.pitch % 12) + 12) % 12))
      expect(classes.size).toBeLessThanOrEqual(2)
    }
  })

  it("Ostinato / Drone は伴奏パートとして扱われる", () => {
    expect(partRoleFor("ostinato")).toBe("accompaniment")
    expect(partRoleFor("drone")).toBe("accompaniment")
    expect(partRoleFor("motif")).toBe("lead")
    expect(partRoleFor("melody")).toBe("lead")
  })
})

describe("Issue #41 / none と entryOffset", () => {
  it("noneのprimary Layerはノート数0で、エラー扱いにしない", () => {
    for (const candidate of generate(content({ lead: "none", accompaniment: "chords" }))) {
      const primary = candidate.layers.find((l) => l.kind === "primary")
      expect(primary).toBeDefined()
      expect(primary!.notes).toHaveLength(0)
      expect(candidate.problems).toEqual([])
    }
  })

  it("pickupが有効なときだけ、末尾に弱起Layerを作る", () => {
    const withPickup = generate(content({ lead: "none", pickup: true, entryOffsetBeats: 15 }))
    const pickupLayers = withPickup.flatMap((c) => c.layers.filter((l) => l.kind === "pickup"))
    expect(pickupLayers.length).toBeGreaterThan(0)
    for (const layer of pickupLayers) {
      expect(layer.notes.length).toBeGreaterThan(0)
      // 弱起はセクション末尾側にある
      for (const note of layer.notes) expect(note.startBeat).toBeGreaterThanOrEqual(15 - 1e-6)
    }

    const withoutPickup = generate(content({ lead: "none", pickup: false }))
    expect(withoutPickup.flatMap((c) => c.layers.filter((l) => l.kind === "pickup"))).toHaveLength(0)
  })

  it("entryOffsetで指定した無音区間へノートが侵入しない", () => {
    for (const lead of ["motif", "ostinato", "drone", "none"] as const) {
      for (const entryOffsetBeats of [4, 8, 12]) {
        for (const candidate of generate(content({ lead, entryOffsetBeats, pickup: true }))) {
          expect(notesBeforeEntryOffset(candidate.notes, entryOffsetBeats)).toHaveLength(0)
        }
      }
    }
  })

  it("完全無音(entryOffset = セクション長)ではリードノートが1音も出ない", () => {
    for (const candidate of generate(content({ lead: "none", entryOffsetBeats: TOTAL_BEATS, pickup: true }))) {
      expect(candidate.notes).toHaveLength(0)
    }
  })

  it("全ノートがセクション範囲内に収まる", () => {
    for (const lead of ["motif", "ostinato", "drone"] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        for (const candidate of generate(content({ lead, pickup: true }), seed)) {
          for (const note of candidate.notes) {
            expect(note.startBeat).toBeGreaterThanOrEqual(0)
            expect(note.startBeat + note.durationBeats).toBeLessThanOrEqual(TOTAL_BEATS + 1e-6)
          }
        }
      }
    }
  })
})

describe("Issue #41 / 「ラベルだけ違い実音が似る」状態の検出", () => {
  it("melody と motif が同じBase Melodyを共有しない", () => {
    const motifs = generate(content({ lead: "motif" }))
    const { candidates: melodyCandidates } = generateFromChordsWithProfiles({
      chords: CHORDS,
      sectionId: "s1",
      sectionRole: "intro",
      songProfile: "dark-romantic",
      density: "balanced",
      range: { low: 60, high: 79 },
      drama: "growing",
      totalBeats: TOTAL_BEATS,
      seed: 12345,
      profiles: ["standard"],
      key: "Am",
    })

    for (const melody of melodyCandidates) {
      for (const motif of motifs) {
        expect(hasSharedBaseMelody(melody.notes, motif.notes)).toBe(false)
      }
    }
  })

  it("motif と ostinato が同じ音列・同じ周期にならない", () => {
    const motifs = generate(content({ lead: "motif" }))
    const ostinatos = generate(content({ lead: "ostinato" }))
    for (const motif of motifs) {
      for (const ostinato of ostinatos) {
        expect(hasSharedBaseMelody(motif.notes, ostinato.notes)).toBe(false)
      }
    }
  })

  it("同一content内の候補が単なる移高コピーにならない", () => {
    for (const lead of ["motif", "ostinato", "drone"] as const) {
      const candidates = generate(content({ lead }))
      for (let a = 0; a < candidates.length; a++) {
        for (let b = a + 1; b < candidates.length; b++) {
          expect(isOnlyTransposedCopy(candidates[a].notes, candidates[b].notes)).toBe(false)
        }
      }
    }
  })

  it("同一content内の候補の構造類似度が閾値未満に収まる", () => {
    for (const lead of ["motif", "ostinato", "drone"] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const candidates = generate(content({ lead }), seed)
        for (let a = 0; a < candidates.length; a++) {
          for (let b = a + 1; b < candidates.length; b++) {
            const similarity = contentSimilarity(candidates[a].features, candidates[b].features).overall
            expect(similarity).toBeLessThan(CONTENT_SIMILARITY_MAX)
          }
        }
      }
    }
  })

  it("Droneの計画が約束する語彙と実際に鳴る語彙が一致する", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate(content({ lead: "drone" }), seed)) {
        const sounding = new Set(candidate.notes.map((n) => ((n.pitch % 12) + 12) % 12))
        expect(sounding.size).toBe(candidate.plan.pitchVocabulary.length)
        for (const pc of sounding) expect(candidate.plan.pitchVocabulary).toContain(pc)
      }
    }
  })

  it("類似候補の作り直しでは、seedだけでなくContent Planも変わる", () => {
    const ctx = planContext()
    for (const lead of ["motif", "ostinato", "drone"] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const existing = planSectionContentBatch(new SeededRandom(seed), lead, ctx, 3)
        // 3案のうち1案を作り直す想定: 残り2案と構造が異なる計画が選ばれること
        const kept = existing.slice(0, 2)
        const replacement = planReplacement(new SeededRandom(seed ^ 0x9e3779b1), lead, ctx, kept)
        for (const plan of kept) {
          expect(planDifferenceCount(plan, replacement)).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it("Autoの作り直しでは、可能なら別のcontentへ切り替える", () => {
    const ctx = planContext()
    for (let seed = 1; seed <= 20; seed++) {
      const existing = planAutoContentBatch(new SeededRandom(seed), ctx, 3)
      const kept = existing.slice(0, 2)
      const replacement = planAutoReplacement(new SeededRandom(seed ^ 0x51ed270b), ctx, kept)
      for (const plan of kept) {
        expect(planDifferenceCount(plan, replacement)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it("同一contentの3案が最低3つの構造項目で異なる", () => {
    const rng = new SeededRandom(4242)
    for (const lead of ["motif", "ostinato", "drone"] as const) {
      const plans = planSectionContentBatch(rng, lead, planContext(), 3)
      for (let a = 0; a < plans.length; a++) {
        for (let b = a + 1; b < plans.length; b++) {
          expect(planDifferenceCount(plans[a], plans[b])).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})

describe("Issue #41 / Auto", () => {
  it("3候補で最低2種類以上のcontentを提示する", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const candidates = generate(content({ lead: "auto" }), seed)
      expect(candidates).toHaveLength(3)
      expect(new Set(candidates.map((c) => c.content)).size).toBeGreaterThanOrEqual(2)
    }
  })

  it("Pattern番号へgrammarを固定割り当てしない(seedによって並びが変わる)", () => {
    const sequences = new Set<string>()
    for (let seed = 1; seed <= 30; seed++) {
      sequences.add(generate(content({ lead: "auto" }), seed).map((c) => c.content).join(">"))
    }
    expect(sequences.size).toBeGreaterThan(1)
  })
})

describe("Issue #41 / 決定論", () => {
  it("固定seedでContent PlanとNotesを再現できる", () => {
    for (const lead of ["motif", "ostinato", "drone", "none", "auto"] as const) {
      const first = generate(content({ lead, pickup: true }), 777)
      const second = generate(content({ lead, pickup: true }), 777)
      expect(first.map((c) => c.plan)).toEqual(second.map((c) => c.plan))
      expect(first.map((c) => musicalShape(c.notes))).toEqual(second.map((c) => musicalShape(c.notes)))
    }
  })

  it("Candidate / Layer / Notes 間で参照を共有しない", () => {
    const [candidate] = generate(content({ lead: "motif" }))
    const primary = candidate.layers.find((l) => l.kind === "primary")!
    // notes は Layer のノートを平坦化した別配列
    expect(candidate.notes).not.toBe(primary.notes)
    // 片方を変更しても他方へ波及しない
    const snapshot = musicalShape(primary.notes)
    candidate.notes.length = 0
    expect(musicalShape(primary.notes)).toEqual(snapshot)
  })
})
