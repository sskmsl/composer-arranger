import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { enforceHarmonicIntegrity } from "./harmonicIntegrity"

const chords: ChordEvent[] = [
  { id: "c1", sectionId: "s1", symbol: "C", bass: null, startBeat: 0, durationBeats: 4 },
  { id: "c2", sectionId: "s1", symbol: "F", bass: null, startBeat: 4, durationBeats: 4 },
]

function note(
  id: string,
  startBeat: number,
  pitch: number,
  durationBeats = 0.5,
  extra: Partial<MelodyNote> = {},
): MelodyNote {
  return { id, startBeat, pitch, durationBeats, velocity: 84, locks: [], ...extra }
}

describe("enforceHarmonicIntegrity", () => {
  it("keeps chord tones unchanged", () => {
    const result = enforceHarmonicIntegrity([note("n1", 0, 64)], chords)
    expect(result.notes[0].pitch).toBe(64)
    expect(result.diagnostics.correctedPitchCount).toBe(0)
  })

  it("repairs stale metadata when the performed notes make a real resolution", () => {
    const result = enforceHarmonicIntegrity(
      [
        note("n1", 0, 63, 0.5, {
          plannedToneRole: "appoggiatura",
          plannedResolution: {
            targetPitchClass: 0,
            targetBeat: 2,
            maximumDelayBeats: 2,
          },
        }),
        note("n2", 1, 64, 0.5, { plannedToneRole: "chord-tone" }),
      ],
      chords,
    )
    expect(result.notes[0].pitch).toBe(63)
    expect(result.notes[0].plannedResolution).toEqual({
      targetPitchClass: 4,
      targetBeat: 1,
      maximumDelayBeats: 1,
    })
    expect(result.diagnostics.repairedResolutionCount).toBe(1)
  })

  it("corrects a strong-beat non-chord tone with no musical explanation", () => {
    const result = enforceHarmonicIntegrity(
      [note("n1", 0, 61, 0.5, { plannedToneRole: "passing-tone" })],
      chords,
    )
    expect([60, 64, 67]).toContain(result.notes[0].pitch)
    expect(result.notes[0].plannedToneRole).toBe("chord-tone")
    expect(result.diagnostics.correctedPitchCount).toBe(1)
  })

  it("shortens an unexplained sustain at the chord boundary instead of changing its contour", () => {
    const result = enforceHarmonicIntegrity(
      [note("n1", 3, 64, 2, { plannedToneRole: "chord-tone" })],
      chords,
    )
    expect(result.notes[0].pitch).toBe(64)
    expect(result.notes[0].durationBeats).toBe(1)
    expect(result.diagnostics.shortenedAcrossBoundaryCount).toBe(1)
  })

  it("keeps a suspension across a boundary when it resolves by step", () => {
    const result = enforceHarmonicIntegrity(
      [
        note("n1", 3, 64, 1.5, {
          plannedToneRole: "suspension",
          plannedResolution: {
            targetPitchClass: 5,
            targetBeat: 4.5,
            maximumDelayBeats: 2,
          },
        }),
        note("n2", 4.5, 65, 0.5, { plannedToneRole: "chord-tone" }),
      ],
      chords,
    )
    expect(result.notes[0].pitch).toBe(64)
    expect(result.notes[0].durationBeats).toBe(1.5)
    expect(result.notes[0].plannedToneRole).toBe("suspension")
    expect(result.diagnostics.shortenedAcrossBoundaryCount).toBe(0)
  })

  it("keeps an intentional chord tension instead of flattening all color tones", () => {
    const result = enforceHarmonicIntegrity(
      [note("n1", 0, 62, 1, { plannedToneRole: "tension-hold" })],
      chords,
    )
    expect(result.notes[0].pitch).toBe(62)
    expect(result.notes[0].plannedToneRole).toBe("tension-hold")
  })
})
