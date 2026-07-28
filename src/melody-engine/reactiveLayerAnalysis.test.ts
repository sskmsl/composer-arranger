import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import {
  analyzeMelodyActivity,
  assessReactiveLayerCollisions,
  evaluateReactiveLayerQuality,
  evaluateReactiveLayerCompatibility,
  isReactiveLayerStale,
  unresolvedReactiveToneNoteIds,
} from "./reactiveLayerAnalysis"

function note(
  id: string,
  startBeat: number,
  durationBeats: number,
  pitch: number,
  patch: Partial<MelodyNote> = {},
): MelodyNote {
  return { id, startBeat, durationBeats, pitch, velocity: 80, locks: [], ...patch }
}

const melody = [
  note("m1", 0, 1, 64),
  note("m2", 2, 2, 67),
  note("m3", 5, 0.5, 74),
  note("m4", 6, 1, 69, {
    plannedToneRole: "suspension",
    plannedResolution: { targetPitchClass: 4, targetBeat: 7, maximumDelayBeats: 1 },
  }),
]

describe("Issue #42 / Active Melody activity analysis", () => {
  it("休符区間とProtected Momentを抽出する", () => {
    const analysis = analyzeMelodyActivity(melody, 8)
    expect(analysis.gaps).toEqual([
      { startBeat: 1, endBeat: 2, durationBeats: 1 },
      { startBeat: 4, endBeat: 5, durationBeats: 1 },
      { startBeat: 5.5, endBeat: 6, durationBeats: 0.5 },
      { startBeat: 7, endBeat: 8, durationBeats: 1 },
    ])
    expect(
      analysis.protectedMoments.find((moment) => moment.pitch === 74)?.reasons,
    ).toContain("highest-note")
    expect(
      analysis.protectedMoments.find((moment) => moment.startBeat === 2)?.reasons,
    ).toContain("long-note")
    expect(
      analysis.protectedMoments.find((moment) => moment.startBeat === 6)?.reasons,
    ).toContain("non-chord-resolution")
  })

  it("Melodyと分離できる音域と密度予算を返す", () => {
    const analysis = analyzeMelodyActivity(melody, 8)
    expect(analysis.registerBudget.preferredSide).toBe("below")
    expect(analysis.registerBudget.high).toBeLessThan(analysis.registerBudget.melodyLow)
    expect(analysis.maximumNoteCount).toBeGreaterThanOrEqual(2)
  })
})

