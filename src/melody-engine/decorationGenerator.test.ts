import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import {
  DEFAULT_DECORATION_SETTINGS,
  generateDecorationCandidates,
  type GenerateDecorationInput,
} from "./decorationGenerator"

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
})
