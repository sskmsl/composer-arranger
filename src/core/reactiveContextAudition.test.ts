import { describe, expect, it } from "vitest"
import type { MelodyVariant } from "./melody"
import { createEmptyProject } from "./project"
import type { ReactiveLayerCandidate } from "./reactiveLayer"
import { buildReactiveContextAuditionMaterial } from "./reactiveContextAudition"

function melody(): MelodyVariant {
  return {
    id: "melody-1",
    name: "Lead",
    sectionId: "intro",
    sourceMode: "generate",
    notes: [
      { id: "m1", startBeat: 0, durationBeats: 1, pitch: 64, velocity: 80, locks: [] },
      { id: "m2", startBeat: 2, durationBeats: 1, pitch: 67, velocity: 82, locks: [] },
    ],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "minimal-tension",
    parentMelodyId: null,
    batchId: "melody-batch",
    createdAt: "2026-08-20T00:00:00.000Z",
  }
}

function reactive(
  id: string,
  kind: "counter" | "decoration",
  pitch: number,
): ReactiveLayerCandidate {
  return {
    id,
    batchId: `${id}-batch`,
    sectionId: "intro",
    targetMelodyVariantId: kind === "counter" ? "melody-1" : null,
    kind,
    role: kind === "counter" ? "answer-phrase" : "transition",
    name: id,
    notes: [
      { id: `${id}-note`, startBeat: 1, durationBeats: 0.5, pitch, velocity: 68, locks: [] },
    ],
    seed: 2,
    quality: {
      melodyRespect: 90,
      harmonicFit: 90,
      gapUsage: 90,
      registerSeparation: 90,
      motifRelationship: 80,
      sectionFit: 85,
      transitionValue: 80,
      overallQuality: 87,
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

function project() {
  const project = createEmptyProject("Context audition")
  project.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 2 },
  ]
  project.chords = [
    { id: "c1", sectionId: "intro", startBeat: 0, durationBeats: 4, symbol: "Am", bass: null },
    { id: "c2", sectionId: "intro", startBeat: 4, durationBeats: 4, symbol: "Fmaj7", bass: null },
  ]
  project.melodyVariants = [melody()]
  project.sectionMelodyAssignments = { intro: "melody-1" }
  project.sectionAccompanimentPatternAssignments = { intro: "syncopated" }
  return project
}

describe("Reactive Context Audition", () => {
  it("Decoration候補をActive Melody・Pattern・Active Counterと同時試聴できる材料へする", () => {
    const value = project()
    const counter = reactive("active-counter", "counter", 52)
    const decoration = reactive("candidate-decoration", "decoration", 76)
    value.reactiveLayerCandidates = [counter, decoration]
    value.sectionReactiveLayerAssignments = { intro: counter.id }
    const material = buildReactiveContextAuditionMaterial(
      value,
      "intro",
      decoration,
    )
    expect(material.melody).toHaveLength(2)
    expect(material.accompaniment.length).toBeGreaterThan(0)
    expect(material.reactive.map((note) => note.pitch)).toEqual([52, 76])
    expect(material.includedActiveLayerNames).toEqual(["active-counter"])
  })

  it("現在のActive Melody向けでない古いCounterは試聴へ混ぜない", () => {
    const value = project()
    const staleCounter = {
      ...reactive("stale-counter", "counter", 52),
      targetMelodyVariantId: "old-melody",
    }
    const decoration = reactive("candidate-decoration", "decoration", 76)
    value.reactiveLayerCandidates = [staleCounter, decoration]
    value.sectionReactiveLayerAssignments = { intro: staleCounter.id }
    const material = buildReactiveContextAuditionMaterial(
      value,
      "intro",
      decoration,
    )
    expect(material.reactive).toEqual(decoration.notes)
    expect(material.includedActiveLayerNames).toEqual([])
  })
})
