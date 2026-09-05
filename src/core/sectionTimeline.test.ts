import { describe, expect, it } from "vitest"
import type { ComposerProject } from "./project"
import { buildSongPlaybackMaterial, moveSectionInTimeline, normalizeSectionTimeline } from "./sectionTimeline"

const sections = [
  { id: "a", name: "A", role: "verse" as const, startBar: 9, lengthBars: 2 },
  { id: "b", name: "B", role: "chorus" as const, startBar: 20, lengthBars: 4 },
]

describe("section timeline", () => {
  it("startBarを配列順に隙間なく再計算する", () => {
    expect(normalizeSectionTimeline(sections).map((section) => section.startBar)).toEqual([1, 3])
  })

  it("並べ替え後もstartBarを連続させる", () => {
    const moved = moveSectionInTimeline(sections, "b", 0)
    expect(moved.map((section) => section.id)).toEqual(["b", "a"])
    expect(moved.map((section) => section.startBar)).toEqual([1, 5])
  })

  it("セクション採用Variantとコードを曲全体の絶対拍へ配置する", () => {
    const project = {
      song: { timeSignature: "4/4" },
      sections: normalizeSectionTimeline(sections),
      chords: [
        { id: "ca", sectionId: "a", startBeat: 0, durationBeats: 8, symbol: "Am", bass: null },
        { id: "cb", sectionId: "b", startBeat: 0, durationBeats: 16, symbol: "F", bass: null },
      ],
      melodyVariants: [
        {
          id: "va",
          sectionId: "a",
          notes: [{ id: "n", startBeat: 1, durationBeats: 1, pitch: 60, velocity: 80, locks: [] }],
        },
        {
          id: "vb",
          sectionId: "b",
          notes: [{ id: "n", startBeat: 2, durationBeats: 1, pitch: 72, velocity: 80, locks: [] }],
        },
      ],
      sectionMelodyAssignments: { a: "va", b: "vb" },
    } as unknown as ComposerProject

    const material = buildSongPlaybackMaterial(project)
    expect(material.chords.map((chord) => chord.startBeat)).toEqual([0, 8])
    expect(material.melody.map((note) => note.startBeat)).toEqual([1, 10])
    expect(material.totalBeats).toBe(24)
  })

  it("MIDI原曲保護中は生成Variantではなく、分割された原Melody全体を無加工で再生素材にする", () => {
    const project = {
      song: { timeSignature: "4/4" },
      sections: [{ id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 }],
      chords: [],
      melodyVariants: [{
        id: "generated",
        sectionId: "intro",
        sourceMode: "generate",
        notes: [{ id: "changed", startBeat: 0, durationBeats: 1, pitch: 90, velocity: 90, locks: [] }],
      }],
      sectionMelodyAssignments: { intro: "generated" },
      sourceImport: { type: "midi", melodyTrackName: "Keyboard Player" },
      importedArrangement: {
        totalBeats: 16,
        tracks: [
          { name: "Keyboard Player", role: "other", notes: [[0.25, 2.5, 60, 80, 1]] },
          { name: "Keyboard Player", role: "melody", notes: [[8, 1.25, 67, 76, 1]] },
        ],
      },
    } as unknown as ComposerProject
    const material = buildSongPlaybackMaterial(project)
    expect(material.lead.map((note) => [note.startBeat, note.durationBeats, note.pitch, note.velocity])).toEqual([
      [0.25, 2.5, 60, 80],
      [8, 1.25, 67, 76],
    ])
    expect(material.lead.some((note) => note.pitch === 90)).toBe(false)
  })

  it("Imported MIDIの比較試聴には推定コードではなく原伴奏トラックを保持する", () => {
    const project = {
      song: { timeSignature: "4/4" },
      sections: [{ id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 }],
      chords: [{ id: "c", sectionId: "intro", startBeat: 0, durationBeats: 4, symbol: "Am", bass: null }],
      melodyVariants: [],
      sectionMelodyAssignments: {},
      sourceImport: { type: "midi", melodyTrackName: "Lead" },
      importedArrangement: {
        totalBeats: 16,
        tracks: [
          { name: "Lead", role: "melody", notes: [[0, 1, 72, 80, 1]] },
          { name: "Chords", role: "harmony", notes: [[0, 4, 57, 68, 1], [0, 4, 60, 65, 1]] },
          { name: "Bass", role: "bass", notes: [[0, 2, 45, 76, 1]] },
        ],
      },
    } as unknown as ComposerProject

    const material = buildSongPlaybackMaterial(project)
    expect(material.importedBacking.map((note) => [note.startBeat, note.durationBeats, note.pitch])).toEqual([
      [0, 2, 45],
      [0, 4, 57],
      [0, 4, 60],
    ])
    expect(material.importedBacking.some((note) => note.pitch === 72)).toBe(false)
  })

  it("carry-overの保持を曲全体Preview/MIDI共通素材へ反映し、次の発音と重ねない", () => {
    const project = {
      song: { timeSignature: "4/4" },
      sections: normalizeSectionTimeline(sections),
      chords: [],
      melodyVariants: [
        {
          id: "va",
          sectionId: "a",
          notes: [{ id: "tail", startBeat: 7, durationBeats: 0.5, pitch: 69, velocity: 80, locks: [] }],
        },
        {
          id: "vb",
          sectionId: "b",
          notes: [{ id: "entry", startBeat: 1, durationBeats: 1, pitch: 72, velocity: 80, locks: [] }],
          transitionPlan: {
            strategy: "carry-over",
            sourceSectionId: "a",
            sourceVariantId: "va",
            contextFingerprint: "context",
            transitionFitScore: 90,
            pitchContinuityScore: 90,
            rhythmContinuityScore: 90,
            tensionResolutionScore: 90,
            motifRelationScore: 90,
            registerTrajectoryScore: 90,
            sustainAcrossBoundaryBeats: 1,
          },
        },
      ],
      sectionMelodyAssignments: { a: "va", b: "vb" },
    } as unknown as ComposerProject

    const material = buildSongPlaybackMaterial(project)
    const tail = material.lead.find((note) => note.id === "a:tail")!
    const entry = material.lead.find((note) => note.id === "b:entry")!
    expect(tail.startBeat + tail.durationBeats).toBe(entry.startBeat)
    expect(entry.startBeat).toBe(9)
  })

  it("pickup-to-nextを境界直前へ置き、前終音との重複を除く", () => {
    const project = {
      song: { timeSignature: "4/4" },
      sections: normalizeSectionTimeline(sections),
      chords: [],
      melodyVariants: [
        {
          id: "va",
          sectionId: "a",
          notes: [{ id: "tail", startBeat: 7, durationBeats: 1, pitch: 69, velocity: 80, locks: [] }],
        },
        {
          id: "vb",
          sectionId: "b",
          notes: [{ id: "entry", startBeat: 0, durationBeats: 1, pitch: 72, velocity: 80, locks: [] }],
          transitionPlan: {
            strategy: "pickup-to-next",
            sourceSectionId: "a",
            sourceVariantId: "va",
            contextFingerprint: "context",
            transitionFitScore: 90,
            pitchContinuityScore: 90,
            rhythmContinuityScore: 90,
            tensionResolutionScore: 90,
            motifRelationScore: 90,
            registerTrajectoryScore: 90,
            sustainAcrossBoundaryBeats: 0,
            pickup: { pitch: 71, durationBeats: 0.5, velocity: 72 },
          },
        },
      ],
      sectionMelodyAssignments: { a: "va", b: "vb" },
    } as unknown as ComposerProject

    const material = buildSongPlaybackMaterial(project)
    const tail = material.lead.find((note) => note.id === "a:tail")!
    const pickup = material.lead.find((note) => note.id.startsWith("b:transition-pickup"))!
    expect(pickup.startBeat).toBe(7.5)
    expect(tail.startBeat + tail.durationBeats).toBeLessThanOrEqual(pickup.startBeat)
    expect(pickup.startBeat + pickup.durationBeats).toBe(8)

    const sixEightProject = {
      ...project,
      song: { timeSignature: "6/8" },
      melodyVariants: project.melodyVariants.map((variant) =>
        variant.id === "va"
          ? { ...variant, notes: [{ ...variant.notes[0], startBeat: 5 }] }
          : variant,
      ),
    } as unknown as ComposerProject
    const sixEight = buildSongPlaybackMaterial(sixEightProject)
    const sixEightPickup = sixEight.lead.find((note) => note.id.startsWith("b:transition-pickup"))!
    expect(sixEightPickup.startBeat).toBe(5.5)
    expect(sixEightPickup.startBeat + sixEightPickup.durationBeats).toBe(6)
  })
})
