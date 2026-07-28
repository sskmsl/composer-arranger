import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type {
  ContentQualityBreakdown,
  ContentStructureFeatures,
  ResolvedLeadContent,
  SectionContentPlan,
} from "@/core/sectionContent"
import { generateSectionContent } from "./generateSectionContent"
import {
  contentQualityFloor,
  evaluateContentQuality,
  selectQualityDiverseContent,
} from "./sectionContentQuality"

function plan(content: ResolvedLeadContent, patch: Partial<SectionContentPlan> = {}): SectionContentPlan {
  return {
    content,
    entryOffsetBeats: 0,
    pickupBeats: 0,
    register: "middle",
    pitchVocabulary: [0, 4, 7],
    rhythmGrammar: `${content}-test`,
    recurrenceStrategy: content === "ostinato" ? "periodic-cycle" : "sparse-return",
    developmentStrategy: content === "ostinato" ? "mutate-cycle" : "fragment",
    chordBoundaryResponse: "follow",
    cellLengthBeats: 4,
    repetitionCount: 2,
    sustainRatioTarget: 0.25,
    motifIntervals: [2, -1],
    cellDurations: [0.5, 0.5, 1],
    restBeats: [1],
    ...patch,
  }
}

function features(
  content: ResolvedLeadContent,
  patch: Partial<ContentStructureFeatures> = {},
): ContentStructureFeatures {
  return {
    content,
    entryOffsetBeats: 0,
    pitchClassCardinality: 3,
    intervalSequence: [2, -1],
    onsetPattern: [0, 0.5, 1],
    durationPattern: [0.5, 0.5, 1],
    sustainRatio: 0.3,
    restRatio: 0.4,
    recurrencePeriodBeats: 4,
    recurrenceStrength: 0.75,
    registerCenter: 64,
    contour: [1, -1],
    ...patch,
  }
}

function quality(overallQuality: number): ContentQualityBreakdown {
  return {
    sectionFit: overallQuality,
    songProfileFit: overallQuality,
    harmonicInterest: overallQuality,
    structuralClarity: overallQuality,
    nextSectionExpectation: overallQuality,
    motifRelationship: overallQuality,
    spaceQuality: overallQuality,
    overallQuality,
  }
}

const chords = parseChordInputText("Am(add9) | D#dim | Fmaj7 | E7", "s1", 4, "c")

