import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import { buildOrchestrationBlueprint } from "./orchestrationIntelligence"
import { reviewOrchestrationMasking } from "./orchestrationReview"

function introProject() {
  const project = createEmptyProject("Masking review")
  project.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
  ]
  project.sectionMelodyAssignments = { intro: "melody-1" }
  return project
}

function introPlan(project: ReturnType<typeof introProject>) {
  return buildOrchestrationBlueprint(
    project,
    buildArrangementDirectorBlueprint(project),
  ).sections[0]
}

describe("Orchestration Masking Review", () => {
  it("自動設計された前景Leadと遠景Supportを過剰警告しない", () => {
    const review = reviewOrchestrationMasking(introPlan(introProject()))
    expect(review.status).not.toBe("revise")
    expect(review.metrics.foregroundCompetitionCount).toBe(0)
    expect(review.metrics.dynamicMaskingCount).toBe(0)
  })

  it("固定値でSupportをLeadと同じ前景かつ強いDynamicへ置くと修正推奨にする", () => {
    const project = introProject()
    project.sectionOrchestrationOverrides = {
      intro: {
        "harmonic-space": { distance: "intimate", dynamic: "mf" },
      },
    }
    const review = reviewOrchestrationMasking(introPlan(project))
    expect(review.status).toBe("revise")
    expect(review.metrics.foregroundCompetitionCount).toBeGreaterThan(0)
    expect(review.metrics.dynamicMaskingCount).toBeGreaterThan(0)
    expect(review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "foreground-competition" }),
      expect.objectContaining({ id: "dynamic-masking" }),
    ]))
  })

  it("同じDynamicでもSupportが十分遠景なら強弱マスキングと判定しない", () => {
    const project = introProject()
    project.sectionOrchestrationOverrides = {
      intro: {
        "harmonic-space": { distance: "distant", dynamic: "p" },
      },
    }
    const review = reviewOrchestrationMasking(introPlan(project))
    expect(review.metrics.dynamicMaskingCount).toBe(0)
    expect(review.status).not.toBe("revise")
  })

  it("計画が無い場合はpendingを返す", () => {
    expect(reviewOrchestrationMasking(undefined)).toMatchObject({
      status: "pending",
      sectionId: "",
      score: 0,
    })
  })
})
