import { describe, expect, it } from "vitest"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import type { MelodyGeneratorProfile } from "@/core/melody"
import { pitchClass } from "@/core/note"
import type { ChordEvent } from "@/core/project"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { buildHarmonicMap, chordAtBeat } from "./harmonicMap"

const profiles: MelodyGeneratorProfile[] = [
  "standard",
  "minimal",
  "leaping",
  "rhythmic",
  "chromatic",
  "cinematic",
  "elegiac-cantabile",
  "speech-rhythmic",
  "incantatory",
]

const chords: ChordEvent[] = [
  { id: "a", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
  { id: "d", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "D#dim", bass: null },
  { id: "f", sectionId: "s", startBeat: 8, durationBeats: 4, symbol: "Fmaj7", bass: null },
  { id: "e", sectionId: "s", startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
]
const harmonicMap = buildHarmonicMap(chords)

describe("全Generator Profileの音程整合性", () => {
  it("コード外音は使用可能テンションまたは明示的な解決計画を持つ", () => {
    const findings = new Map<string, string[]>()
    for (const profile of profiles) {
      const profileFindings: string[] = []
      for (let seed = 1; seed <= 200; seed++) {
        const result = generateFromChordsWithProfiles({
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
          key: "Am",
        })
        for (const candidate of result.candidates) {
          for (const note of candidate.notes) {
            const entry = chordAtBeat(harmonicMap, note.startBeat)
            if (!entry) continue
            const pc = pitchClass(note.pitch)
            const chordTones = chordTonePitchClasses(entry.parsed)
            const usable = allUsablePitchClasses(entry.parsed)
            const reasons: string[] = []
            if (!Number.isInteger(note.pitch)) reasons.push("non-integer")
            if (note.pitch < 60 || note.pitch > 79) reasons.push("outside-range")
            if (!usable.includes(pc) && !note.plannedResolution) reasons.push("unexplained-outside-usable")
            if (note.plannedToneRole === "chord-tone" && !chordTones.includes(pc)) reasons.push("chord-tone-role-mismatch")
            if (note.plannedToneRole === "tension-hold" && !usable.includes(pc)) reasons.push("tension-role-mismatch")
            if (reasons.length > 0) {
              profileFindings.push(
                `seed=${seed} pattern=${candidate.patternIndex} beat=${note.startBeat} pitch=${note.pitch} role=${note.plannedToneRole} chord=${entry.chord.symbol} reasons=${reasons.join(",")}`,
              )
            }
          }
        }
      }
      if (profileFindings.length > 0) findings.set(profile, profileFindings)
    }
    expect(
      Object.fromEntries([...findings].map(([profile, values]) => [profile, values.slice(0, 12)])),
    ).toEqual({})
  }, 30_000)
})
