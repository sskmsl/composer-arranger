import { describe, expect, it } from "vitest"
import type { CandidateMelodyDNA, MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import { buildHarmonicMap } from "./harmonicMap"
import {
  applyCandidateNarrative,
  phraseLengthsForDNA,
  planCandidateMelodyDNA,
} from "./candidateMelodyDNA"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { GENERATOR_PROFILES } from "./generatorProfile"
import { chordAtBeat } from "./harmonicMap"
import { isChordTone } from "@/core/chord"
import { pitchClass } from "@/core/note"

const chords: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 4, durationBeats: 4, symbol: "D#dim", bass: null },
  { id: "c3", sectionId: "s1", startBeat: 8, durationBeats: 4, symbol: "Fmaj7", bass: null },
  { id: "c4", sectionId: "s1", startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
]
const harmonicMap = buildHarmonicMap(chords)
const range = { low: 60, high: 79 }

function generate(profile: MelodyGeneratorProfile, seed = 23) {
  return generateFromChordsWithProfiles({
    chords,
    sectionId: "s1",
    sectionRole: "verse",
    songProfile: "original-custom",
    density: "balanced",
    range,
    drama: "growing",
    totalBeats: 16,
    seed,
    profiles: [profile],
  }).candidates
}

function dimensionDiversity(dnas: CandidateMelodyDNA[]): number {
  const dimensions = [
    dnas.map((dna) => dna.motifIdentity),
    dnas.map((dna) => dna.rhythmGrammar),
    dnas.map((dna) => dna.phraseArchitecture),
    dnas.map((dna) => dna.harmonicResponse),
    dnas.map((dna) => dna.registerTrajectory),
    dnas.map((dna) => dna.developmentStrategy),
    dnas.map((dna) => dna.climaxPlan.position),
    dnas.map((dna) => dna.endingStrategy),
  ]
  return dimensions.filter((values) => new Set(values).size >= 2).length
}

describe("Candidate Melody DNA planning", () => {
  it.each(GENERATOR_PROFILES)("%sは候補プール先頭4件へProfile固有の異なるDNAを計画する", (profile) => {
    const rngSeed = 9471
    const dnas = Array.from({ length: 4 }, (_, index) =>
      planCandidateMelodyDNA(new SeededRandom(rngSeed), profile, index),
    )
    expect(new Set(dnas.map((dna) => JSON.stringify(dna))).size).toBe(4)
    expect(dimensionDiversity(dnas)).toBeGreaterThanOrEqual(3)
  })

  it("同一seed・Profile・pool indexでは完全に再現される", () => {
    const a = planCandidateMelodyDNA(new SeededRandom(99), "elegiac-cantabile", 2)
    const b = planCandidateMelodyDNA(new SeededRandom(99), "elegiac-cantabile", 2)
    expect(a).toEqual(b)
  })

  it("Phrase Architectureが冒頭以降のフレーズ長を分岐させる", () => {
    const base = planCandidateMelodyDNA(new SeededRandom(4), "standard", 0)
    const opening = {
      intent: { entryType: "direct", emotionalFunction: "statement", register: "middle", initialDirection: "ascending" },
      startPitchClass: 9,
      startScaleDegree: 1,
      startBeatOffset: 0,
      firstNoteDuration: 1,
      initialDirection: "ascending",
      openingContour: "stepwise",
      openingRegister: { lowestMidiNote: 60, highestMidiNote: 72 },
      openingPhraseLengthBeats: 4,
    } as const
    const longArc = phraseLengthsForDNA(32, opening, 8, { ...base, phraseArchitecture: "long-arc" })
    const asymmetric = phraseLengthsForDNA(32, opening, 8, { ...base, phraseArchitecture: "asymmetric" })
    expect(longArc).not.toEqual(asymmetric)
    expect(longArc.reduce((sum, value) => sum + value, 0)).toBe(32)
    expect(asymmetric.reduce((sum, value) => sum + value, 0)).toBe(32)
  })
})

