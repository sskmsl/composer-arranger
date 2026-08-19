import { describe, expect, it } from "vitest"
import type { MelodyVariant } from "@/core/melody"
import { createEmptyProject } from "@/core/project"
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import { reviewArrangementSection } from "./arrangementReview"

function melody(id: string, sectionId: string, pitches = [60, 64, 67]): MelodyVariant {
  return {
    id,
    name: id,
    sectionId,
    sourceMode: "generate",
    notes: pitches.map((pitch, index) => ({
      id: `${id}-${index}`,
      startBeat: index * 2,
      durationBeats: 1,
      pitch,
      velocity: 80,
      locks: [],
    })),
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "minimal-tension",
    parentMelodyId: null,
    batchId: "batch",
    createdAt: "2026-08-19T00:00:00.000Z",
  }
}

function project() {
  const value = createEmptyProject("Review")
  value.sections = [
    { id: "verse", name: "Verse", role: "verse", startBar: 1, lengthBars: 4 },
    { id: "chorus", name: "Chorus", role: "chorus", startBar: 5, lengthBars: 4 },
  ]
  value.melodyVariants = [
    melody("verse-melody", "verse"),
    melody("chorus-melody", "chorus", [64, 67, 72]),
  ]
  value.sectionMelodyAssignments = {
    verse: "verse-melody",
    chorus: "chorus-melody",
  }
  return value
}

describe("Arrangement Review Loop", () => {
  it("Active Melody未設定時は推測で採点せずレビュー待ちにする", () => {
    const value = project()
    delete value.sectionMelodyAssignments.verse
    const review = reviewArrangementSection(
      value,
      buildArrangementDirectorBlueprint(value),
      "verse",
    )
    expect(review.status).toBe("pending")
    expect(review.score).toBe(0)
  })

  it("密度・余白・衝突に問題がなければ設計整合と判定する", () => {
    const value = project()
    const review = reviewArrangementSection(
      value,
      buildArrangementDirectorBlueprint(value),
      "verse",
    )
    expect(review.status).toBe("strong")
    expect(review.score).toBe(100)
    expect(review.findings[0].id).toBe("constitution-aligned")
  })

  it("Directorの密度上限超過を根拠付きで指摘する", () => {
    const value = project()
    value.arrangementSettings.maximumParts = 2
    value.chords = [{ id: "c", sectionId: "verse", startBeat: 0, durationBeats: 16, symbol: "Am", bass: null }]
    value.sectionAccompanimentPatternAssignments.verse = "pulse-root-fifth"
    const review = reviewArrangementSection(
      value,
      buildArrangementDirectorBlueprint(value),
      "verse",
    )
    expect(review.status).toBe("revise")
    expect(review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "density-ceiling", principleId: "contrast-over-density" }),
    ]))
  })

  it("保存済み衝突診断を主旋律保護のblocking findingへ変換する", () => {
    const value = project()
    const layer = {
      id: "counter-1",
      batchId: "batch-counter",
      sectionId: "verse",
      targetMelodyVariantId: "verse-melody",
      kind: "counter",
      role: "counterline",
      name: "Counter 1",
      notes: [],
      seed: 2,
      quality: {
        melodyRespect: 40,
        harmonicFit: 70,
        gapUsage: 40,
        registerSeparation: 50,
        motifRelationship: 60,
        sectionFit: 60,
        transitionValue: 50,
        overallQuality: 55,
      },
      collisions: {
        samePitchOverlapBeats: 1,
        minorSecondOverlapBeats: 0,
        protectedMomentOverlapBeats: 1.25,
        voiceCrossingCount: 0,
        simultaneousAttackCount: 1,
        hasBlockingCollision: true,
      },
      createdAt: "2026-08-19T00:00:00.000Z",
    } satisfies ReactiveLayerCandidate
    value.reactiveLayerCandidates = [layer]
    value.sectionReactiveLayerAssignments = { verse: layer.id }
    const review = reviewArrangementSection(
      value,
      buildArrangementDirectorBlueprint(value),
      "verse",
    )
    expect(review.status).toBe("revise")
    expect(review.metrics.blockingCollisionCount).toBe(1)
    expect(review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "melody-collision", severity: "blocking" }),
    ]))
  })

  it("頂点Sectionより高い最高音を前Sectionで使うと先取りを検出する", () => {
    const value = project()
    value.melodyVariants = [
      melody("verse-melody", "verse", [67, 72, 76]),
      melody("chorus-melody", "chorus", [64, 67, 74]),
    ]
    const review = reviewArrangementSection(
      value,
      buildArrangementDirectorBlueprint(value),
      "verse",
    )
    expect(review.metrics.climaxResourceRisk).toBe(true)
    expect(review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "early-climax", principleId: "delayed-payoff" }),
    ]))
  })
})
