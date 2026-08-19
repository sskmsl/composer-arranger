import { describe, expect, it } from "vitest"
import type { MelodyVariant } from "@/core/melody"
import { createEmptyProject } from "@/core/project"
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import { reviewAudibleLayerCollisions } from "./audibleLayerReview"

function melody(notes = [
  { id: "m1", startBeat: 0, durationBeats: 1, pitch: 69, velocity: 80, locks: [] },
  { id: "m2", startBeat: 2, durationBeats: 2, pitch: 76, velocity: 86, locks: [] },
]): MelodyVariant {
  return {
    id: "melody-1",
    name: "Lead",
    sectionId: "intro",
    sourceMode: "generate",
    notes,
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "minimal-tension",
    parentMelodyId: null,
    batchId: "batch-1",
    createdAt: "2026-08-20T00:00:00.000Z",
  }
}

function project() {
  const value = createEmptyProject("Audible review")
  value.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 2 },
  ]
  value.melodyVariants = [melody()]
  value.sectionMelodyAssignments = { intro: "melody-1" }
  return value
}

function reactive(notes: ReactiveLayerCandidate["notes"]): ReactiveLayerCandidate {
  return {
    id: "counter-1",
    batchId: "counter-batch",
    sectionId: "intro",
    targetMelodyVariantId: "melody-1",
    kind: "counter",
    role: "counterline",
    name: "Counter",
    notes,
    seed: 2,
    quality: {
      melodyRespect: 80,
      harmonicFit: 80,
      gapUsage: 80,
      registerSeparation: 80,
      motifRelationship: 80,
      sectionFit: 80,
      transitionValue: 80,
      overallQuality: 80,
    },
    collisions: {
      samePitchOverlapBeats: 0,
      minorSecondOverlapBeats: 0,
      protectedMomentOverlapBeats: 0,
      voiceCrossingCount: 0,
      simultaneousAttackCount: 0,
      hasBlockingCollision: false,
    },
    createdAt: "2026-08-20T00:00:00.000Z",
  }
}

describe("Audible Layer Collision Review", () => {
  it("Lead単独ではstrongとし、不要な修正を要求しない", () => {
    const review = reviewAudibleLayerCollisions(project(), "intro")
    expect(review).toMatchObject({ status: "strong", score: 100 })
    expect(review.metrics.reviewedSupportLayerCount).toBe(0)
  })

  it("保存済み候補scoreではなく現在Activeの実音から同音衝突を再計算する", () => {
    const value = project()
    const counter = reactive([
      { id: "c1", startBeat: 2, durationBeats: 1, pitch: 76, velocity: 72, locks: [] },
      { id: "c2", startBeat: 3, durationBeats: 1, pitch: 76, velocity: 70, locks: [] },
    ])
    value.reactiveLayerCandidates = [counter]
    value.sectionReactiveLayerAssignments = { intro: counter.id }
    const review = reviewAudibleLayerCollisions(value, "intro")
    expect(review.status).toBe("revise")
    expect(review.metrics.samePitchOverlapBeats).toBe(2)
    expect(review.metrics.protectedAttackCount).toBeGreaterThan(0)
    expect(review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pitch-collision", severity: "blocking" }),
    ]))
  })

  it("音域と発音位置を分離したCounterはstrongを維持する", () => {
    const value = project()
    const counter = reactive([
      { id: "c1", startBeat: 1, durationBeats: 0.5, pitch: 55, velocity: 64, locks: [] },
      { id: "c2", startBeat: 4.5, durationBeats: 0.5, pitch: 57, velocity: 62, locks: [] },
    ])
    value.reactiveLayerCandidates = [counter]
    value.sectionReactiveLayerAssignments = { intro: counter.id }
    const review = reviewAudibleLayerCollisions(value, "intro")
    expect(review.status).toBe("strong")
    expect(review.metrics.samePitchOverlapBeats).toBe(0)
    expect(review.metrics.semitoneOverlapBeats).toBe(0)
  })

  it("Active Melodyが無いSectionはpendingにする", () => {
    const value = project()
    value.melodyVariants = []
    value.sectionMelodyAssignments = {}
    expect(reviewAudibleLayerCollisions(value, "intro").status).toBe("pending")
  })
})
