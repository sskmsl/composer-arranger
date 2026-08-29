import { describe, expect, it } from "vitest"
import { createEmptyProject } from "./project"
import type { MelodyVariant } from "./melody"
import { inferMarkerlessImportedSections } from "./importedSectionInference"
import { DEFAULT_SECTION_CONTENT } from "./sectionContent"

function importedProject() {
  const project = createEmptyProject("Markerless")
  project.sections = [{
    id: "whole", name: "Imported Song", role: "instrumental", startBar: 1, lengthBars: 32,
    content: { ...DEFAULT_SECTION_CONTENT },
  }]
  project.chords = Array.from({ length: 32 }, (_, bar) => ({
    id: `c${bar}`, sectionId: "whole", startBeat: bar * 4, durationBeats: 4,
    symbol: bar % 8 < 4 ? "Am" : "Fmaj7", bass: null,
  }))
  const variant = {
    id: "imported", name: "Imported Melody", sectionId: "whole", sourceMode: "import-midi",
    notes: Array.from({ length: 16 }, (_, index) => ({
      id: `n${index}`, startBeat: 32 + index * 2, durationBeats: 1, pitch: 64 + index % 4, velocity: 80, locks: [],
    })),
    phrasePlans: [], lockedBars: [], motifLocked: false, features: null,
    generatorVersion: "midi-import-1", seed: 0, songProfile: project.song.songProfile,
    parentMelodyId: null, batchId: "import", createdAt: "2026-01-01T00:00:00.000Z",
  } satisfies MelodyVariant
  project.melodyVariants = [variant]
  project.sectionMelodyAssignments = { whole: variant.id }
  project.activeMelodyId = variant.id
  project.sourceImport = {
    type: "midi", sourceKind: "external-song", fileName: "song.mid", importedAt: "2026-01-01",
    format: 1, ppq: 480, trackCount: 3, melodyTrackName: "Lead", melodyTrackConfidence: 0.8,
    chordInferenceConfidence: 0.7, sectionsFromMarkers: false,
    warnings: ["セクションマーカーがないため、曲全体を1セクションとして候補化しました。"],
  }
  project.importedArrangement = {
    version: "1.0.0", sourceKind: "external-song", totalBeats: 128,
    tracks: [
      {
        sourceTrackIndex: 0, name: "Lead", role: "melody",
        notes: variant.notes.map((note) => [note.startBeat, note.durationBeats, note.pitch, note.velocity, 1]),
      },
      {
        sourceTrackIndex: 1, name: "Arrangement", role: "other",
        notes: Array.from({ length: 64 }, (_, index) => [index * 2, 0.5, 48 + index % 12, 70, 1]),
      },
    ],
  }
  return project
}

describe("markerless imported section inference", () => {
  it("小節特徴から複数Sectionを作り、コードとMelodyを相対位置へ再配置する", () => {
    const result = inferMarkerlessImportedSections(importedProject())
    expect(result.changed).toBe(true)
    expect(result.project.sections.length).toBeGreaterThanOrEqual(3)
    expect(result.project.sections[0].role).toBe("intro")
    expect(result.project.sections.at(-1)?.role).toBe("outro")
    expect(result.project.chords.every((chord) => result.project.sections.some((section) => section.id === chord.sectionId))).toBe(true)
    expect(result.project.melodyVariants.every((variant) => variant.notes.every((note) => note.startBeat >= 0))).toBe(true)
    expect(result.project.sourceImport?.sectionsInferred).toBe(true)
    expect(result.project.sourceImport?.warnings.some((warning) => warning.includes("自動推定"))).toBe(true)
  })

  it("一度推定したProjectへ再適用しない", () => {
    const first = inferMarkerlessImportedSections(importedProject())
    expect(inferMarkerlessImportedSections(first.project).changed).toBe(false)
  })

  it("生成済み候補があるProjectは自動再分割しない", () => {
    const project = importedProject()
    project.melodyVariants.push({ ...project.melodyVariants[0], id: "generated", sourceMode: "generate" })
    expect(inferMarkerlessImportedSections(project).changed).toBe(false)
  })
})
