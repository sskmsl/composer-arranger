import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import { generateCounterCandidates } from "./counterGenerator"
import { unresolvedReactiveToneNoteIds } from "./reactiveLayerAnalysis"

function note(id: string, startBeat: number, durationBeats: number, pitch: number): MelodyNote {
  return { id, startBeat, durationBeats, pitch, velocity: 80, locks: [] }
}

function melody(): MelodyVariant {
  return {
    id: "melody-a",
    name: "Active Melody",
    sectionId: "s1",
    sourceMode: "generate",
    notes: [
      note("m1", 0, 1, 64),
      note("m2", 2, 1, 67),
      note("m3", 4, 1, 69),
      note("m4", 6, 1, 72),
      note("m5", 8, 1, 71),
      note("m6", 10, 1, 69),
      note("m7", 12, 1, 67),
      note("m8", 14, 1, 64),
    ],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "melody-batch",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

const input = {
  sectionId: "s1",
  sectionRole: "verse" as const,
  songProfile: "dark-romantic" as const,
  chords: parseChordInputText("Am | F | C | G", "s1", 4, "c"),
  melody: melody(),
  totalBeats: 16,
  seed: 42,
}

describe("Issue #70 / Counter Generator MVP", () => {
  it("9案から品質と多様性を考慮した独立3候補を選ぶ", () => {
    const candidates = generateCounterCandidates(input)
    expect(candidates).toHaveLength(3)
    expect(new Set(candidates.map((candidate) => candidate.generatorStyle)).size).toBeGreaterThanOrEqual(2)
    expect(new Set(candidates.map((candidate) => candidate.role)).size).toBeGreaterThanOrEqual(2)
    expect(candidates[0].selectionReason).toBe("highest-quality")
    expect(candidates.slice(1).every((candidate) => candidate.selectionReason === "quality-diversity-balance")).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length > 0)).toBe(true)
    expect(candidates.every((candidate) => unresolvedReactiveToneNoteIds(candidate.notes).length === 0)).toBe(true)
  })

  it("主旋律の休符へ配置し、Blocking Collisionを作らない", () => {
    const candidates = generateCounterCandidates(input)
    for (const candidate of candidates) {
      expect(candidate.quality.gapUsage).toBe(100)
      expect(candidate.collisions.hasBlockingCollision).toBe(false)
      expect(candidate.notes.every((counterNote) => Math.floor(counterNote.startBeat) % 2 === 1)).toBe(true)
    }
  })

  it("同じseedと入力なら音程・リズム・Styleを再現する", () => {
    const first = generateCounterCandidates(input)
    const second = generateCounterCandidates(input)
    const signature = (candidate: (typeof first)[number]) => ({
      style: candidate.generatorStyle,
      role: candidate.role,
      notes: candidate.notes.map((item) => [
        item.startBeat,
        item.durationBeats,
        item.pitch,
        item.velocity,
      ]),
    })
    expect(second.map(signature)).toEqual(first.map(signature))
  })

  it("十分な休符がない場合は空候補となり、主旋律へ無理に重ねない", () => {
    const continuous = {
      ...input,
      melody: {
        ...input.melody,
        notes: [note("held", 0, 16, 64)],
      },
    }
    expect(generateCounterCandidates(continuous)).toHaveLength(0)
  })
})
