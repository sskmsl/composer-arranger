import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import { reviewWholeSongArrangement } from "./wholeSongArrangementReview"

function variant(id: string, sectionId: string, pitch: number): MelodyVariant {
  return {
    id,
    sectionId,
    name: id,
    sourceMode: "generate",
    notes: [{ id: `${id}:n`, startBeat: 0, durationBeats: 1, pitch, velocity: 72, locks: [] }],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "batch",
    createdAt: "2026-08-19T00:00:00.000Z",
  }
}

function project() {
  const value = createEmptyProject("Whole song")
  value.sections = [
    { id: "verse", name: "Verse", role: "verse", startBar: 1, lengthBars: 4 },
    { id: "chorus", name: "Chorus", role: "chorus", startBar: 5, lengthBars: 4 },
  ]
  return value
}

describe("Whole-song Arrangement Review", () => {
  it("Active素材が未確定なら全曲評価を暫定状態にする", () => {
    const value = project()
    const review = reviewWholeSongArrangement(
      value,
      buildArrangementDirectorBlueprint(value),
    )
    expect(review.status).toBe("pending")
    expect(review.metrics.pendingSectionCount).toBe(2)
  })

  it("Energyが変わるのに同じ伴奏と同じ密度が続く平坦化を検出する", () => {
    const value = project()
    value.melodyVariants = [variant("v", "verse", 67), variant("c", "chorus", 76)]
    value.sectionMelodyAssignments = { verse: "v", chorus: "c" }
    value.sectionAccompanimentPatternAssignments = {
      verse: "arpeggio-up",
      chorus: "arpeggio-up",
    }
    const review = reviewWholeSongArrangement(
      value,
      buildArrangementDirectorBlueprint(value),
    )
    expect(review.status).toBe("watch")
    expect(review.metrics.energyContrastScore).toBeLessThan(0.55)
    expect(review.metrics.repeatedSupportPatternCount).toBe(1)
    expect(review.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["flat-energy-contrast", "repeated-support-pattern"]),
    )
  })
})
