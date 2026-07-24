import { describe, expect, it } from "vitest"
import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import { allUsablePitchClasses } from "@/core/chord"
import { pitchClass } from "@/core/note"
import { buildHarmonicMap, chordAtBeat } from "./harmonicMap"
import { generateFromChordsWithProfiles } from "./generateFromChords"

const chords: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 8, symbol: "Am(add9)", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 8, durationBeats: 8, symbol: "D#dim", bass: null },
  { id: "c3", sectionId: "s1", startBeat: 16, durationBeats: 8, symbol: "Fmaj7", bass: null },
  { id: "c4", sectionId: "s1", startBeat: 24, durationBeats: 8, symbol: "E7", bass: null },
]
const harmonicMap = buildHarmonicMap(chords)

function generate(seed: number) {
  return generateFromChordsWithProfiles({
    chords,
    sectionId: "s1",
    sectionRole: "verse",
    songProfile: "original-custom",
    density: "balanced",
    range: { low: 57, high: 79 },
    drama: "growing",
    totalBeats: 32,
    seed,
    profiles: ["elegiac-cantabile"],
  }).candidates
}

function stripId(note: MelodyNote) {
  const { id: _id, ...rest } = note
  return rest
}

describe("Elegiac Cantabile dedicated generator", () => {
  it("Motif Seedを2〜5音で先に計画し、反復・断片化・拡張・遅延回帰で展開する", () => {
    for (const candidate of generate(19)) {
      const plan = candidate.elegiacPlan
      expect(plan).toBeDefined()
      expect(plan!.motifSeed.intervals.length).toBeGreaterThanOrEqual(2)
      expect(plan!.motifSeed.intervals.length).toBeLessThanOrEqual(5)
      expect(plan!.motifSeed.durations).toHaveLength(plan!.motifSeed.intervals.length)
      expect(plan!.development.length).toBeGreaterThanOrEqual(3)
      expect(plan!.development.every((operation) =>
        ["repeat", "fragmentation", "expansion", "delayed-return"].includes(operation),
      )).toBe(true)
    }
  })

  it("最終3案は最低2種類のClimax・Ending・Phrase・breath・Tension Arcを持つ", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const candidates = generate(seed)
      const plans = candidates.map((candidate) => candidate.elegiacPlan!)
      expect(new Set(plans.map((plan) => plan.climaxType)).size).toBeGreaterThanOrEqual(2)
      expect(new Set(plans.map((plan) => plan.endingStrategy)).size).toBeGreaterThanOrEqual(2)
      expect(new Set(plans.map((plan) => plan.phraseLengths.join("/"))).size).toBeGreaterThanOrEqual(2)
      expect(new Set(plans.map((plan) => plan.breathBeats.join("/"))).size).toBeGreaterThanOrEqual(2)
      expect(new Set(plans.map((plan) => plan.tensionArc)).size).toBeGreaterThanOrEqual(2)
    }
  })

  it("各Tension Arcを意図した音楽的役割として実音化する", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate(seed)) {
        const arc = candidate.elegiacPlan!.tensionArc
        const roles = new Set(candidate.notes.map((note) => note.plannedToneRole))
        const context = `${seed}:pattern=${candidate.patternIndex}:${arc}:${candidate.notes
          .map((note) => `${note.startBeat}:${note.plannedToneRole}:${note.plannedResolution ? "R" : "-"}`)
          .join("|")}`
        if (arc === "inward-resolution" || arc === "yearning-delay") {
          expect(roles.has("appoggiatura") || roles.has("suspension"), context).toBe(true)
        } else if (arc === "suspended-ache") {
          expect(roles.has("tension-hold"), context).toBe(true)
        } else {
          expect(roles.has("anticipation"), context).toBe(true)
        }
      }
    }
  })

  it("3案すべてが同じ後半最高音型へ収束しない", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const latePeakCount = generate(seed).filter((candidate) => {
        const highest = Math.max(...candidate.notes.map((note) => note.pitch))
        const peak = candidate.notes.find((note) => note.pitch === highest)!
        return peak.startBeat / 32 >= 0.6
      }).length
      expect(latePeakCount).toBeLessThan(3)
    }
  })

  it("Opening Planの開始時刻・最初の音価・opening phrase長を実音とbreathへ反映する", () => {
    for (const candidate of generate(27)) {
      const opening = candidate.openingPlan!
      const first = candidate.notes[0]
      expect(first.startBeat).toBeCloseTo(opening.startBeatOffset, 6)
      expect(first.durationBeats).toBeCloseTo(opening.firstNoteDuration, 6)
      const expectedOpeningBreath = opening.startBeatOffset + opening.openingPhraseLengthBeats
      if (expectedOpeningBreath < candidate.elegiacPlan!.phraseLengths[0] - 1) {
        expect(candidate.elegiacPlan!.breathBeats).toContain(expectedOpeningBreath)
      }
    }
  })

  it("target toneはコードごとでなく2〜4小節単位に置く", () => {
    for (const candidate of generate(7)) {
      const targets = candidate.elegiacPlan!.targetTones
      expect(targets.length).toBeGreaterThan(0)
      expect(targets.length).toBeLessThanOrEqual(Math.ceil(32 / 8))
      for (let index = 1; index < targets.length; index++) {
        expect(targets[index].beat - targets[index - 1].beat).toBeGreaterThanOrEqual(7.98)
      }
    }
  })

  it("固定seedで専用計画・Phrase・実音を再現する", () => {
    const a = generate(41)
    const b = generate(41)
    expect(a.map((candidate) => candidate.elegiacPlan)).toEqual(b.map((candidate) => candidate.elegiacPlan))
    expect(a.map((candidate) => candidate.plans)).toEqual(b.map((candidate) => candidate.plans))
    expect(a.map((candidate) => candidate.notes.map(stripId))).toEqual(
      b.map((candidate) => candidate.notes.map(stripId)),
    )
  })

  it("コード外音は短い経過音または解決計画を持つ意図的な非和声音に限定する", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate(seed)) {
        for (const note of candidate.notes) {
          const entry = chordAtBeat(harmonicMap, note.startBeat)
          if (!entry) continue
          const usable = allUsablePitchClasses(entry.parsed)
          if (usable.includes(pitchClass(note.pitch))) continue
          const resolution = note.plannedResolution
          expect(
            resolution,
            `seed=${seed} pattern=${candidate.patternIndex} climax=${candidate.elegiacPlan?.climaxType} beat=${note.startBeat} pitch=${note.pitch} role=${note.plannedToneRole}`,
          ).toBeDefined()
          expect(resolution!.targetBeat).toBeGreaterThan(note.startBeat)
          expect(resolution!.targetBeat - note.startBeat).toBeLessThanOrEqual(resolution!.maximumDelayBeats + 1e-6)
        }
      }
    }
  })

  it("強拍・ロングトーンは、解決計画なしでコード外へ外れない", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate(seed)) {
        const exposed = candidate.notes.filter(
          (note) => Math.abs(note.startBeat - Math.round(note.startBeat)) < 0.06 || note.durationBeats >= 1.25,
        )
        for (const note of exposed) {
          const entry = chordAtBeat(harmonicMap, note.startBeat)
          if (!entry) continue
          const usable = allUsablePitchClasses(entry.parsed)
          expect(
            usable.includes(pitchClass(note.pitch)) || note.plannedResolution !== undefined,
            `seed=${seed} pattern=${candidate.patternIndex} climax=${candidate.elegiacPlan?.climaxType} beat=${note.startBeat} pitch=${note.pitch} role=${note.plannedToneRole}`,
          ).toBe(true)
        }
      }
    }
  })
})
