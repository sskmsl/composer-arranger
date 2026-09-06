import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { homeContinueAction } from "./homeNavigation"

describe("homeContinueAction", () => {
  it("生成結果がある曲は結果・書出しを再開する", () => {
    const project = createEmptyProject("Result")
    project.fullSongArrangement = {} as ComposerProject["fullSongArrangement"]
    expect(homeContinueAction(project)).toEqual({ tab: "arrangement", label: "生成結果を開く" })
  })

  it("AI回答がある曲は相談の続きへ戻る", () => {
    const project = createEmptyProject("Consultation")
    project.aiPartnerSessions = {
      "__whole_song__": { latestResponse: {} },
    } as unknown as NonNullable<ComposerProject["aiPartnerSessions"]>
    expect(homeContinueAction(project)).toEqual({ tab: "ai-partner", label: "AI相談を続ける" })
  })

  it("音楽素材だけがある曲はAIおまかせへ案内する", () => {
    const project = createEmptyProject("Material")
    project.chords = [{
      id: "chord",
      sectionId: "section",
      startBeat: 0,
      durationBeats: 4,
      symbol: "Am",
      bass: null,
    }]
    expect(homeContinueAction(project)).toEqual({ tab: "ai-partner", label: "AIにおまかせする" })
  })
})
