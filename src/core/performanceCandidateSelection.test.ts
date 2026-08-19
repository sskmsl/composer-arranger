import { describe, expect, it } from "vitest"
import type { PerformanceCandidateReview } from "./performanceExecution"
import { recommendPerformedCandidate } from "./performanceCandidateSelection"

function review(
  candidateId: string,
  score: number,
  status: PerformanceCandidateReview["status"],
): PerformanceCandidateReview {
  return {
    candidateId,
    role: "lead-focus",
    status,
    score,
    summary: "",
    findings: [],
    diagnostics: {
      changedVelocityCount: 1,
      changedDurationCount: 1,
      changedOnsetCount: 0,
      protectedBoundaryCount: 0,
      collisionTrimCount: 0,
      pitchChangeCount: 0,
    },
  }
}

describe("Performance Candidate Selection", () => {
  it("品質だけが最高でもRevise候補は安全な代案がある限り推奨しない", () => {
    const result = recommendPerformedCandidate("batch", [
      { candidateId: "unsafe", qualityScore: 100, review: review("unsafe", 60, "revise") },
      { candidateId: "safe", qualityScore: 82, review: review("safe", 96, "strong") },
    ])
    expect(result.candidateId).toBe("safe")
    expect(result.status).toBe("recommended")
  })

  it("音楽品質60%・演奏適合40%で決定論的に選ぶ", () => {
    const result = recommendPerformedCandidate("batch", [
      { candidateId: "a", qualityScore: 90, review: review("a", 80, "watch") },
      { candidateId: "b", qualityScore: 84, review: review("b", 100, "strong") },
    ])
    expect(result.candidateId).toBe("b")
    expect(result.compositeScore).toBe(90)
  })

  it("全候補がReviseなら無理に推奨しない", () => {
    const result = recommendPerformedCandidate("batch", [
      { candidateId: "a", qualityScore: 90, review: review("a", 50, "revise") },
    ])
    expect(result).toMatchObject({ candidateId: null, status: "needs-review" })
  })
})
