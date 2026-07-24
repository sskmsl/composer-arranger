import { describe, expect, it } from "vitest"
import type { ChordEvent } from "@/core/project"
import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
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

function generate(profile: MelodyGeneratorProfile, seed: number) {
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
    profiles: [profile],
  }).candidates
}

function intervals(notes: MelodyNote[]) {
  return notes.slice(1).map((note, index) => ({
    interval: note.pitch - notes[index].pitch,
    beat: note.startBeat,
    recovery: notes[index + 2] ? notes[index + 2].pitch - note.pitch : null,
  }))
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

describe("Profile-specific Expression Arc", () => {
  it.each(["chromatic", "cinematic", "leaping"] as MelodyGeneratorProfile[])(
    "%sの最終3案は最低2種類のExpression Arcを持つ",
    (profile) => {
      for (let seed = 1; seed <= 10; seed++) {
        const plans = generate(profile, seed).map((candidate) => candidate.profileExpressionPlan)
        expect(plans.every(Boolean)).toBe(true)
        expect(new Set(plans.map((plan) => plan!.arc)).size).toBeGreaterThanOrEqual(2)
      }
    },
  )

  it("Chromaticは意図した接近・掛留・先取り・テンション保持を実音化する", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate("chromatic", seed)) {
        const arc = candidate.profileExpressionPlan!.arc
        const roles = new Set(candidate.notes.map((note) => note.plannedToneRole))
        if (arc === "chromatic-neighbor") {
          expect(roles.has("approach-tone") || roles.has("appoggiatura"), `${seed}:${arc}`).toBe(true)
        } else if (arc === "chromatic-suspension") {
          expect(roles.has("suspension") || roles.has("appoggiatura"), `${seed}:${arc}`).toBe(true)
        } else if (arc === "chromatic-anticipation") {
          expect(roles.has("anticipation"), `${seed}:${arc}`).toBe(true)
        } else {
          expect(roles.has("tension-hold"), `${seed}:${arc}`).toBe(true)
        }
      }
    }
  })

  it("Chromaticのコード外音は解決計画を持つ", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate("chromatic", seed)) {
        for (const note of candidate.notes) {
          const entry = chordAtBeat(harmonicMap, note.startBeat)
          if (!entry || allUsablePitchClasses(entry.parsed).includes(pitchClass(note.pitch))) continue
          expect(
            note.plannedResolution,
            `${seed}:${candidate.patternIndex}:${candidate.profileExpressionPlan!.arc}:${note.startBeat}:${note.pitch}:${note.plannedToneRole}:usable=${allUsablePitchClasses(entry.parsed).join(",")}`,
          ).toBeDefined()
        }
      }
    }
  })

  it("CinematicはArcごとに蓄積・中間頂点・頂点前の間・低音回帰を実音化する", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate("cinematic", seed)) {
        const plan = candidate.profileExpressionPlan!
        const notes = candidate.notes
        if (plan.arc === "cinematic-slow-bloom") {
          const early = notes.filter((note) => note.startBeat < 12).map((note) => note.velocity)
          const late = notes.filter((note) => note.startBeat > 20).map((note) => note.velocity)
          expect(average(late)).toBeGreaterThan(average(early))
        } else if (plan.arc === "cinematic-midpoint-surge") {
          const focus = notes.reduce((best, note) =>
            Math.abs(note.startBeat - plan.focusBeat) < Math.abs(best.startBeat - plan.focusBeat) ? note : best,
          )
          expect(focus.velocity).toBeGreaterThanOrEqual(100)
        } else if (plan.arc === "cinematic-breath-before-peak") {
          const before = [...notes].reverse().find((note) => note.startBeat < plan.focusBeat)
          const arrival = notes.find((note) => note.startBeat >= plan.focusBeat)
          if (before && arrival) {
            expect(arrival.startBeat - (before.startBeat + before.durationBeats)).toBeGreaterThanOrEqual(0.7)
          }
        } else {
          const early = notes.filter((note) => note.startBeat < 16).map((note) => note.pitch)
          const late = notes.filter((note) => note.startBeat >= 22).map((note) => note.pitch)
          expect(average(late)).toBeLessThanOrEqual(average(early) + 1)
        }
      }
    }
  })

  it("Leapingは7半音以上の構造跳躍と2半音以内の回収を実音化する", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generate("leaping", seed)) {
        const gestures = intervals(candidate.notes).filter(
          (event) => Math.abs(event.interval) >= 7 && event.recovery !== null && Math.abs(event.recovery) <= 2,
        )
        expect(gestures.length, `${seed}:${candidate.profileExpressionPlan!.arc}`).toBeGreaterThan(0)
        if (candidate.profileExpressionPlan!.arc === "leaping-downward-release") {
          expect(gestures.some((event) => event.interval <= -7)).toBe(true)
        }
      }
    }
  })

  it.each(["chromatic", "cinematic", "leaping"] as MelodyGeneratorProfile[])(
    "%sは固定seedでExpression Planと実音を再現する",
    (profile) => {
      const a = generate(profile, 41)
      const b = generate(profile, 41)
      expect(a.map((candidate) => candidate.profileExpressionPlan)).toEqual(
        b.map((candidate) => candidate.profileExpressionPlan),
      )
      expect(a.map((candidate) => candidate.notes.map(({ id: _id, ...note }) => note))).toEqual(
        b.map((candidate) => candidate.notes.map(({ id: _id, ...note }) => note)),
      )
    },
  )
})
