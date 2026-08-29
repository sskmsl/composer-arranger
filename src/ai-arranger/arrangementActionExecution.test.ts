import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import { useProjectStore } from "@/store/useProjectStore"
import { executeAiArrangementIntent } from "./arrangementActionExecution"
import type { AiArrangementIntent } from "./types"

function melodyIntent(): AiArrangementIntent {
  return {
    id: "melody-change",
    title: "Change melody",
    generator: "melody",
    emotionalFunction: "rewrite",
    density: "balanced",
    register: "middle",
    drama: "growing",
    motion: "ascending",
    rhythmCharacter: "flowing",
    silenceStrategy: "breathing",
    creativeRisk: "focused",
    lengthBars: 4,
    techniques: [],
    soundPalette: "piano",
    performanceDirection: "legato",
    why: "test",
    generationBrief: "rewrite melody",
    soundSourceSuggestions: [],
    accompanimentPatternId: "none",
    rhythmPlan: {
      enabled: false,
      subdivision: "eighth",
      feel: "straight",
      kickPattern: "",
      snarePattern: "",
      hatPattern: "",
      percussionPattern: "",
      variation: "",
      bars: 1,
      events: [],
    },
  }
}

describe("Arrangement action execution", () => {
  it("原曲保護モードではAIからImported Melodyを再生成しない", () => {
    const project = createEmptyProject("Protected import")
    project.sections = [{ id: "song", name: "Song", role: "instrumental", startBar: 1, lengthBars: 4 }]
    project.chords = [{ id: "chord", sectionId: "song", startBeat: 0, durationBeats: 16, symbol: "Am", bass: null }]
    project.melodyVariants = [{
      id: "source-melody",
      name: "Imported Melody",
      sectionId: "song",
      sourceMode: "import-midi",
      notes: [{ id: "source-note", startBeat: 0.25, durationBeats: 2.5, pitch: 64, velocity: 82, locks: [] }],
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features: null,
      generatorVersion: "midi-import-1",
      seed: 0,
      songProfile: project.song.songProfile,
      parentMelodyId: null,
      batchId: "source-import",
      createdAt: "2026-08-30T00:00:00.000Z",
    }]
    project.sectionMelodyAssignments = { song: "source-melody" }
    project.activeMelodyId = "source-melody"
    project.sourceImport = {
      type: "midi",
      fileName: "source.mid",
      importedAt: "2026-08-30T00:00:00.000Z",
      format: 1,
      ppq: 480,
      trackCount: 2,
      melodyTrackName: "Lead",
      melodyTrackConfidence: 1,
      chordInferenceConfidence: 1,
      sectionsFromMarkers: false,
      reviewConfirmed: true,
      warnings: [],
    }
    useProjectStore.setState({ project, selectedSectionId: "song", workflowNotice: null })

    const before = JSON.stringify(useProjectStore.getState().project.melodyVariants)
    const chordsBefore = JSON.stringify(useProjectStore.getState().project.chords)
    expect(executeAiArrangementIntent("song", melodyIntent())).toEqual({
      generated: false,
      target: "arrangement",
    })
    expect(JSON.stringify(useProjectStore.getState().project.melodyVariants)).toBe(before)
    expect(JSON.stringify(useProjectStore.getState().project.chords)).toBe(chordsBefore)
    expect(useProjectStore.getState().workflowNotice).toContain("読み込んだ主旋律を変更・再生成しません")
  })
})
