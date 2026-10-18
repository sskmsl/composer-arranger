import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import type { MelodyVariant } from "@/core/melody"
import { repeatedSectionSource, varyRepeatedSection } from "./repeatedSectionMelody"

beforeEach(() => {
  let serial = 0
  vi.spyOn(Math, "random").mockReturnValue(.25)
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`)
})
afterEach(() => vi.restoreAllMocks())

function setup() {
  const project = arrangementReviewSong("A")
  const source: MelodyVariant = { id: "source", name: "source", sectionId: project.sections[1].id, sourceMode: "generate",
    notes: Array.from({ length: 32 }, (_, i) => ({ id: `n${i}`, startBeat: i, durationBeats: 0.5, pitch: 65 + i % 4, velocity: 80, locks: [] })),
    phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "test", seed: 1, songProfile: "original-custom", parentMelodyId: null, batchId: "test", createdAt: "2026-10-15T00:00:00Z" }
  project.melodyVariants = [source]
  project.sectionMelodyAssignments[source.sectionId] = source.id
  return { project, source, target: project.sections[4].id }
}
describe("反復セクションの旋律", () => {
  it("次音またはコード終端まで0.1拍残らない変奏は移動を抑え、音数・強拍を保つ", () => {
    const { project, source, target } = setup()
    source.notes = [
      { ...source.notes[0], startBeat: 0, durationBeats: 1 },
      { ...source.notes[1], startBeat: 8, durationBeats: .2 },
      { ...source.notes[2], startBeat: 11.748, durationBeats: .237 },
      { ...source.notes[3], startBeat: 12, durationBeats: .485 },
      { ...source.notes[4], startBeat: 23.7469, durationBeats: .4875 },
      { ...source.notes[5], startBeat: 24.2531, durationBeats: .2319 },
      { ...source.notes[6], startBeat: 30, durationBeats: 2 },
    ]
    const before = structuredClone(source)
    for (const pattern of [1, 2, 3] as const) {
      const notes = varyRepeatedSection(source, project, target, 32, 4, { low: 60, high: 77 }, 12, pattern)
      expect(notes).toHaveLength(source.notes.length)
      expect(notes.every((n) => n.durationBeats >= .1)).toBe(true)
      expect(notes[2].startBeat).toBeLessThanOrEqual(11.9)
      expect(notes[4].startBeat).toBeLessThanOrEqual(23.9)
      expect(notes.find((n) => n.startBeat === 12)).toBeDefined()
      expect(notes.every((n, i) => !notes[i + 1] || n.startBeat + n.durationBeats <= notes[i + 1].startBeat + 1e-9)).toBe(true)
    }
    expect(source).toEqual(before)
  })
  it("土台にある1拍以上の休符の位置を変奏でも保つ", () => {
    const { project, source, target } = setup()
    source.notes = source.notes.filter((n) => n.startBeat !== 15)
    for (const pattern of [1, 2, 3] as const) {
      const notes = varyRepeatedSection(source, project, target, 32, 4, { low: 60, high: 77 }, 12, pattern)
      expect(notes.find((n) => n.startBeat === 14)?.durationBeats).toBe(0.5)
      expect(notes.some((n) => n.startBeat > 14 && n.startBeat < 16)).toBe(false)
      expect(notes.some((n) => n.startBeat === 16)).toBe(true)
    }
  })
  it("冒頭に重なる音があっても、冒頭2小節の長さと強弱を変えない", () => {
    const { project, source, target } = setup()
    source.notes[0].durationBeats = 2
    const hook = structuredClone(source.notes.filter((n) => n.startBeat < 8))
    for (const pattern of [1, 2, 3] as const) {
      const result = varyRepeatedSection(source, project, target, 32, 4, { low: 60, high: 77 }, 12, pattern)
      expect(result.filter((n) => n.startBeat < 8)).toEqual(hook)
    }
  })
  it("コード・長さ・役割が一致するときだけ前の採用済み旋律を参照する", () => {
    const { project, source, target } = setup()
    expect(repeatedSectionSource(project, target)).toBe(source)
    project.chords.find((c) => c.sectionId === target)!.symbol = "C"
    expect(repeatedSectionSource(project, target)).toBeUndefined()
  })
  it("再生成と取り込み旋律は土台にせず、変奏後も元の旋律を変えない", () => {
    const { project, source, target } = setup()
    const before = structuredClone(source)
    varyRepeatedSection(source, project, target, 32, 4, { low: 60, high: 77 }, 12)
    expect(source).toEqual(before)
    project.melodyVariants.push({ ...source, id: "target", sectionId: target })
    expect(repeatedSectionSource(project, target)).toBeUndefined()
  })
})
