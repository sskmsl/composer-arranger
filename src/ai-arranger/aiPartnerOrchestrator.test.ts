import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import { buildAiPartnerOrchestrationPlan } from "./aiPartnerOrchestrator"

function project() {
  const value = createEmptyProject("AI Orchestrator")
  value.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
    { id: "verse", name: "Verse", role: "verse", startBar: 5, lengthBars: 4 },
    { id: "chorus", name: "Chorus", role: "chorus", startBar: 9, lengthBars: 4 },
  ]
  value.chords = value.sections.map((section) => ({
    id: `${section.id}:chord`,
    sectionId: section.id,
    startBeat: 0,
    durationBeats: 16,
    symbol: "Am(add9)",
    bass: null,
  }))
  value.melodyVariants = value.sections.map((section): MelodyVariant => ({
    id: `${section.id}:melody`,
    name: section.name,
    sectionId: section.id,
    sourceMode: "import-midi",
    notes: [{ id: `${section.id}:note`, pitch: 60, startBeat: 0, durationBeats: 2, velocity: 80, locks: [] }],
    phrasePlans: [], lockedBars: [], motifLocked: false, features: null,
    generatorVersion: "test", seed: 1, songProfile: value.song.songProfile,
    parentMelodyId: null, batchId: "batch", createdAt: "2026-01-01T00:00:00.000Z",
  }))
  value.sectionMelodyAssignments = Object.fromEntries(
    value.melodyVariants.map((variant) => [variant.sectionId, variant.id]),
  )
  value.arrangementDirectorWorkspace = {
    brief: "音数は増やさず、余白を守る",
    selectedDirectionId: "motif-relay",
  }
  return value
}

describe("AI Partner orchestration plan", () => {
  it("曲全体の方向と現在Sectionから、実行可能な次の一手を一つ返す", () => {
    const plan = buildAiPartnerOrchestrationPlan(project(), "verse")
    expect(plan.directionId).toBe("motif-relay")
    expect(plan.nextAction?.sectionId).toBe("verse")
    expect(plan.nextAction?.status).toBe("available")
    expect(plan.nextActionReason).toContain("現在のSection")
  })

  it("全Sectionの会話で確定した制約を、保護対象へ引き継ぐ", () => {
    const value = project()
    value.aiPartnerSessions = {
      verse: {
        sectionId: "verse",
        updatedAt: "2026-01-01T00:00:00.000Z",
        confirmedConstraints: ["メロディは変えない", "ベルは使わない"],
        turns: [],
      },
    }
    const plan = buildAiPartnerOrchestrationPlan(value, "verse")
    expect(plan.constraints).toEqual(expect.arrayContaining(["メロディは変えない", "ベルは使わない"]))
    expect(plan.protect).toContain("メロディは変えない")
  })

  it("Rejectされた同Section・同Generatorより、別の実行可能な仕事を優先する", () => {
    const value = project()
    value.reactiveLayerCandidates = [{
      id: "rejected-counter", batchId: "batch", sectionId: "verse",
      targetMelodyVariantId: "verse:melody", kind: "counter", role: "answer-phrase",
      name: "Rejected", notes: [], seed: 1,
      quality: {} as never, collisions: {} as never,
      reviewState: "rejected", createdAt: "2026-01-01T00:00:00.000Z",
    }]
    const plan = buildAiPartnerOrchestrationPlan(value, "verse")
    expect(`${plan.nextAction?.sectionId}:${plan.nextAction?.generator}`).not.toBe("verse:counter")
    expect(plan.feedbackSummary).toContain("Reject 1件")
  })
})
