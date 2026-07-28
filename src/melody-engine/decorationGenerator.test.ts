import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import {
  DEFAULT_DECORATION_SETTINGS,
  generateDecorationCandidates,
  type GenerateDecorationInput,
} from "./decorationGenerator"
import { unresolvedReactiveToneNoteIds } from "./reactiveLayerAnalysis"

function input(
  patch: Partial<GenerateDecorationInput> = {},
): GenerateDecorationInput {
  return {
    sectionId: "verse",
    sectionRole: "pre-chorus",
    songProfile: "dark-romantic",
    chords: parseChordInputText("Am | F | C | G", "verse", 4, "c"),
    totalBeats: 16,
    beatsPerBar: 4,
    key: "Am",
    seed: 42,
    settings: DEFAULT_DECORATION_SETTINGS,
    previousSectionRole: "verse",
    nextSectionRole: "chorus",
    nextSectionFirstChord: "Cmaj7",
    isLastSection: false,
    ...patch,
  }
}

describe("Issue #71 / Structure Driven Decoration Generator", () => {
  it("Active Melodyなしでも品質・多様性選抜した10候補を生成する", () => {
    const candidates = generateDecorationCandidates(input())
    expect(candidates).toHaveLength(10)
    expect(candidates.every((candidate) => candidate.kind === "decoration")).toBe(true)
    expect(candidates.every((candidate) => candidate.targetMelodyVariantId === null)).toBe(true)
    expect(new Set(candidates.map((candidate) => candidate.decorationPlan?.shape)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(candidates.map((candidate) => candidate.decorationPlan?.rhythmStyle)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(candidates.map((candidate) => candidate.decorationPlan?.register)).size).toBeGreaterThanOrEqual(2)
    expect(candidates.every((candidate) => unresolvedReactiveToneNoteIds(candidate.notes).length === 0)).toBe(true)
    expect(candidates.every((candidate) => candidate.quality.overallQuality >= 68)).toBe(true)
    expect(candidates.every((candidate) => candidate.quality.transitionValue >= 78)).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length >= 3)).toBe(true)
    expect(
      new Set(
        candidates.map((candidate) =>
          candidate.notes
            .map(
              (note) =>
                `${note.startBeat}:${note.durationBeats}:${note.pitch}:${note.velocity}`,
            )
            .join("|"),
        ),
      ).size,
    ).toBe(candidates.length)
    expect(
      candidates.some((candidate) => {
        if (candidate.notes.length < 3) return false
        const intervals = candidate.notes
          .slice(1)
          .map((note, index) => note.pitch - candidate.notes[index].pitch)
        const direction = Math.sign(intervals[0])
        return (
          direction !== 0 &&
          intervals.every(
            (interval) =>
              Math.sign(interval) === direction &&
              Math.abs(interval) >= 1 &&
              Math.abs(interval) <= 3,
          )
        )
      }),
    ).toBe(true)
    expect(
      candidates.some((candidate) => {
        const intervals = candidate.notes
          .slice(1)
          .map(
            (note, index) =>
              Math.round(
                (note.startBeat - candidate.notes[index].startBeat) * 1000,
              ) / 1000,
          )
        return new Set(intervals).size >= 2
      }),
    ).toBe(true)
  })

  it("Autoは次SectionがあればTransitionを含み、次コードの構成音へ着地する", () => {
    const candidates = generateDecorationCandidates(input())
    const transitions = candidates.filter(
      (candidate) => candidate.decorationPlan?.type === "transition-fill",
    )
    expect(transitions.length).toBeGreaterThan(0)
    for (const candidate of transitions) {
      const last = candidate.notes.at(-1)!
      expect(((last.pitch % 12) + 12) % 12).toBe(candidate.decorationPlan?.targetPitchClass)
      expect(last.startBeat + last.durationBeats).toBeLessThanOrEqual(16.0001)
      expect(last.durationBeats).toBeGreaterThanOrEqual(0.75)
      expect(last.velocity).toBeGreaterThanOrEqual(candidate.notes[0].velocity)
      expect(Math.abs(last.pitch - candidate.notes.at(-2)!.pitch)).toBeLessThanOrEqual(2)
      expect(last.plannedToneRole).toBe("tension-hold")
    }
  })

  it("最終SectionのAutoはEnding Fillとして終止と余韻を作る", () => {
    const candidates = generateDecorationCandidates(
      input({
        sectionRole: "outro",
        nextSectionRole: undefined,
        nextSectionFirstChord: undefined,
        isLastSection: true,
      }),
    )
    expect(candidates.every((candidate) => candidate.decorationPlan?.type === "ending-fill")).toBe(true)
    expect(candidates.every((candidate) => candidate.role === "cadential-fill")).toBe(true)
    expect(
      candidates.every(
        (candidate) => candidate.notes.at(-1)!.durationBeats >= 1,
      ),
      JSON.stringify(
        candidates.map((candidate) => ({
          plan: candidate.decorationPlan,
          notes: candidate.notes.map((note) => [
            note.startBeat,
            note.durationBeats,
            note.pitch,
            note.velocity,
          ]),
        })),
      ),
    ).toBe(true)
    expect(
      candidates.every(
        (candidate) =>
          candidate.notes.at(-1)!.velocity <= candidate.notes[0].velocity,
      ),
    ).toBe(true)
  })

  it("Characterごとに演奏法として自然なShapeとRhythmを組み合わせる", () => {
    const strings = generateDecorationCandidates(
      input({
        settings: {
          ...DEFAULT_DECORATION_SETTINGS,
          character: "strings",
        },
      }),
    )
    expect(
      strings.every(
        (candidate) =>
          candidate.decorationPlan?.rhythmStyle !== "sixteenth" &&
          candidate.decorationPlan?.rhythmStyle !== "staccato",
      ),
    ).toBe(true)

    const bell = generateDecorationCandidates(
      input({
        settings: {
          ...DEFAULT_DECORATION_SETTINGS,
          character: "bell",
        },
      }),
    )
    expect(
      bell.every(
        (candidate) =>
          candidate.decorationPlan?.rhythmStyle !== "legato" &&
          candidate.decorationPlan?.shape !== "arpeggiated-fill",
      ),
    ).toBe(true)
  })

  it("Active Melodyの短い空白へ長さを縮め、無理に重ねない", () => {
    const melodyNotes = [
      { id: "m1", startBeat: 0, durationBeats: 3, pitch: 64, velocity: 80, locks: [] },
      { id: "m2", startBeat: 4, durationBeats: 3, pitch: 67, velocity: 80, locks: [] },
      { id: "m3", startBeat: 8, durationBeats: 3, pitch: 69, velocity: 80, locks: [] },
      { id: "m4", startBeat: 12, durationBeats: 3, pitch: 72, velocity: 80, locks: [] },
    ]
    const candidates = generateDecorationCandidates(
      input({
        settings: {
          ...DEFAULT_DECORATION_SETTINGS,
          type: "decorative-fill",
          length: 4,
        },
        melodyNotes,
      }),
    )
    expect(candidates.length).toBeGreaterThan(0)
    expect(
      candidates.every(
        (candidate) => (candidate.decorationPlan?.lengthBeats ?? 4) <= 1,
      ),
    ).toBe(true)
    expect(
      candidates.every(
        (candidate) => !candidate.collisions.hasBlockingCollision,
      ),
    ).toBe(true)
  })

  it("Type・Character・Length・Density・Direction指定を実音計画へ反映する", () => {
    const candidates = generateDecorationCandidates(
      input({
        settings: {
          type: "decorative-fill",
          character: "bell",
          length: 2,
          density: "sparse",
          direction: "falling",
        },
      }),
    )
    for (const candidate of candidates) {
      expect(candidate.decorationPlan).toMatchObject({
        type: "decorative-fill",
        character: "bell",
        lengthBeats: 2,
        density: "sparse",
        direction: "falling",
        register: "high",
      })
      expect(candidate.notes.length).toBeLessThanOrEqual(3)
    }
  })

  it("同じRandom Seedと構造では候補計画と実音を再現する", () => {
    const signature = () =>
      generateDecorationCandidates(input()).map((candidate) => ({
        plan: candidate.decorationPlan,
        notes: candidate.notes.map((note) => [
          note.startBeat,
          note.durationBeats,
          note.pitch,
          note.velocity,
        ]),
      }))
    expect(signature()).toEqual(signature())
  })

  it("異なるseedでも品質下限を満たす10 Gestureを維持する", () => {
    for (const seed of [1, 42, 2026]) {
      const candidates = generateDecorationCandidates(
        input({ seed }),
      )
      expect(candidates).toHaveLength(10)
      expect(
        candidates.every(
          (candidate) =>
            candidate.quality.overallQuality >= 68 &&
            candidate.quality.transitionValue >= 78 &&
            candidate.notes.length >= 3,
        ),
      ).toBe(true)
    }
  })
})
