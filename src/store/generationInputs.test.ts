import { expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import { DEFAULT_DECORATION_SETTINGS } from "@/melody-engine/decorationGenerator"
import { decorationGenerationInput, phraseGenerationInput } from "./generationInputs"

it("既に鳴る短い素材をPhraseとDecorationの密度・衝突判断へ渡す", () => {
  const project = createEmptyProject("Short material context")
  project.sections = [{ id: "verse", name: "Verse", role: "verse", startBar: 1, lengthBars: 4 }]
  project.chords = [{ id: "chord", sectionId: "verse", startBeat: 0, durationBeats: 16, symbol: "Am", bass: null }]
  const motifNote = { id: "motif", pitch: 76, startBeat: 1, durationBeats: 0.5, velocity: 80, locks: [] }
  project.signaturePhraseCandidates = [{ id: "signature", sectionId: "verse", notes: [motifNote] } as never]
  project.sectionSignaturePhraseAssignments = { verse: "signature" }
  project.melodyVariants = [{ id: "lead", sectionId: "verse", notes: [
    { id: "lead-note", pitch: 69, startBeat: 0, durationBeats: 1, velocity: 80, locks: [] },
  ] } as never]
  project.sectionMelodyAssignments = { verse: "lead" }
  const settings = {
    density: "balanced" as const, rangePreset: "middle" as const,
    customRange: { low: 60, high: 79 }, drama: "growing" as const,
    selectedGeneratorProfiles: [] as [], techniqueExperimentPresetId: null,
  }
  const phrase = phraseGenerationInput(project, "verse", settings, 7)
  const decoration = decorationGenerationInput(project, "verse", 7, DEFAULT_DECORATION_SETTINGS)
  expect(phrase?.referenceMelody).toHaveLength(1)
  expect(phrase?.supportNotesPerBeat).toBeGreaterThan(0)
  expect(decoration?.existingSupportNotes).toContainEqual(motifNote)
  expect(decoration?.arrangementContext?.currentSectionNoteCount).toBeGreaterThanOrEqual(1)
})
