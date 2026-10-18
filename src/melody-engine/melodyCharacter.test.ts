import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { melodyCharacterReviewSong } from "@/store/melodyCharacterReviewFixtures"
import { applyMelodyCharacter, planMelodyCharacter } from "./melodyCharacter"
import { resolveGenerationParams } from "./generationParams"

beforeEach(() => {
  let serial = 0
  vi.spyOn(Math, "random").mockReturnValue(.25)
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`)
})
afterEach(() => vi.restoreAllMocks())

describe("曲とセクションの旋律性格目標", () => {
  it("同じseedと音楽情報なら同じ目標で、UUIDには依存しない", () => {
    const { project, seed, style, tempo } = melodyCharacterReviewSong(0)
    const input = { seed, style, tempo, role: "verse" as const, chords: project.chords, range: { low: 60, high: 77 } }
    const first = planMelodyCharacter(input)
    expect(first).toEqual(planMelodyCharacter(input))
    expect(first).toEqual(planMelodyCharacter({ ...input, chords: project.chords.map((c) => ({ ...c, id: "other", sectionId: "different" })) }))
    expect(planMelodyCharacter({ ...input, seed: seed + 1 })).not.toEqual(first)
  })
  it("全24曲の目標は許容範囲内で、サビにはより広い窓を用意する", () => {
    for (let i = 0; i < 24; i++) {
      const f = melodyCharacterReviewSong(i), plans = f.project.sections.map((s) => planMelodyCharacter({ seed: f.seed,
        chords: f.project.chords.filter((c) => c.sectionId === s.id), tempo: f.tempo, style: f.style, role: s.role, range: { low: 60, high: 77 } }))
      for (const p of plans) {
        expect(p.range.low).toBeGreaterThanOrEqual(60); expect(p.range.high).toBeLessThanOrEqual(77)
        expect(p.rangeSpan).toBeGreaterThanOrEqual(8); expect(p.rangeSpan).toBeLessThanOrEqual(17)
        expect(p.longNoteRatio).toBeGreaterThanOrEqual(.10); expect(p.longNoteRatio).toBeLessThanOrEqual(.80)
        expect(p.offbeatRatio).toBeGreaterThanOrEqual(.05); expect(p.offbeatRatio).toBeLessThanOrEqual(.65)
        expect(p.notesPerBeat).toBeGreaterThanOrEqual(.55); expect(p.notesPerBeat).toBeLessThanOrEqual(1.4)
      }
      expect(plans[1].rangeSpan - plans[0].rangeSpan).toBeGreaterThanOrEqual(2)
    }
  })
  it("旧入力は不変、目標の適用でも既存パラメータを破壊しない", () => {
    const params = resolveGenerationParams("dark-romantic", "verse", "balanced", "growing", "Am")
    const before = structuredClone(params)
    expect(applyMelodyCharacter(params)).toBe(params)
    const f = melodyCharacterReviewSong(0), plan = planMelodyCharacter({ seed: f.seed, chords: f.project.chords,
      tempo: f.tempo, style: f.style, role: "verse", range: { low: 60, high: 77 } })
    expect(applyMelodyCharacter(params, plan).melodyCharacter).toEqual(plan)
    expect(params).toEqual(before)
  })
})