describe("Issue #42 / collision and quality", () => {
  it("休符内・別音域の候補を高く評価する", () => {
    const analysis = analyzeMelodyActivity(melody, 8)
    const candidate = [
      note("c1", 1, 0.5, 55),
      note("c2", 4, 0.5, 57),
      note("c3", 7, 0.5, 59),
    ]
    const evaluated = evaluateReactiveLayerQuality(melody, candidate, analysis, {
      harmonicFit: 90,
      sectionFit: 90,
    })
    expect(evaluated.collisions.hasBlockingCollision).toBe(false)
    expect(evaluated.quality.gapUsage).toBe(100)
    // 休符内で衝突はないが、この密度のMelodyに対する予算(2音)を1音だけ超える。
    expect(evaluated.quality.melodyRespect).toBeGreaterThanOrEqual(90)
    expect(evaluated.quality.overallQuality).toBeGreaterThan(75)
  })

  it("ロングトーンのAttackを保護しつつ後半のCounterを許可する", () => {
    const sustainedMelody = [
      note("high-a", 0, 1, 72),
      note("long", 1, 3, 64),
      note("high-b", 4, 1, 72),
    ]
    const analysis = analyzeMelodyActivity(sustainedMelody, 8)
    const candidate = [
      note("c1", 2, 0.5, 52),
      note("c2", 2.75, 0.5, 54),
      note("c3", 3.5, 0.25, 55),
    ]
    const collisions = assessReactiveLayerCollisions(
      sustainedMelody,
      candidate,
      analysis,
    )
    expect(collisions.protectedMomentOverlapBeats).toBe(0)
    expect(collisions.hasBlockingCollision).toBe(false)
  })

  it("planned非和声音の解決実音を検証し、意図的なtension holdは許可する", () => {
    const resolved = [
      note("approach", 1, 0.5, 61, {
        plannedToneRole: "approach-tone",
        plannedResolution: {
          targetPitchClass: 2,
          targetBeat: 1.5,
          maximumDelayBeats: 0.5,
        },
      }),
      note("target", 1.5, 0.5, 62, { plannedToneRole: "chord-tone" }),
      note("hold", 3, 1, 66, { plannedToneRole: "tension-hold" }),
    ]
    expect(unresolvedReactiveToneNoteIds(resolved)).toEqual([])
    expect(
      unresolvedReactiveToneNoteIds([
        {
          ...resolved[0],
          plannedResolution: {
            targetPitchClass: 7,
            targetBeat: 1.5,
            maximumDelayBeats: 0.5,
          },
        },
        resolved[1],
      ]),
    ).toEqual(["approach"])
  })

  it("CounterとDecorationを重ねた結果の同音・短2度・総密度を共通評価する", () => {
    const candidate = (
      id: string,
      notes: MelodyNote[],
    ): ReactiveLayerCandidate =>
      ({
        id,
        notes,
        collisions: {
          hasBlockingCollision: false,
        },
      }) as ReactiveLayerCandidate
    const compatibility = evaluateReactiveLayerCompatibility(
      melody,
      [
        candidate("counter", [
          note("c1", 1, 1, 55),
          note("c2", 4, 1, 57),
          note("c3", 7, 1, 59),
        ]),
        candidate("decoration", [
          note("d1", 1, 1, 55),
          note("d2", 4, 1, 58),
          note("d3", 7, 1, 60),
        ]),
      ],
      8,
    )
    expect(compatibility.samePitchOverlapBeats).toBeGreaterThan(0.5)
    expect(compatibility.minorSecondOverlapBeats).toBeGreaterThan(0.5)
    expect(compatibility.hasBlockingConflict).toBe(true)
  })

  it("同音・短2度・Protected Moment・voice crossingを検出する", () => {
    const analysis = analyzeMelodyActivity(melody, 8)
    const candidate = [
      note("c1", 2, 1, 67),
      note("c2", 2.5, 1, 68),
      note("c3", 5, 0.5, 75),
      note("c4", 6, 1, 69),
    ]
    const collisions = assessReactiveLayerCollisions(melody, candidate, analysis)
    expect(collisions.samePitchOverlapBeats).toBeGreaterThan(0)
    expect(collisions.minorSecondOverlapBeats).toBeGreaterThan(0)
    expect(collisions.protectedMomentOverlapBeats).toBeGreaterThan(0)
    expect(collisions.voiceCrossingCount).toBeGreaterThan(0)
    expect(collisions.hasBlockingCollision).toBe(true)
  })

  it("主旋律と同時・同方向の大跳躍を検出する", () => {
    const leapMelody = [
      note("m1", 0, 0.5, 60),
      note("m2", 1, 0.5, 67),
      note("m3", 2, 0.5, 62),
    ]
    const analysis = analyzeMelodyActivity(leapMelody, 4)
    const collisions = assessReactiveLayerCollisions(
      leapMelody,
      [
        note("c1", 0, 0.5, 48),
        note("c2", 1, 0.5, 55),
        note("c3", 2, 0.5, 50),
      ],
      analysis,
    )
    expect(collisions.parallelLargeLeapCount).toBe(2)
    expect(collisions.hasBlockingCollision).toBe(true)
  })

  it("Active Melody変更時に採用候補をstaleとして扱う", () => {
    const project = createEmptyProject("reactive")
    project.sectionMelodyAssignments = { s1: "melody-a" }
    const candidate = {
      id: "r1",
      sectionId: "s1",
      targetMelodyVariantId: "melody-a",
    } as ReactiveLayerCandidate
    expect(isReactiveLayerStale(project, candidate)).toBe(false)
    project.sectionMelodyAssignments.s1 = "melody-b"
    expect(isReactiveLayerStale(project, candidate)).toBe(true)
  })
})
