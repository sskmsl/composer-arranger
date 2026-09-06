import { describe, expect, it } from "vitest"
import { createEmptyProject } from "./project"
import type { MelodyVariant } from "./melody"
import { distinctMelodyVariantsForAudition, immediateAuditionRange, leadNotesForAudition } from "./auditionMaterial"
import { DEFAULT_SECTION_CONTENT } from "./sectionContent"

describe("audition material", () => {
  it("長いImported Songは主旋律の直前から最大8小節を返す", () => {
    expect(immediateAuditionRange([
      { id: "n1", startBeat: 81, durationBeats: 1, pitch: 69, velocity: 80, locks: [] },
    ], 660, 4)).toEqual({ startBeat: 80, endBeat: 112 })
  })

  it("短いSectionは従来どおり全体を返す", () => {
    expect(immediateAuditionRange([], 16, 4)).toEqual({ startBeat: 0, endBeat: 16 })
  })

  it("Variantのleadが欠けてもImported MelodyからSection相対ノートを復元する", () => {
    const project = createEmptyProject("Imported")
    project.sections = [{
      id: "s2", name: "Verse", role: "verse", startBar: 5, lengthBars: 4,
      content: { ...DEFAULT_SECTION_CONTENT },
    }]
    project.importedArrangement = {
      version: "1.0.0", sourceKind: "external-song", totalBeats: 32,
      tracks: [{ sourceTrackIndex: 0, name: "Lead", role: "melody", notes: [[17, 1.5, 72, 88, 1]] }],
    }
    const variant = {
      id: "v1", name: "Imported Lead", sectionId: "s2", sourceMode: "import-midi", notes: [],
    } as unknown as MelodyVariant

    expect(leadNotesForAudition(project, "s2", variant)).toMatchObject([
      { startBeat: 1, durationBeats: 1.5, pitch: 72, velocity: 88 },
    ])
  })
})

describe("distinctMelodyVariantsForAudition", () => {
  it("同じ音を持つ重複VariantをA/B/C比較から除外する", () => {
    const project = createEmptyProject("Distinct audition")
    project.sections = [{
      id: "s1", name: "Intro", role: "intro", startBar: 1, lengthBars: 4,
      content: { ...DEFAULT_SECTION_CONTENT },
    }]
    const notes = [{ id: "n1", startBeat: 0, durationBeats: 1, pitch: 60, velocity: 90, locks: [] }]
    const base = {
      name: "Imported",
      sectionId: "s1",
      sourceMode: "import-midi" as const,
      notes,
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features: null,
      generatorVersion: "test",
      seed: 1,
      songProfile: project.song.songProfile,
      parentMelodyId: null,
      batchId: "batch",
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const variants = [
      { ...base, id: "v1" },
      { ...base, id: "v2", name: "Imported copy" },
      { ...base, id: "v3", notes: [{ ...notes[0], id: "n2", pitch: 64 }] },
    ]

    expect(distinctMelodyVariantsForAudition(project, "s1", variants).map((variant) => variant.id))
      .toEqual(["v1", "v3"])
  })
})
