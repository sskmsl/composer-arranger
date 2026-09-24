import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { homeContinueAction } from "./homeNavigation"

describe("homeContinueAction", () => {
  it("全曲アレンジがある曲はアレンジ画面を再開する", () => {
    const project = createEmptyProject("Result")
    project.fullSongArrangement = {} as ComposerProject["fullSongArrangement"]
    expect(homeContinueAction(project)).toEqual({ tab: "arrangement", label: "アレンジを続ける" })
  })

  it("アレンジ相談をしている曲は相談の続きへ戻る", () => {
    const project = createEmptyProject("Consultation")
    project.arrangementChat = {
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [{ id: "u", role: "user", createdAt: "2026-01-01T00:00:00.000Z", text: "サビを開いて" }],
      versions: [],
      currentVersionId: null,
      confirmedConstraints: [],
    }
    expect(homeContinueAction(project)).toEqual({ tab: "arrangement", label: "アレンジ相談を続ける" })
  })

  it("音楽素材だけがある曲は全曲のアレンジへ案内する", () => {
    const project = createEmptyProject("Material")
    project.chords = [{
      id: "chord",
      sectionId: "section",
      startBeat: 0,
      durationBeats: 4,
      symbol: "Am",
      bass: null,
    }]
    expect(homeContinueAction(project)).toEqual({ tab: "arrangement", label: "全曲をアレンジする" })
  })
})
