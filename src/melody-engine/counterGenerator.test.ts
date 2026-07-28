import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import {
  evaluateCounterpointFit,
  generateCounterCandidates,
} from "./counterGenerator"
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
  key: "Am",
  chords: parseChordInputText("Am | F | C | G", "s1", 4, "c"),
  melody: melody(),
  totalBeats: 16,
  seed: 42,
}

describe("Issue #70 / Counter Generator MVP", () => {
  it("拡張候補プールから品質と多様性を考慮した独立3候補を選ぶ", () => {
    const candidates = generateCounterCandidates(input)
    expect(
      candidates,
      JSON.stringify(
        candidates.map((candidate) => ({
          style: candidate.generatorStyle,
          quality: candidate.quality,
          collisions: candidate.collisions,
          notes: candidate.notes.map((item) => [
            item.startBeat,
            item.durationBeats,
            item.pitch,
          ]),
        })),
      ),
    ).toHaveLength(3)
    expect(new Set(candidates.map((candidate) => candidate.generatorStyle)).size).toBeGreaterThanOrEqual(2)
    expect(new Set(candidates.map((candidate) => candidate.role)).size).toBeGreaterThanOrEqual(2)
    expect(
      new Set(
        candidates.map((candidate) =>
          candidate.notes
            .map(
              (item) =>
                `${item.startBeat}:${item.durationBeats}:${item.pitch}`,
            )
            .join("|"),
        ),
      ).size,
    ).toBe(3)
    expect(candidates[0].selectionReason).toBe("highest-quality")
    expect(candidates.slice(1).every((candidate) => candidate.selectionReason === "quality-diversity-balance")).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length > 0)).toBe(true)
    expect(candidates.every((candidate) => unresolvedReactiveToneNoteIds(candidate.notes).length === 0)).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length >= 3)).toBe(true)
    expect(
      candidates.every((candidate) => {
        const first = candidate.notes[0]
        const last = candidate.notes.at(-1)!
        return last.startBeat + last.durationBeats - first.startBeat >= 1
      }),
    ).toBe(true)
    const hasStepwiseCandidate = candidates.some(
        (candidate) =>
          candidate.notes.length >= 2 &&
          candidate.notes.slice(1).every((item, index) => {
            const interval = Math.abs(item.pitch - candidate.notes[index].pitch)
            return interval > 0 && interval <= 3
          }),
      )
    expect(
      hasStepwiseCandidate,
      JSON.stringify(
        candidates.map((candidate) => ({
          style: candidate.generatorStyle,
          quality: candidate.quality,
          pitches: candidate.notes.map((item) => item.pitch),
        })),
      ),
    ).toBe(true)
    expect(candidates.every((candidate) => candidate.quality.overallQuality >= 68)).toBe(true)
  })

  it("主旋律の休符へ配置し、Blocking Collisionを作らない", () => {
    const candidates = generateCounterCandidates(input)
    for (const candidate of candidates) {
      expect(candidate.quality.gapUsage).toBeGreaterThanOrEqual(99.9)
      expect(candidate.collisions.hasBlockingCollision).toBe(false)
      expect(Math.floor(candidate.notes[0].startBeat) % 2).toBe(1)
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

  it("異なるseedでも単音候補へ退行しない", () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const candidates = generateCounterCandidates({ ...input, seed })
      expect(candidates).toHaveLength(3)
      expect(candidates.every((candidate) => candidate.notes.length >= 3)).toBe(true)
    }
  })

  it("Bell Response/String Answerは一直線の音階だけでなくアーチ型(折り返し)の輪郭も生成する", () => {
    // 回帰: bell-response/string-answer/synth-whisperは常にinverseDirection一本の
    // 単調な音階(常に上行 or 常に下行)しか生成できず、折り返しのある輪郭が
    // 一切現れなかった。折り返しを許容してもフレーズ末尾の和声着地は保たれることを
    // 併せて確認する。
    const shapesByStyle: Record<string, Set<string>> = {
      "bell-response": new Set(),
      "string-answer": new Set(),
    }
    for (let seed = 1; seed <= 150; seed++) {
      const candidates = generateCounterCandidates({ ...input, seed })
      for (const candidate of candidates) {
        const style = candidate.generatorStyle!
        if (!(style in shapesByStyle)) continue
        const signs = candidate.notes
          .slice(1)
          .map((note, index) => Math.sign(note.pitch - candidate.notes[index].pitch))
        const hasUp = signs.includes(1)
        const hasDown = signs.includes(-1)
        shapesByStyle[style].add(hasUp && hasDown ? "arc" : hasUp ? "up-only" : "down-only")
      }
    }
    expect(shapesByStyle["bell-response"].has("arc")).toBe(true)
    expect(shapesByStyle["string-answer"].has("arc")).toBe(true)
    expect(
      generateCounterCandidates(input).every(
        (candidate) => unresolvedReactiveToneNoteIds(candidate.notes).length === 0,
      ),
    ).toBe(true)
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

  it("最高音ではないロングトーンの後半をCounter Windowとして利用する", () => {
    const sustained = {
      ...input,
      melody: {
        ...input.melody,
        notes: [
          note("opening-high", 0, 1, 72),
          note("sustain", 1, 3, 64),
          note("closing-high", 4, 12, 72),
        ],
      },
    }
    const candidates = generateCounterCandidates(sustained)
    expect(candidates.length).toBeGreaterThan(0)
    expect(
      candidates.some((candidate) =>
        candidate.notes.some(
          (counterNote) =>
            counterNote.startBeat >= 1.75 && counterNote.startBeat < 3.75,
        ),
      ),
    ).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length >= 3)).toBe(true)
  })

  it("主旋律との協和と反行・斜行を持つCounterを高く評価する", () => {
    const lead = [
      note("lead-1", 0, 2, 72),
      note("lead-2", 2, 2, 74),
      note("lead-3", 4, 2, 76),
    ]
    const independent = [
      note("independent-1", 0, 1, 64),
      note("independent-2", 2, 1, 62),
      note("independent-3", 4, 1, 60),
    ]
    const colliding = [
      note("colliding-1", 0, 1, 71),
      note("colliding-2", 2, 1, 73),
      note("colliding-3", 4, 1, 75),
    ]
    const chords = parseChordInputText("C | Dm", "s1", 4, "c")
    expect(
      evaluateCounterpointFit(lead, independent, chords),
    ).toBeGreaterThan(evaluateCounterpointFit(lead, colliding, chords))
  })
})
