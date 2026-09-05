import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ArrangementPlan, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { applyArrangementPerformanceDirector, buildArrangementPerformancePlan } from "./arrangementPerformanceDirector"

function fixture() {
  const project = createEmptyProject("Performance Director")
  project.sections = [{ id: "pre", name: "Pre", role: "pre-chorus", startBar: 1, lengthBars: 4 }]
  project.chords = [{ id: "chord", sectionId: "pre", startBeat: 0, durationBeats: 16, symbol: "Am(add9)", bass: null }]
  const plan: ArrangementPlan = {
    version: "1.0.0",
    brief: "後半へ向けて期待を高める",
    seed: 1,
    sections: [{
      sectionId: "pre",
      sectionName: "Pre",
      sectionRole: "pre-chorus",
      semanticRole: "pre",
      energy: 62,
      density: "medium",
      register: { low: "medium", mid: "strong", high: "medium" },
      intention: "次Sectionへ向かう",
      activeRoles: ["syn-bass"],
      transitionCandidates: [],
      selectedTransitionCharacter: "silence",
      decorationCandidates: [],
      selectedDecorationCharacter: "silence",
      bassStrategy: "approach-led",
    }],
  }
  const track: GeneratedArrangementTrack = {
    id: "syn-bass",
    name: "SYN_Bass",
    family: "bass",
    muted: false,
    generationRevision: 0,
    purpose: "重力",
    notes: [0, 2.5, 4, 6.5, 8, 10.5, 12, 14.5].map((startBeat, index) => ({
      id: `bass:${index}`,
      sectionId: "pre",
      character: "safe" as const,
      reason: "test",
      startBeat,
      durationBeats: 1,
      pitch: index % 2 === 0 ? 45 : 48,
      velocity: 64,
      locks: [],
    })),
  }
  return { project, plan, track }
}

describe("Arrangement Performance Director", () => {
  it("PitchとIDを変えず、Sectionのbuild arcを強弱・音価・microtimingへ反映する", () => {
    const { project, plan, track } = fixture()
    const result = applyArrangementPerformanceDirector(project, plan, [track])[0]

    expect(result.notes.map((note) => note.pitch)).toEqual(track.notes.map((note) => note.pitch))
    expect(result.notes.map((note) => note.id)).toEqual(track.notes.map((note) => note.id))
    const earlyAverage = result.notes.slice(0, 4).reduce((sum, note) => sum + note.velocity, 0) / 4
    const lateAverage = result.notes.slice(4).reduce((sum, note) => sum + note.velocity, 0) / 4
    expect(lateAverage).toBeGreaterThan(earlyAverage)
    expect(result.notes.some((note, index) => note.durationBeats !== track.notes[index].durationBeats)).toBe(true)
    expect(result.performance?.changedVelocityCount).toBeGreaterThan(0)
    expect(result.performance?.changedOnsetCount).toBeGreaterThan(0)
    expect(result.performance?.sectionPlans[0].arc).toBe("build")
  })

  it("楽器役割に応じて奏法とタイミングを決める", () => {
    const { plan } = fixture()
    const section = plan.sections[0]

    expect(buildArrangementPerformancePlan("dr-kick", section)).toMatchObject({ articulation: "pulsed", timing: "strict" })
    expect(buildArrangementPerformancePlan("dr-snare", section)).toMatchObject({ articulation: "pulsed", timing: "slightly-behind" })
    expect(buildArrangementPerformancePlan("syn-dark-pad", section)).toMatchObject({ articulation: "sustained", timing: "slightly-behind" })
    expect(buildArrangementPerformancePlan("syn-transition-phrase", section)).toMatchObject({ articulation: "swelling", timing: "slightly-ahead" })
  })
})
