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

  it("Section境界をまたぐ原曲ノートを分割せず、開始Sectionへ一度だけ保持する", () => {
    const project = importedProject()
    project.melodyVariants[0].notes.push({
      id: "crossing",
      startBeat: 31.5,
      durationBeats: 2,
      pitch: 71,
      velocity: 75,
      locks: [],
    })
    project.importedArrangement!.tracks[0].notes.push([31.5, 2, 71, 75, 1])
    const result = inferMarkerlessImportedSections(project)
    const reconstructed = result.project.sections.flatMap((section) => {
      const offset = (section.startBar - 1) * 4
      return result.project.melodyVariants
        .filter((variant) => variant.sectionId === section.id)
        .flatMap((variant) => variant.notes.map((note) => ({
          id: note.id,
          startBeat: offset + note.startBeat,
          durationBeats: note.durationBeats,
        })))
    })
    expect(reconstructed.filter((note) => note.startBeat === 31.5)).toEqual([
      expect.objectContaining({ startBeat: 31.5, durationBeats: 2 }),
    ])
  })

  it("生成済み候補があっても原曲Melodyだけを修復し、Section再分割はしない", () => {
    const project = importedProject()
    project.melodyVariants.push({ ...project.melodyVariants[0], id: "generated", sourceMode: "generate" })
    const result = inferMarkerlessImportedSections(project)
    expect(result.changed).toBe(true)
    expect(result.project.sections).toHaveLength(1)
    expect(result.project.melodyVariants.some((variant) => variant.id === "generated")).toBe(true)
    expect(result.project.sourceImport?.melodyTracksMerged).toBe(true)
  })

  it("推定済みの旧Projectでも同名分割トラックから欠落Melodyを復元する", () => {
    const inferred = inferMarkerlessImportedSections(importedProject()).project
    inferred.sourceImport!.melodyTracksMerged = undefined
    inferred.importedArrangement!.tracks.push({
      sourceTrackIndex: 2,
      name: "Lead",
      role: "other",
      notes: [[100, 1.5, 72, 91, 1]],
    })
    const result = inferMarkerlessImportedSections(inferred)
    const restored = result.project.sections.flatMap((section) => {
      const offset = (section.startBar - 1) * 4
      const assigned = result.project.melodyVariants.find(
        (variant) => variant.id === result.project.sectionMelodyAssignments[section.id],
      )
      return (assigned?.notes ?? []).map((note) => [offset + note.startBeat, note.durationBeats, note.pitch])
    })
    expect(result.changed).toBe(true)
    expect(restored).toContainEqual([100, 1.5, 72])
    expect(result.project.importedArrangement?.tracks.at(-1)?.role).toBe("melody")
  })
})
