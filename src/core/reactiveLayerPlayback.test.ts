import { describe, expect, it } from "vitest"
import { createEmptyProject, normalizeProject } from "./project"
import type { MelodyVariant } from "./melody"
import type { ReactiveLayerCandidate } from "./reactiveLayer"
import { buildSongPlaybackMaterial } from "./sectionTimeline"
import { exportSongMidi } from "@/midi/exportMelody"

function melodyVariant(id: string): MelodyVariant {
  return {
    id,
    name: id,
    sectionId: "s1",
    sourceMode: "generate",
    notes: [
      {
        id: "melody-note",
        startBeat: 0,
        durationBeats: 1,
        pitch: 69,
        velocity: 80,
        locks: [],
      },
    ],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "melody-batch",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function reactiveCandidate(targetMelodyVariantId = "melody-a"): ReactiveLayerCandidate {
  return {
    id: "reactive-a",
    batchId: "reactive-batch",
    sectionId: "s1",
    targetMelodyVariantId,
    kind: "counter",
    role: "answer-phrase",
    name: "Answer",
    notes: [
      {
        id: "counter-note",
        startBeat: 1,
        durationBeats: 0.5,
        pitch: 57,
        velocity: 68,
        locks: [],
      },
    ],
    seed: 2,
    quality: {
      melodyRespect: 100,
      harmonicFit: 90,
      gapUsage: 100,
      registerSeparation: 90,
      motifRelationship: 75,
      sectionFit: 90,
      transitionValue: 70,
      overallQuality: 91,
    },
    collisions: {
      samePitchOverlapBeats: 0,
      minorSecondOverlapBeats: 0,
      protectedMomentOverlapBeats: 0,
      voiceCrossingCount: 0,
      simultaneousAttackCount: 0,
      hasBlockingCollision: false,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function project() {
  const project = createEmptyProject("Reactive")
  project.sections = [
    { id: "s1", name: "Verse", role: "verse", startBar: 1, lengthBars: 2 },
  ]
  project.melodyVariants = [melodyVariant("melody-a"), melodyVariant("melody-b")]
  project.sectionMelodyAssignments = { s1: "melody-a" }
  project.reactiveLayerCandidates = [reactiveCandidate()]
  project.sectionReactiveLayerAssignments = { s1: "reactive-a" }
  return project
}

describe("Issue #42 / Reactive Layer playback and persistence", () => {
  it("採用候補をMelodyとは別素材として保持し、Combined再生素材へ合成する", () => {
    const material = buildSongPlaybackMaterial(project())
    expect(material.lead.map((note) => note.id)).toEqual(["s1:melody-note"])
    expect(material.reactiveLayers.map((note) => note.id)).toEqual([
      "s1:reactive:counter-note",
    ])
    expect(material.counterLayers.map((note) => note.id)).toEqual([
      "s1:reactive:counter-note",
    ])
    expect(material.decorationLayers).toEqual([])
    expect(material.melody).toHaveLength(2)
  })

  it("Active Melodyと関連が切れたstale候補をPreview/MIDIへ混入させない", () => {
    const stale = project()
    stale.sectionMelodyAssignments.s1 = "melody-b"
    const material = buildSongPlaybackMaterial(stale)
    expect(material.reactiveLayers).toHaveLength(0)
    expect(new TextDecoder().decode(exportSongMidi(stale, false))).not.toContain(
      "Counter and Decoration",
    )
  })

  it("曲全体MIDIへSoftware Instrument互換の独立トラックとして出力する", () => {
    const bytes = exportSongMidi(project(), false)
    expect(new TextDecoder().decode(bytes)).toContain("Counter and Decoration")
  })

  it("旧Projectを読み込むとReactive Layer保存領域を空で補完する", () => {
    const migrated = normalizeProject({
      ...createEmptyProject("old"),
      schemaVersion: "1.6",
      reactiveLayerCandidates: undefined,
      sectionReactiveLayerAssignments: undefined,
    })
    expect(migrated.reactiveLayerCandidates).toEqual([])
    expect(migrated.sectionReactiveLayerAssignments).toEqual({})
    expect(migrated.sectionDecorationLayerAssignments).toEqual({})
  })
})