describe("Candidate Melody DNA realization", () => {
  it.each(GENERATOR_PROFILES)("%sの最終3案は異なる全体DNAを持ち、最低3設計軸で分岐する", (profile) => {
    const candidates = generate(profile)
    const dnas = candidates.map((candidate) => candidate.candidateMelodyDNA).filter(Boolean) as CandidateMelodyDNA[]
    expect(dnas).toHaveLength(3)
    expect(new Set(dnas.map((dna) => JSON.stringify(dna))).size).toBe(3)
    expect(dimensionDiversity(dnas)).toBeGreaterThanOrEqual(3)
    expect(candidates.every((candidate) => candidate.generationDiagnostics?.candidateMelodyDNA)).toBe(true)
  })

  it.each(GENERATOR_PROFILES)("%sは固定seedでDNA・フレーズ・実音を再現する", (profile) => {
    const a = generate(profile, 31)
    const b = generate(profile, 31)
    expect(a.map((candidate) => candidate.candidateMelodyDNA)).toEqual(
      b.map((candidate) => candidate.candidateMelodyDNA),
    )
    expect(a.map((candidate) => candidate.plans)).toEqual(b.map((candidate) => candidate.plans))
    expect(a.map((candidate) => candidate.notes.map(stripId))).toEqual(
      b.map((candidate) => candidate.notes.map(stripId)),
    )
  })

  it("Pattern 1〜3は品質順位ではなく生成プール順で割り当てられ、番号に優先度を持たない", () => {
    const candidates = generate("standard", 7)
    const poolIndexes = candidates.map((candidate) => candidate.generationDiagnostics?.candidatePoolIndex ?? -1)
    expect(poolIndexes).toEqual([...poolIndexes].sort((a, b) => a - b))
    expect(candidates.map((candidate) => candidate.patternIndex)).toEqual([1, 2, 3])
  })

  it.each(GENERATOR_PROFILES)("%sはseed横断で頂点位置・Phrase構造・Endingのうち2軸以上を実音上分ける", (profile) => {
    for (let seed = 1; seed <= 10; seed++) {
      const candidates = generate(profile, seed)
      const peakBuckets = candidates.map((candidate) => {
        const max = Math.max(...candidate.notes.map((note) => note.pitch))
        const peak = candidate.notes.find((note) => note.pitch === max)
        return Math.round(((peak?.startBeat ?? 0) / 16) * 4)
      })
      const phraseStructures = candidates.map((candidate) =>
        candidate.plans.map((plan) => plan.phraseLengthBeats).join("/"),
      )
      const endings = candidates.map((candidate) => candidate.candidateMelodyDNA?.endingStrategy)
      const distinctAxes = [peakBuckets, phraseStructures, endings].filter(
        (values) => new Set(values.map(String)).size >= 2,
      ).length
      expect(distinctAxes).toBeGreaterThanOrEqual(2)
    }
  })

  it("計画位置に一度きりの最高音を置く", () => {
    const dna = planCandidateMelodyDNA(new SeededRandom(11), "cinematic", 0)
    dna.climaxPlan = { type: "pitch-peak", position: "middle", targetFraction: 0.58 }
    const notes = applyCandidateNarrative(baseNotes(), harmonicMap, 16, range, dna)
    const max = Math.max(...notes.map((note) => note.pitch))
    const peaks = notes.filter((note) => note.pitch === max)
    expect(peaks).toHaveLength(1)
    expect(peaks[0].startBeat).toBe(8)
  })

  it("resolved終止は最終和音の安定音へ着地し、carry-forwardは短く先へ進む", () => {
    const base = planCandidateMelodyDNA(new SeededRandom(12), "standard", 0)
    const resolved = applyCandidateNarrative(baseNotes(), harmonicMap, 16, range, {
      ...base,
      endingStrategy: "resolved",
    })
    const resolvedLast = resolved[resolved.length - 1]
    const resolvedChord = chordAtBeat(harmonicMap, resolvedLast.startBeat)
    expect(resolvedChord && isChordTone(resolvedChord.parsed, pitchClass(resolvedLast.pitch))).toBe(true)
    expect(resolvedLast.plannedToneRole).toBe("chord-tone")

    const carry = applyCandidateNarrative(baseNotes(), harmonicMap, 16, range, {
      ...base,
      endingStrategy: "carry-forward",
    })
    const carryLast = carry[carry.length - 1]
    expect(carryLast.durationBeats).toBeLessThanOrEqual(0.75)
    expect(carryLast.pitch).toBeGreaterThan(baseNotes()[baseNotes().length - 1].pitch)
  })
})

function baseNotes(): MelodyNote[] {
  return [0, 4, 8, 12].map((startBeat, index) => ({
    id: `n${index}`,
    startBeat,
    durationBeats: 1,
    pitch: [69, 72, 71, 68][index],
    velocity: 76,
    locks: [],
  }))
}

function stripId(note: MelodyNote) {
  const { id: _id, ...rest } = note
  return rest
}
