import { describe, expect, it } from "vitest"
import type { ComposerProject } from "@/core/project"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import {
  applySectionTransition,
  buildSectionTransitionContext,
  isTransitionContextStale,
  type SectionTransitionContext,
} from "./sectionTransition"

const notes: MelodyNote[] = [
  { id: "n1", startBeat: 0, durationBeats: 0.5, pitch: 72, velocity: 80, locks: [] },
  { id: "n2", startBeat: 0.5, durationBeats: 0.5, pitch: 74, velocity: 80, locks: [] },
  { id: "n3", startBeat: 1, durationBeats: 1, pitch: 76, velocity: 80, locks: [] },
]

const context: SectionTransitionContext = {
  sourceSectionId: "a",
  sourceVariantId: "va",
  targetSectionId: "b",
  targetRole: "chorus",
  targetFirstChord: "Fmaj7",
  contextFingerprint: "fixed",
  previousTailNotes: notes.map((note) => ({ ...note, pitch: note.pitch - 7 })),
  previousLastPitch: 69,
  previousDirection: 1,
  previousRegisterCenter: 67,
  previousTension: 1,
  previousEndingStrategy: "suspended",
  previousMotifIntervals: [2, 2],
  targetEnergy: 0.88,
}

const targetChords = [
  { id: "cb", sectionId: "b", startBeat: 0, durationBeats: 16, symbol: "Fmaj7", bass: null },
]

function variant(id: string, sectionId: string, pitch: number): MelodyVariant {
  return {
    id,
    name: id,
    sectionId,
    sourceMode: "generate",
    notes: [{ id: `${id}-n`, startBeat: 7, durationBeats: 1, pitch, velocity: 80, locks: [] }],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "batch",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function projectWithAssignments(assignments: Record<string, string>): ComposerProject {
  return {
    schemaVersion: "1.6",
    projectId: "p",
    title: "Transition",
    song: {
      key: "Am",
      tempo: 96,
      timeSignature: "4/4",
      songProfile: "original-custom",
      sectionProfileOverrides: [],
    },
    arrangementSettings: {
      maximumParts: 5,
      spacePriority: 0.5,
      rhythmActivity: 0.5,
      stereoWidthIntent: "growing",
      acousticSyntheticBalance: 0.5,
      asymmetryIntent: 0.5,
    },
    sections: [
      { id: "a", name: "A", role: "verse", startBar: 1, lengthBars: 2 },
      { id: "b", name: "B", role: "chorus", startBar: 3, lengthBars: 4 },
    ],
    chords: [
      { id: "ca", sectionId: "a", startBeat: 0, durationBeats: 8, symbol: "Am", bass: null },
      targetChords[0],
    ],
    melodyVariants: [variant("va", "a", 69), variant("va2", "a", 64)],
    phraseCandidates: [],
    arrangementVariants: [],
    audioReferences: [],
    activeMelodyId: assignments.a ?? null,
    sectionMelodyAssignments: assignments,
    accompanimentPatterns: [],
    sectionAccompanimentPatternAssignments: {},
    activeArrangementId: null,
    notes: "",
  }
}

describe("section transition planning (Issue #30)", () => {
  it("strategyごとに掛留・弱起・応答を実音化し、MIDI範囲外を作らない", () => {
    const results = Array.from({ length: 5 }, (_, index) =>
      applySectionTransition(notes, context, index, { low: 60, high: 79 }, targetChords),
    )
    expect(new Set(results.map((result) => result.plan?.strategy)).size).toBe(5)
    expect(results.find((result) => result.plan?.strategy === "pickup-to-next")?.plan?.pickup).toBeDefined()
    expect(results.find((result) => result.plan?.strategy === "suspended")?.notes[0].startBeat).toBeGreaterThanOrEqual(0.5)
    expect(results.find((result) => result.plan?.strategy === "carry-over")?.notes[0].startBeat).toBeGreaterThanOrEqual(1)
    expect(results.flatMap((result) => result.notes).every((note) => note.pitch >= 60 && note.pitch <= 79)).toBe(true)
    expect(
      results.every((result) =>
        result.notes.slice(1).every(
          (note, index) =>
            result.notes[index].startBeat + result.notes[index].durationBeats <= note.startBeat + 1e-9,
        ),
      ),
    ).toBe(true)
    const response = results.find((result) => result.plan?.strategy === "motif-call-response")!
    expect(Math.sign(response.notes[1].pitch - response.notes[0].pitch)).toBe(-context.previousDirection)
  })

  it("同じseedとTransition Contextなら同じ3案になり、2種類以上の接続方針を選ぶ", () => {
    const input = {
      chords: targetChords,
      sectionId: "b",
      sectionRole: "chorus" as const,
      songProfile: "original-custom" as const,
      density: "balanced" as const,
      range: { low: 60, high: 79 },
      drama: "growing" as const,
      totalBeats: 16,
      seed: 314159,
      profiles: ["standard" as const],
      transitionContext: context,
    }
    const first = generateFromChordsWithProfiles(input).candidates
    const second = generateFromChordsWithProfiles(input).candidates
    const musicalNotes = (candidates: typeof first) =>
      candidates.map((candidate) =>
        candidate.notes.map(({ id: _id, ...note }) => note),
      )
    expect(musicalNotes(first)).toEqual(musicalNotes(second))
    expect(first.map((candidate) => candidate.transitionPlan)).toEqual(second.map((candidate) => candidate.transitionPlan))
    expect(new Set(first.map((candidate) => candidate.transitionPlan?.strategy)).size).toBeGreaterThanOrEqual(2)
    expect(first.every((candidate) => (candidate.transitionPlan?.transitionFitScore ?? 0) >= 55)).toBe(true)
  })

  it("前セクションのActive Melody変更を古いTransition Contextとして検出する", () => {
    const before = projectWithAssignments({ a: "va" })
    const snapshot = buildSectionTransitionContext(before, "b")
    expect(snapshot?.sourceVariantId).toBe("va")
    const generated = variant("vb", "b", 72)
    generated.transitionPlan = {
      strategy: "open",
      sourceSectionId: "a",
      sourceVariantId: "va",
      contextFingerprint: snapshot!.contextFingerprint,
      transitionFitScore: 80,
      pitchContinuityScore: 80,
      rhythmContinuityScore: 80,
      tensionResolutionScore: 80,
      motifRelationScore: 80,
      registerTrajectoryScore: 80,
      sustainAcrossBoundaryBeats: 0,
    }
    expect(isTransitionContextStale(before, generated)).toBe(false)
    expect(isTransitionContextStale(projectWithAssignments({ a: "va2" }), generated)).toBe(true)
  })

  it("前セクションが未採用ならTransition Contextを作らず、単独生成を維持する", () => {
    expect(buildSectionTransitionContext(projectWithAssignments({}), "b")).toBeUndefined()
    expect(applySectionTransition(notes, undefined, 0, { low: 60, high: 79 }, targetChords)).toEqual({ notes })
  })
})
