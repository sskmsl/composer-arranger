import { describe, expect, it } from "vitest"
import type { ChordEvent } from "@/core/project"
import { buildHarmonicMap, chordAtBeat } from "@/melody-engine/harmonicMap"
import { isChordTone, isTensionTone } from "@/core/chord"
import { pitchClass } from "@/core/note"
import {
  generatePhraseCandidates,
  phraseSimilarity,
  planPhraseIntent,
  regeneratePhraseCandidate,
  type GeneratePhrasesInput,
} from "./generatePhrases"

const chords: ChordEvent[] = [
  { id: "a", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
  { id: "d", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "D#dim", bass: null },
  { id: "f", sectionId: "s", startBeat: 8, durationBeats: 4, symbol: "Fmaj7", bass: null },
  { id: "e", sectionId: "s", startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
]

function input(seed = 41, role: GeneratePhrasesInput["sectionRole"] = "verse"): GeneratePhrasesInput {
  return {
    chords,
    sectionId: "s",
    sectionRole: role,
    songProfile: "dark-romantic",
    density: "balanced",
    drama: "growing",
    range: { low: 60, high: 79 },
    key: "Am",
    beatsPerBar: 4,
    totalBeats: 16,
    seed,
  }
}

describe("Phrase Generator", () => {
  it("2〜4小節の独立候補を3案選ぶ", () => {
    const candidates = generatePhraseCandidates(input())
    expect(candidates).toHaveLength(3)
    for (const candidate of candidates) {
      expect(candidate.intent.lengthBars).toBeGreaterThanOrEqual(2)
      expect(candidate.intent.lengthBars).toBeLessThanOrEqual(4)
      expect(candidate.phraseLengthBeats).toBe(candidate.intent.lengthBars * 4)
      expect(candidate.notes.length).toBeGreaterThanOrEqual(4)
      expect(candidate.notes.every((note) => note.startBeat >= 0 && note.startBeat < candidate.phraseLengthBeats)).toBe(true)
      expect(candidate.notes.every((note) => note.pitch >= 60 && note.pitch <= 79)).toBe(true)
      expect(candidate.qualityScore).toBeGreaterThanOrEqual(55)
      let repeatedRun = 1
      let longestRepeatedRun = 1
      for (let index = 1; index < candidate.notes.length; index++) {
        repeatedRun = candidate.notes[index].pitch === candidate.notes[index - 1].pitch ? repeatedRun + 1 : 1
        longestRepeatedRun = Math.max(longestRepeatedRun, repeatedRun)
      }
      expect(longestRepeatedRun).toBeLessThanOrEqual(2)
    }
  })

  it("固定seedで計画・実音・選抜結果を再現できる", () => {
    const first = generatePhraseCandidates(input(97))
    const second = generatePhraseCandidates(input(97))
    expect(first.map((candidate) => candidate.intent)).toEqual(second.map((candidate) => candidate.intent))
    expect(first.map((candidate) => candidate.seed)).toEqual(second.map((candidate) => candidate.seed))
    expect(
      first.map((candidate) => candidate.notes.map((note) => [note.startBeat, note.durationBeats, note.pitch])),
    ).toEqual(
      second.map((candidate) => candidate.notes.map((note) => [note.startBeat, note.durationBeats, note.pitch])),
    )
  })

  it("seed差だけでなく、リズム・輪郭・和声解釈・終止の意図を分ける", () => {
    const candidates = generatePhraseCandidates(input(123))
    expect(new Set(candidates.map((candidate) => candidate.intent.contour)).size).toBeGreaterThanOrEqual(2)
    expect(new Set(candidates.map((candidate) => candidate.intent.rhythmCharacter)).size).toBeGreaterThanOrEqual(2)
    const composedIntent = new Set(
      candidates.map(
        (candidate) =>
          `${candidate.intent.contour}:${candidate.intent.rhythmCharacter}:${candidate.intent.harmonicApproach}:${candidate.intent.cadence}`,
      ),
    )
    expect(composedIntent.size).toBe(3)

    const similarities = [
      phraseSimilarity(candidates[0], candidates[1], chords),
      phraseSimilarity(candidates[0], candidates[2], chords),
      phraseSimilarity(candidates[1], candidates[2], chords),
    ]
    expect(Math.max(...similarities.map((value) => value.overallSimilarity))).toBeLessThan(0.9)
  })

  it("強拍は和声に適合しつつ、候補群には意図的な非コードトーンが残る", () => {
    const candidates = generatePhraseCandidates(input(211))
    const map = buildHarmonicMap(chords)
    const notes = candidates.flatMap((candidate) => candidate.notes)
    const strong = notes.filter((note) => Math.abs(note.startBeat - Math.round(note.startBeat)) < 0.06)
    const fitting = strong.filter((note) => {
      const entry = chordAtBeat(map, note.startBeat)!
      return isChordTone(entry.parsed, pitchClass(note.pitch)) || isTensionTone(entry.parsed, pitchClass(note.pitch))
    })
    expect(fitting.length / strong.length).toBeGreaterThan(0.8)
    expect(notes.some((note) => note.plannedToneRole !== "chord-tone")).toBe(true)
  })

  it("跳躍後は次の音で反対方向へ回収する割合を品質評価へ反映する", () => {
    const candidates = generatePhraseCandidates(input(301))
    const intervals = candidates.flatMap((candidate) =>
      candidate.notes.slice(1).map((note, index) => note.pitch - candidate.notes[index].pitch),
    )
    const leaps = intervals.filter((interval) => Math.abs(interval) >= 5)
    expect(leaps.length).toBeGreaterThan(0)
    expect(candidates.every((candidate) => candidate.qualityScore >= 55)).toBe(true)
  })

  it("個別再生成は兄弟候補との差を考慮し、元候補と異なる実音を返す", () => {
    const candidates = generatePhraseCandidates(input(401))
    const regenerated = regeneratePhraseCandidate(input(401), candidates[0].seed, candidates.slice(1))
    expect(regenerated.notes.map((note) => [note.startBeat, note.durationBeats, note.pitch])).not.toEqual(
      candidates[0].notes.map((note) => [note.startBeat, note.durationBeats, note.pitch]),
    )
    expect(regenerated.similarityToSelected).toHaveLength(2)
    expect(regenerated.qualityScore).toBeGreaterThanOrEqual(55)
  })

  it("Section Roleにより終止候補の優先語彙を変える", () => {
    const chorusPlans = Array.from({ length: 120 }, (_, index) =>
      planPhraseIntent(input(500 + index, "chorus"), 500 + index, index),
    )
    const versePlans = Array.from({ length: 120 }, (_, index) =>
      planPhraseIntent(input(700 + index, "verse"), 700 + index, index),
    )
    expect(chorusPlans.filter((plan) => plan.cadence === "resolved").length).toBeGreaterThan(
      versePlans.filter((plan) => plan.cadence === "resolved").length,
    )
    expect(versePlans.some((plan) => plan.cadence === "suspended" || plan.cadence === "carry-forward")).toBe(true)
  })
})
