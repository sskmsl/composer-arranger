import { describe, expect, it } from "vitest"
import { SeededRandom } from "@/core/rng"
import type { MelodyOpeningPlan } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { buildHarmonicMap } from "./harmonicMap"
import { resolveGenerationParams } from "./generationParams"
import {
  createPlacementDiagnostics,
  placeSegment,
} from "./phraseAssembler"
import type { MotifEvent } from "./motifCore"

const range = { low: 48, high: 84 }
const params = resolveGenerationParams("original-custom", "verse", "balanced", "growing")
const cMajor: ChordEvent[] = [
  { id: "c", sectionId: "s", startBeat: 0, durationBeats: 8, symbol: "C", bass: null },
]

function events(durations: number[]): MotifEvent[] {
  let cursor = 0
  return durations.map((durationBeats) => {
    const event = { offsetBeats: cursor, durationBeats, isRest: false }
    cursor += durationBeats
    return event
  })
}

function openingSuspension(): MelodyOpeningPlan {
  return {
    intent: {
      entryType: "suspension",
      emotionalFunction: "hesitation",
      register: "middle",
      initialDirection: "descending",
    },
    startPitchClass: 1,
    startScaleDegree: 1,
    startBeatOffset: 0,
    firstNoteDuration: 1,
    initialDirection: "descending",
    openingContour: "suspension-entry",
    openingRegister: { lowestMidiNote: 58, highestMidiNote: 72 },
    openingPhraseLengthBeats: 4,
  }
}

describe("placeSegment: planned tone roleを保持する選択的補正", () => {
  it("planned chord toneを変更しない", () => {
    const diagnostics = createPlacementDiagnostics()
    const notes = placeSegment(events([1]), [64], 0, buildHarmonicMap(cMajor), range, params, new SeededRandom(1), { diagnostics })
    expect(notes[0].pitch).toBe(64)
    expect(notes[0].plannedToneRole).toBe("chord-tone")
    expect(diagnostics.changedPitchCount).toBe(0)
  })

  it("appoggiaturaが2拍以内のコードトーンへ解決する場合は保持する", () => {
    const notes = placeSegment(events([1, 1]), [61, 60], 0, buildHarmonicMap(cMajor), range, params, new SeededRandom(2))
    expect(notes[0].pitch).toBe(61)
    expect(notes[0].plannedToneRole).toBe("appoggiatura")
    expect(notes[0].plannedResolution).toMatchObject({ targetPitchClass: 0, targetBeat: 1 })
  })

  it("Opening Planのsuspensionをコードトーン化せず保持する", () => {
    const notes = placeSegment(events([1, 1]), [61, 60], 0, buildHarmonicMap(cMajor), range, params, new SeededRandom(3), {
      opening: openingSuspension(),
    })
    expect(notes[0].pitch).toBe(61)
    expect(notes[0].plannedToneRole).toBe("suspension")
  })

  it("コード境界をまたぐsuspensionと遅延解決を保持する", () => {
    const chords: ChordEvent[] = [
      { id: "c", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "C", bass: null },
      { id: "g", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "G", bass: null },
    ]
    const notes = placeSegment(events([2, 1]), [60, 59], 3, buildHarmonicMap(chords), range, params, new SeededRandom(4))
    expect(notes[0].pitch).toBe(60)
    expect(notes[0].plannedToneRole).toBe("suspension")
    expect(notes[0].plannedResolution?.targetPitchClass).toBe(11)
  })

  it("次コードのコードトーンを先取りするanticipationを保持する", () => {
    const chords: ChordEvent[] = [
      { id: "c", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "C", bass: null },
      { id: "g", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "G", bass: null },
    ]
    const notes = placeSegment(events([0.5, 1]), [62, 67], 3.5, buildHarmonicMap(chords), range, params, new SeededRandom(5))
    expect(notes[0].pitch).toBe(62)
    expect(notes[0].plannedToneRole).toBe("anticipation")
    expect(notes[0].plannedResolution).toEqual({
      targetPitchClass: 2,
      targetBeat: 4,
      maximumDelayBeats: 1,
    })
  })

  it("解決も和声的役割もない強拍衝突だけを補正する", () => {
    const diagnostics = createPlacementDiagnostics()
    const notes = placeSegment(events([1]), [61], 0, buildHarmonicMap(cMajor), range, params, new SeededRandom(6), { diagnostics })
    expect(notes[0].pitch).not.toBe(61)
    expect(diagnostics.changedPitchCount).toBe(1)
    expect(diagnostics.corrections[0].reason).toBe("unresolved-strong-beat-conflict")
  })

  it("補正が必要でも上行contourを可能な限り維持する", () => {
    const notes = placeSegment(events([1, 1, 1]), [61, 65, 70], 0, buildHarmonicMap(cMajor), range, params, new SeededRandom(7))
    expect(notes[1].pitch).toBeGreaterThanOrEqual(notes[0].pitch)
    expect(notes[2].pitch).toBeGreaterThanOrEqual(notes[1].pitch)
  })

  it("Chromaticで使用可能なtension noteを一律コードトーン化しない", () => {
    const chromaticParams = { ...params, tensionUsageTarget: 0.55 }
    const notes = placeSegment(events([1]), [62], 0, buildHarmonicMap(cMajor), range, chromaticParams, new SeededRandom(8))
    expect(notes[0].pitch).toBe(62)
    expect(notes[0].plannedToneRole).toBe("tension-hold")
  })
})
