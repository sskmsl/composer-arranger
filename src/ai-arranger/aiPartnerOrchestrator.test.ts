import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import { buildAiPartnerOrchestrationPlan } from "./aiPartnerOrchestrator"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"

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
  it("全Sectionが密度上限なら追加生成を勧めない", () => {
    const value = project()
    value.arrangementSettings.maximumParts = 2
    const plan = buildAiPartnerOrchestrationPlan(value, "verse")
    expect(plan.nextAction).toBeNull()
    expect(plan.nextActionReason).toContain("追加を控え")
  })

  it("明示されたレイヤー追加依頼は自動的な密度判断で消さない", () => {
    const value = project()
    value.arrangementSettings.maximumParts = 2
    value.arrangementDirectorWorkspace!.brief = "対旋律を追加して"
    const plan = buildAiPartnerOrchestrationPlan(value, "verse")
    expect(plan.nextAction).not.toBeNull()
  })

  it("追加しないという制約を、追加依頼として誤読しない", () => {
    const value = project()
    value.arrangementSettings.maximumParts = 2
    value.arrangementDirectorWorkspace!.brief = "対旋律は追加しないで、余白を守る"
    expect(buildAiPartnerOrchestrationPlan(value, "verse").nextAction).toBeNull()
  })

  it("主旋律が休みなく鳴るSectionに対旋律を重ねる優先度を下げる", () => {
    const value = project()
    value.melodyVariants.find((variant) => variant.sectionId === "verse")!.notes = Array.from({ length: 16 }, (_, index) => ({
      id: `busy-${index}`, pitch: 60 + index % 3, startBeat: index, durationBeats: 1,
      velocity: 80, locks: [],
    }))
    const plan = buildAiPartnerOrchestrationPlan(value, "verse")
    expect(`${plan.nextAction?.sectionId}:${plan.nextAction?.generator}`).not.toBe("verse:counter")
  })
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

  it("既存アレンジが埋まっている時は漠然とした盛り上げ依頼に追加せず、引く音色を示す", () => {
    const value = project()
    value.arrangementSettings.maximumParts = 4
    value.arrangementDirectorWorkspace!.brief = "もう少し盛り上げたい、何か足したい"
    value.fullSongArrangement = generateFullSongArrangement(value, { seed: 44 })
    const plan = buildAiPartnerOrchestrationPlan(value, "verse")
    expect(plan.nextAction).toBeNull()
    expect(plan.nextActionReason).toContain("ミュート")
    expect(plan.nextActionReason).toContain("主旋律")
  })
})
