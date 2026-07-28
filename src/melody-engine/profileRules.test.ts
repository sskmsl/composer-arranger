import { describe, expect, it } from "vitest"
import type { MelodyGeneratorProfile } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { computeMelodyFeatures } from "./features"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import {
  GENERATOR_PROFILES,
  GENERATOR_PROFILE_KIND,
  GENERATOR_PROFILE_RULES,
  type GeneratorProfileIdentityMetric,
} from "./generatorProfile"
import { buildHarmonicMap } from "./harmonicMap"

const chords: ChordEvent[] = [
  { id: "a", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
  { id: "d", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "D#dim", bass: null },
  { id: "f", sectionId: "s", startBeat: 8, durationBeats: 4, symbol: "Fmaj7", bass: null },
  { id: "e", sectionId: "s", startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
]
const harmonicMap = buildHarmonicMap(chords)

type MetricSummary = Record<GeneratorProfileIdentityMetric, number>

function summarize(profile: MelodyGeneratorProfile): MetricSummary {
  const totals: MetricSummary = {
    chordToneUsageRatio: 0,
    restRatio: 0,
    avgLeap: 0,
    syncopationRatio: 0,
    tensionUsageRatio: 0,
    pitchRange: 0,
    delayedResolutionRatio: 0,
    repeatedNoteRatio: 0,
    motifRepeatRatio: 0,
  }
  let count = 0
  for (let seed = 1; seed <= 12; seed++) {
    const candidates = generateFromChordsWithProfiles({
      chords,
      sectionId: "s",
      sectionRole: "verse",
      songProfile: "original-custom",
      density: "balanced",
      range: { low: 60, high: 79 },
      drama: "growing",
      totalBeats: 16,
      seed,
      profiles: [profile],
    }).candidates
    for (const candidate of candidates) {
      const features = computeMelodyFeatures(candidate.notes, harmonicMap, 0, 16)
      totals.chordToneUsageRatio += features.chordToneUsageRatio
      totals.restRatio += features.restRatio
      totals.avgLeap += features.avgLeap
      totals.syncopationRatio += features.syncopationRatio
      totals.tensionUsageRatio += features.tensionUsageRatio
      totals.pitchRange += features.rangeHigh - features.rangeLow
      totals.delayedResolutionRatio += candidate.advancedMetrics?.delayedResolutionRatio ?? 0
      totals.repeatedNoteRatio += features.repeatedNoteRatio
      totals.motifRepeatRatio += features.motifRepeatRatio
      count++
    }
  }
  for (const metric of Object.keys(totals) as GeneratorProfileIdentityMetric[]) totals[metric] /= count
  return totals
}

describe("Generator Profile rules", () => {
  it("全9 Profileが生成順序・音程・リズム・音域・休符・終止・保護特性を定義する", () => {
    expect(Object.keys(GENERATOR_PROFILE_RULES).sort()).toEqual([...GENERATOR_PROFILES].sort())
    for (const profile of GENERATOR_PROFILES) {
      const rule = GENERATOR_PROFILE_RULES[profile]
      expect(rule.pitchTendency.length).toBeGreaterThan(10)
      expect(rule.rhythmTendency.length).toBeGreaterThan(10)
      expect(rule.registerTendency.length).toBeGreaterThan(5)
      expect(rule.restTendency.length).toBeGreaterThan(5)
      expect(rule.endingTendency.length).toBeGreaterThan(5)
      expect(rule.protectedTraits.length).toBeGreaterThanOrEqual(3)
      expect(rule.selectionFitWeight).toBeGreaterThanOrEqual(0.2)
      expect(rule.selectionFitWeight).toBeLessThanOrEqual(0.5)
      if (GENERATOR_PROFILE_KIND[profile] === "bespoke") {
        expect(["rhythm-led", "target-tone-led", "cycle-led"]).toContain(rule.planningPriority)
      }
    }
  })

  it("固定seed分布で各Profileの主特徴が参照Profileより明確に現れる", () => {
    const summaries = new Map<MelodyGeneratorProfile, MetricSummary>()
    const summaryFor = (profile: MelodyGeneratorProfile) => {
      const cached = summaries.get(profile)
      if (cached) return cached
      const summary = summarize(profile)
      summaries.set(profile, summary)
      return summary
    }

    for (const profile of GENERATOR_PROFILES) {
      const comparison = GENERATOR_PROFILE_RULES[profile].identityComparison
      const actual = summaryFor(profile)[comparison.metric]
      const reference = summaryFor(comparison.reference)[comparison.metric]
      if (comparison.direction === "greater") {
        expect(actual, `${profile}.${comparison.metric} > ${comparison.reference} (${actual} > ${reference})`).toBeGreaterThan(reference)
      } else {
        expect(actual, `${profile}.${comparison.metric} < ${comparison.reference} (${actual} < ${reference})`).toBeLessThan(reference)
      }
    }
  }, 20_000)
})
