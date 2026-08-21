import { describe, expect, it } from "vitest"
import { buildSmf, TICKS_PER_QUARTER } from "./smf"
import { midiToComposerProject, parseMidi } from "./importMidi"

function fixture(withMarkers = true): Uint8Array {
  const beat = TICKS_PER_QUARTER
  const melodyNotes = Array.from({ length: 8 }, (_, bar) => ({
    pitch: [72, 74, 76, 74, 69, 72, 71, 69][bar],
    start: bar * 4 * beat,
    duration: 2 * beat,
    velocity: 88,
    channel: 0,
  }))
  const chordRoots = [60, 60, 65, 67, 57, 57, 65, 67]
  const chordNotes = chordRoots.flatMap((root, bar) =>
    [root, root + (bar === 4 || bar === 5 ? 3 : 4), root + 7].map((pitch) => ({
      pitch,
      start: bar * 4 * beat,
      duration: 4 * beat,
      velocity: 64,
      channel: 0,
    })),
  )
  return buildSmf({
    name: "Import Fixture",
    tempoBpm: 108,
    timeSignature: { numerator: 4, denominator: 4 },
    markers: withMarkers
      ? [
          { tick: 0, text: "Intro" },
          { tick: 4 * 4 * beat, text: "Verse" },
        ]
      : [],
    tracks: [
      { name: "Lead Melody", notes: melodyNotes },
      { name: "Piano Chords", notes: chordNotes },
    ],
  })
}

describe("MIDI project import", () => {
  it("SMF Type 1のテンポ・拍子・マーカー・ノートを解析する", () => {
    const parsed = parseMidi(fixture())
    expect(parsed.format).toBe(1)
    expect(parsed.ppq).toBe(TICKS_PER_QUARTER)
    expect(parsed.tempoBpm).toBeCloseTo(108, 1)
    expect(parsed.timeSignature).toEqual({ numerator: 4, denominator: 4 })
    expect(parsed.markers.map((marker) => marker.text)).toEqual(["Intro", "Verse"])
    expect(parsed.tracks.find((track) => track.name === "Lead Melody")?.notes).toHaveLength(8)
  })

  it("マーカーをSectionへ、LeadトラックをActive Melodyへ、伴奏音をコードへ変換する", () => {
    const { project, report } = midiToComposerProject(fixture(), "arrangement.mid")
    expect(project.title).toBe("Import Fixture")
    expect(project.song.tempo).toBe(108)
    expect(project.sections.map((section) => [section.name, section.role, section.lengthBars])).toEqual([
      ["Intro", "intro", 4],
      ["Verse", "verse", 4],
    ])
    expect(project.melodyVariants).toHaveLength(2)
    expect(project.melodyVariants.every((variant) => variant.sourceMode === "import-midi")).toBe(true)
    expect(Object.keys(project.sectionMelodyAssignments)).toHaveLength(2)
    expect(project.chords.length).toBeGreaterThanOrEqual(4)
    expect(project.chords.some((chord) => chord.symbol === "C")).toBe(true)
    expect(report.melodyTrackName).toBe("Lead Melody")
    expect(report.melodyTrackConfidence).toBeGreaterThan(0.7)
    expect(project.sourceImport?.sectionsFromMarkers).toBe(true)
  })

  it("マーカーがないMIDIは曲全体を1セクションにし、推定上の注意を保持する", () => {
    const { project, report } = midiToComposerProject(fixture(false), "no-markers.mid")
    expect(project.sections).toHaveLength(1)
    expect(project.sections[0].name).toBe("Imported Song")
    expect(project.sections[0].lengthBars).toBe(8)
    expect(report.warnings.some((warning) => warning.includes("1セクション"))).toBe(true)
  })

  it("壊れたファイルをMIDIとして受理しない", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })
})
