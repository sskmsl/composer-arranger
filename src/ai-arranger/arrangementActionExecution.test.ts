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
  it("AIが別Generator名を返しても、イントロの和音リフ要望をSignature生成へ接続する", () => {
    const project = createEmptyProject("Chord riff intro")
    project.sections = [{ id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 }]
    project.chords = [
      { id: "c1", sectionId: "intro", startBeat: 0, durationBeats: 4, symbol: "Am", bass: null },
      { id: "c2", sectionId: "intro", startBeat: 4, durationBeats: 4, symbol: "F", bass: null },
      { id: "c3", sectionId: "intro", startBeat: 8, durationBeats: 4, symbol: "C", bass: null },
      { id: "c4", sectionId: "intro", startBeat: 12, durationBeats: 4, symbol: "G", bass: null },
    ]
    useProjectStore.setState({
      project,
      selectedSectionId: "intro",
      workflowNotice: null,
      activeSignaturePhraseBatchId: null,
      persist: () => {},
    } as never)

    const result = executeAiArrangementIntent("intro", {
      ...melodyIntent(),
      generationBrief: "イントロで和音を短い打撃として反復するリフを作る",
    })
    expect(result).toEqual({ generated: true, target: "signature" })
    const candidates = useProjectStore.getState().project.signaturePhraseCandidates
    expect(candidates).toHaveLength(12)
    expect(candidates.every((candidate) => candidate.plan.riffMode === "percussive-block-chord")).toBe(true)
  })

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
    expect(useProjectStore.getState().workflowNotice).toContain("採用中の主旋律は変更・再生成しません")
  })

  it("コードから生成して採用した主旋律もAIから再生成しない", () => {
    const project = createEmptyProject("Generated melody")
    project.sections = [{ id: "song", name: "Song", role: "verse", startBar: 1, lengthBars: 4 }]
    project.chords = [{ id: "chord", sectionId: "song", startBeat: 0, durationBeats: 16, symbol: "Am", bass: null }]
    project.melodyVariants = [{
      id: "generated-melody",
      name: "Generated Melody",
      sectionId: "song",
      sourceMode: "generate",
      notes: [{ id: "generated-note", startBeat: 0, durationBeats: 1, pitch: 69, velocity: 82, locks: [] }],
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features: null,
      generatorVersion: "test",
      seed: 7,
      songProfile: project.song.songProfile,
      parentMelodyId: null,
      batchId: "generated",
      createdAt: "2026-09-13T00:00:00.000Z",
    }]
    project.sectionMelodyAssignments = { song: "generated-melody" }
    project.activeMelodyId = "generated-melody"
    useProjectStore.setState({ project, selectedSectionId: "song", workflowNotice: null })

    const before = JSON.stringify(project.melodyVariants)
    expect(executeAiArrangementIntent("song", melodyIntent())).toEqual({ generated: false, target: "arrangement" })
    expect(JSON.stringify(useProjectStore.getState().project.melodyVariants)).toBe(before)
    expect(useProjectStore.getState().workflowNotice).toContain("伴奏・つなぎ・装飾だけを追加")
  })
})
