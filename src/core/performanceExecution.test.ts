import { describe, expect, it } from "vitest"
import type { MelodyNote } from "./melody"
import {
  applyPerformanceExecution,
  reviewPerformanceExecution,
  type PerformanceExecutionPlan,
} from "./performanceExecution"

function note(
  id: string,
  startBeat: number,
  durationBeats: number,
  pitch: number,
  velocity: number,
  locks: MelodyNote["locks"] = [],
): MelodyNote {
  return { id, startBeat, durationBeats, pitch, velocity, locks }
}

const context = {
  totalBeats: 8,
  beatsPerBar: 4,
  chordBoundaryBeats: [0, 2, 4, 6],
}

function plan(patch: Partial<PerformanceExecutionPlan> = {}): PerformanceExecutionPlan {
  return {
    role: "lead-focus",
    velocityRange: [45, 64],
    articulation: "decaying",
    timing: "floating",
    ...patch,
  }
}

describe("Performance Execution Bridge", () => {
  it("PitchとIDを変えず、元のアクセント差をVelocity範囲へ写像する", () => {
    const source = [note("a", 0, 1, 60, 60), note("b", 1, 1, 67, 100)]
    const result = applyPerformanceExecution(source, plan(), context)
    expect(result.notes.map((value) => [value.id, value.pitch])).toEqual([
      ["a", 60],
      ["b", 67],
    ])
    expect(result.notes.map((value) => value.velocity)).toEqual([45, 64])
    expect(result.diagnostics.pitchChangeCount).toBe(0)
  })

  it("小節頭・コード境界はmicrotimingから保護し、裏拍だけ安全に後置する", () => {
    const source = [note("bar", 0, 0.5, 60, 70), note("off", 1.5, 0.5, 62, 70)]
    const result = applyPerformanceExecution(
      source,
      plan({ timing: "slightly-behind" }),
      context,
    )
    expect(result.notes[0].startBeat).toBe(0)
    expect(result.notes[1].startBeat).toBe(1.53)
    expect(result.diagnostics.protectedBoundaryCount).toBe(1)
  })

  it("Rhythm/Start Lockを尊重する", () => {
    const source = [note("locked", 1.5, 1, 60, 80, ["rhythm", "startPosition"])]
    const result = applyPerformanceExecution(
      source,
      plan({ articulation: "detached", timing: "slightly-ahead" }),
      context,
    )
    expect(result.notes[0]).toMatchObject({ startBeat: 1.5, durationBeats: 1 })
  })

  it("Counterを次の主旋律アタック前に退場させる", () => {
    const source = [note("counter", 1, 2, 55, 90)]
    const result = applyPerformanceExecution(
      source,
      plan({ role: "counter-voice", articulation: "sustained" }),
      {
        ...context,
        melodyNotes: [note("melody", 2, 1, 67, 90)],
      },
    )
    expect(result.notes[0].startBeat + result.notes[0].durationBeats).toBeLessThan(2)
    expect(result.diagnostics.collisionTrimCount).toBe(1)
  })

  it("detachedは音価を短くするが、ゼロ音価やSection外を作らない", () => {
    const source = [note("short", 7.95, 0.5, 60, 80)]
    const result = applyPerformanceExecution(
      source,
      plan({ articulation: "detached", timing: "slightly-behind" }),
      context,
    )
    expect(result.notes[0].durationBeats).toBeGreaterThanOrEqual(0.0625)
    expect(result.notes[0].startBeat + result.notes[0].durationBeats).toBeLessThanOrEqual(8.0001)
  })

  it("安全に反映された候補をStrongとして採用判断へ渡す", () => {
    const source = [note("a", 0, 1, 60, 60), note("b", 1, 1, 64, 90)]
    const executionPlan = plan({ velocityRange: [50, 70] })
    const result = applyPerformanceExecution(source, executionPlan, context)
    const review = reviewPerformanceExecution(
      "candidate",
      source,
      result,
      executionPlan,
      context,
    )
    expect(review.status).toBe("strong")
    expect(review.score).toBeGreaterThanOrEqual(90)
  })

  it("主旋律との重大衝突が残る候補をReviseにする", () => {
    const source = [note("counter", 1, 1, 55, 70)]
    const executionPlan = plan({ role: "counter-voice" })
    const result = applyPerformanceExecution(source, executionPlan, context)
    const review = reviewPerformanceExecution(
      "counter",
      source,
      result,
      executionPlan,
      context,
      { hasBlockingCollision: true },
    )
    expect(review.status).toBe("revise")
    expect(review.findings.join(" ")).toContain("主旋律")
  })
})
