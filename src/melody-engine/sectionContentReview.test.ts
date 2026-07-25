import { describe, expect, it } from "vitest"
import type { ChordEvent } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { SectionContentSettings } from "@/core/sectionContent"
import { notesBeforeEntryOffset } from "@/core/sectionContent"
import { generateSectionContent } from "./generateSectionContent"
import { chordsForWindow, leadWindowOf, shiftNotesToSection, windowLengthBeats } from "./leadWindow"

const TOTAL_BEATS = 16
const BEATS_PER_BAR = 4

const CHORDS: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "Am", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 4, durationBeats: 4, symbol: "F", bass: null },
  { id: "c3", sectionId: "s1", startBeat: 8, durationBeats: 4, symbol: "C", bass: null },
  { id: "c4", sectionId: "s1", startBeat: 12, durationBeats: 4, symbol: "G", bass: null },
]

function content(patch: Partial<SectionContentSettings> = {}): SectionContentSettings {
  return { lead: "melody", accompaniment: "chords", entryOffsetBeats: 0, pickup: false, ...patch }
}

function generate(settings: SectionContentSettings, sectionRole: SectionRole, seed: number) {
  return generateSectionContent({
    chords: CHORDS,
    sectionId: "s1",
    sectionRole,
    songProfile: "dark-romantic",
    content: settings,
    range: { low: 60, high: 79 },
    totalBeats: TOTAL_BEATS,
    beatsPerBar: BEATS_PER_BAR,
    seed,
    key: "Am",
    density: "balanced",
    drama: "growing",
  })
}

const ALL_ROLES: SectionRole[] = [
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "breakdown-chorus",
  "grand-chorus",
  "c-melody",
  "bridge",
  "instrumental",
  "outro",
]

describe("PR#43 fix1 / Auto が melody を選んでも空候補にならない", () => {
  it("Autoの候補poolがmelodyのみのRole(chorus/grand-chorus)でも全候補に実音がある", () => {
    for (const sectionRole of ["chorus", "grand-chorus"] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        const { candidates } = generate(content({ lead: "auto" }), sectionRole, seed)
        expect(candidates).toHaveLength(3)
        for (const candidate of candidates) {
          expect(candidate.content).toBe("melody")
          // ここが空になるのが修正前の不具合(buildContentLayersはmelodyの実音を作らない)
          expect(candidate.notes.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it("すべてのSection RoleでAuto候補が空にならない", () => {
    for (const sectionRole of ALL_ROLES) {
      for (let seed = 1; seed <= 8; seed++) {
        const { candidates } = generate(content({ lead: "auto" }), sectionRole, seed)
        for (const candidate of candidates) {
          // content="none" は0音が正しい状態なので除く
          if (candidate.content === "none") continue
          expect(candidate.notes.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it("Autoが選んだmelody候補はlead partRoleを持つ", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { candidates } = generate(content({ lead: "auto" }), "chorus", seed)
      for (const candidate of candidates) {
        const primary = candidate.layers.find((layer) => layer.kind === "primary")!
        expect(primary.partRole).toBe("lead")
        expect(primary.content).toBe("melody")
      }
    }
  })

  it("Autoのmelody候補もentryOffsetを尊重する", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { candidates } = generate(content({ lead: "auto", entryOffsetBeats: 8 }), "chorus", seed)
      for (const candidate of candidates) {
        expect(notesBeforeEntryOffset(candidate.notes, 8)).toHaveLength(0)
        expect(candidate.notes.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("PR#43 fix4 / 構造検証違反を候補として返さない", () => {
  it("成立する設定では unresolvedCandidates が空になる", () => {
    for (const lead of ["motif", "ostinato", "drone"] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        const { unresolvedCandidates } = generate(content({ lead }), "intro", seed)
        expect(unresolvedCandidates).toEqual([])
      }
    }
  })

  it("Motifが成立しない設定(entryOffsetがセクション終端)では、黙って返さず未解決として報告する", () => {
    // 残り1拍では2〜5音の核が置けないため、何度計画を引き直しても成立しない
    const { candidates, unresolvedCandidates } = generate(
      content({ lead: "motif", entryOffsetBeats: TOTAL_BEATS - 1 }),
      "intro",
      42,
    )
    expect(unresolvedCandidates.length).toBeGreaterThan(0)
    for (const candidate of unresolvedCandidates) {
      expect(candidate.problems.length).toBeGreaterThan(0)
    }
    // 未解決でも entryOffset は破らない
    for (const candidate of candidates) {
      expect(notesBeforeEntryOffset(candidate.notes, TOTAL_BEATS - 1)).toHaveLength(0)
    }
  })

  it("作り直しで問題を悪化させない", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { candidates } = generate(content({ lead: "motif", entryOffsetBeats: 14 }), "intro", seed)
      // 成立しない設定でも、entryOffset違反のような別の問題を新たに作らない
      for (const candidate of candidates) {
        expect(candidate.problems.filter((p) => p.includes("entryOffset"))).toEqual([])
      }
    }
  })
})

describe("PR#43 fix3 / leadWindow の窓変換", () => {
  it("entryOffset/pickup未指定なら全長窓(従来と同じ)", () => {
    const window = leadWindowOf(content(), TOTAL_BEATS)
    expect(window).toEqual({ startBeat: 0, endBeat: TOTAL_BEATS, pickupBeats: 0 })
    expect(chordsForWindow(CHORDS, window)).toEqual(CHORDS)
  })

  it("entryOffset指定で窓が縮み、コードが窓相対へ変換される", () => {
    const window = leadWindowOf(content({ entryOffsetBeats: 8 }), TOTAL_BEATS)
    expect(window.startBeat).toBe(8)
    expect(windowLengthBeats(window)).toBe(8)
    const windowChords = chordsForWindow(CHORDS, window)
    expect(windowChords.map((c) => [c.startBeat, c.durationBeats, c.symbol])).toEqual([
      [0, 4, "C"],
      [4, 4, "G"],
    ])
  })

  it("pickup指定で窓の末尾が弱起ぶん短くなる", () => {
    const window = leadWindowOf(content({ pickup: true }), TOTAL_BEATS)
    expect(window.pickupBeats).toBe(1)
    expect(window.endBeat).toBe(TOTAL_BEATS - 1)
  })

  it("窓相対のノートをセクション相対へ戻せる", () => {
    const window = leadWindowOf(content({ entryOffsetBeats: 8 }), TOTAL_BEATS)
    const shifted = shiftNotesToSection(
      [{ id: "n1", startBeat: 0, durationBeats: 1, pitch: 60, velocity: 80, locks: [] }],
      window,
    )
    expect(shifted[0].startBeat).toBe(8)
  })

  it("コード境界をまたぐコードは窓の境界で切られる", () => {
    const window = leadWindowOf(content({ entryOffsetBeats: 6 }), TOTAL_BEATS)
    const windowChords = chordsForWindow(CHORDS, window)
    // 4-8拍のFは6拍から始まる2拍分になる
    expect(windowChords[0]).toMatchObject({ startBeat: 0, durationBeats: 2, symbol: "F" })
  })
})