describe("Issue #63 / Auto Content quality and diversity", () => {
  it("9候補を評価し、品質下限を満たす3案へ選抜する", () => {
    const result = generateSectionContent({
      chords,
      sectionId: "s1",
      sectionRole: "intro",
      songProfile: "dark-romantic",
      content: { lead: "auto", accompaniment: "chords", entryOffsetBeats: 0, pickup: false },
      range: { low: 55, high: 79 },
      totalBeats: 16,
      beatsPerBar: 4,
      seed: 12345,
      key: "Am",
      nextSectionRole: "verse",
      nextSectionFirstChord: "Am",
      songMotifDNA: {
        intervalCells: [2, -1, 4],
        rhythmCells: [0.5, 1],
        repeatedNoteTendency: 0.2,
        approachNoteTendency: 0.5,
        contourTendency: 0.2,
        phraseEndingTendency: 0.4,
        characteristicRests: [1],
        climaxDirection: "ascending",
      },
    })
    expect(result.candidatePool).toHaveLength(9)
    expect(result.candidates).toHaveLength(3)
    expect(
      result.candidates.every(
        (candidate) =>
          candidate.quality.overallQuality >= contentQualityFloor(candidate.content),
      ),
    ).toBe(true)
    expect(result.candidates.every((candidate) => candidate.selection.selected)).toBe(true)
    expect(new Set(result.candidates.map((candidate) => candidate.content)).size).toBeGreaterThanOrEqual(2)
  })

  it("MMRは類似したQuality上位3件をそのまま選ばない", () => {
    const base = {
      content: "motif" as const,
      plan: plan("motif"),
      notes: [],
      problems: [],
    }
    const pool = [
      { ...base, seed: 1, features: features("motif"), quality: quality(95) },
      { ...base, seed: 2, features: features("motif"), quality: quality(94) },
      { ...base, seed: 3, features: features("motif"), quality: quality(93) },
      {
        ...base,
        seed: 4,
        features: features("motif", {
          entryOffsetBeats: 8,
          intervalSequence: [-5, 2, 2],
          onsetPattern: [8, 10, 11.5],
          recurrencePeriodBeats: 8,
          recurrenceStrength: 0.25,
          registerCenter: 76,
        }),
        quality: quality(90),
      },
    ]
    const result = selectQualityDiverseContent(pool, 3)
    expect(result.selected.map((candidate) => candidate.seed)).toContain(4)
    expect(result.selected.map((candidate) => candidate.seed)).not.toEqual([1, 2, 3])
  })

  it("品質下限未満は多様性だけで採用しない", () => {
    const pool = [
      {
        seed: 1,
        content: "motif" as const,
        plan: plan("motif"),
        notes: [],
        features: features("motif"),
        problems: [],
        quality: quality(90),
      },
      {
        seed: 2,
        content: "drone" as const,
        plan: plan("drone"),
        notes: [],
        features: features("drone", { restRatio: 0, sustainRatio: 1 }),
        problems: [],
        quality: quality(30),
      },
    ]
    const result = selectQualityDiverseContent(pool, 2)
    expect(result.selected.map((candidate) => candidate.seed)).toEqual([1])
    expect(result.evaluatedPool.find((candidate) => candidate.seed === 2)?.selection?.reason).toBe("below-quality-floor")
  })

  it("Song Profile・次Section・Motif DNAが部分スコアへ反映される", () => {
    const candidate = {
      seed: 1,
      content: "motif" as const,
      plan: plan("motif", { pickupBeats: 1, chordBoundaryResponse: "anticipate" }),
      notes: [
        { id: "n1", startBeat: 0, durationBeats: 1, pitch: 69, velocity: 70, locks: [] },
        { id: "n2", startBeat: 1, durationBeats: 1, pitch: 71, velocity: 70, locks: [] },
      ],
      features: features("motif", { intervalSequence: [2], contour: [1] }),
      problems: [],
    }
    const matching = evaluateContentQuality(candidate, {
      sectionRole: "pre-chorus",
      songProfile: "dark-romantic",
      chords,
      totalBeats: 16,
      nextSectionRole: "chorus",
      nextSectionFirstChord: "Am",
      songMotifDNA: {
        intervalCells: [2],
        rhythmCells: [1],
        repeatedNoteTendency: 0,
        approachNoteTendency: 0,
        contourTendency: 1,
        phraseEndingTendency: 0.5,
        characteristicRests: [],
        climaxDirection: "ascending",
      },
    })
    const mismatching = evaluateContentQuality(candidate, {
      sectionRole: "pre-chorus",
      songProfile: "dramatic-synth-pop",
      chords,
      totalBeats: 16,
      nextSectionRole: "outro",
      songMotifDNA: {
        intervalCells: [-7],
        rhythmCells: [2],
        repeatedNoteTendency: 0,
        approachNoteTendency: 0,
        contourTendency: -1,
        phraseEndingTendency: 0.5,
        characteristicRests: [],
        climaxDirection: "descending",
      },
    })
    expect(matching.songProfileFit).toBeGreaterThan(mismatching.songProfileFit)
    expect(matching.nextSectionExpectation).toBeGreaterThanOrEqual(mismatching.nextSectionExpectation)
    expect(matching.motifRelationship).toBeGreaterThan(mismatching.motifRelationship)
  })

  it("固定seedでは候補Content・品質・選抜理由を再現する", () => {
    const generate = () =>
      generateSectionContent({
        chords,
        sectionId: "s1",
        sectionRole: "instrumental",
        songProfile: "minimal-tension",
        content: { lead: "auto", accompaniment: "chords", entryOffsetBeats: 0, pickup: false },
        range: { low: 55, high: 79 },
        totalBeats: 16,
        beatsPerBar: 4,
        seed: 9876,
        key: "Am",
      }).candidates.map((candidate) => ({
        content: candidate.content,
        quality: candidate.quality,
        reason: candidate.selection.reason,
        notes: candidate.notes.map((note) => [note.startBeat, note.durationBeats, note.pitch]),
      }))
    expect(generate()).toEqual(generate())
  })
})
