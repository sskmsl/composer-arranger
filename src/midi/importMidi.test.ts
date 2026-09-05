import { describe, expect, it } from "vitest"
import { buildSmf, TICKS_PER_QUARTER } from "./smf"
import {
  analyzeMidiImport,
  createMidiProjectFromAnalysis,
  midiChordOverrideKey,
  midiToComposerProject,
  parseMidi,
} from "./importMidi"

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
    expect(project.sourceImport?.reviewConfirmed).toBe(false)
    expect(project.sourceImport?.sourceKind).toBe("external-song")
    expect(project.importedArrangement?.tracks.map((track) => track.role)).toEqual(["melody", "harmony"])
    expect(project.importedArrangement?.tracks.reduce((sum, track) => sum + track.notes.length, 0)).toBe(32)
    expect(project.sourceImport?.keyInferenceConfidence).toBeGreaterThan(0.35)
    expect(project.sourceImport?.keyInferenceSource).toBe("pitch-profile")
    expect(project.sourceImport?.keyAlternatives?.length).toBeGreaterThan(0)
  })

  it("MIDI Key Signatureがある場合は音分布推定より優先する", () => {
    const beat = TICKS_PER_QUARTER
    const bytes = buildSmf({
      name: "Key Signature Fixture",
      tempoBpm: 100,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { sharpsFlats: -3, minor: false },
      markers: [],
      tracks: [{
        name: "Lead",
        notes: [{ pitch: 60, start: 0, duration: beat * 4, velocity: 80, channel: 0 }],
      }],
    })
    const analysis = analyzeMidiImport(bytes, "key-signature.mid")
    expect(analysis.key).toBe("Eb")
    expect(analysis.keyInference).toMatchObject({
      key: "Eb",
      confidence: 1,
      source: "midi-signature",
      alternatives: [],
    })
  })

  it("主旋律のない外部曲でも全トラックを解析素材として保持する", () => {
    const analysis = analyzeMidiImport(fixture(), "instrumental.mid")
    const { project, report } = createMidiProjectFromAnalysis(analysis, {
      melodyTrackIndex: -1,
      sourceKind: "external-song",
      trackRoles: { 0: "other", 1: "harmony" },
      reviewConfirmed: true,
    })
    expect(project.melodyVariants).toEqual([])
    expect(project.sectionMelodyAssignments).toEqual({})
    expect(project.importedArrangement?.tracks).toHaveLength(2)
    expect(project.importedArrangement?.sourceKind).toBe("external-song")
    expect(report.melodyTrackName).toBe("主旋律なし")
  })

  it("同名で時間方向に分割されたMelodyトラックを結合し、イントロを欠落させない", () => {
    const beat = TICKS_PER_QUARTER
    const bytes = buildSmf({
      name: "Split Melody",
      tempoBpm: 112,
      timeSignature: { numerator: 4, denominator: 4 },
      markers: [],
      tracks: [
        {
          name: "Keyboard Player",
          notes: [
            { pitch: 64, start: beat, duration: beat, velocity: 82, channel: 0 },
            { pitch: 67, start: beat * 5, duration: beat, velocity: 80, channel: 0 },
          ],
        },
        {
          name: "Keyboard Player",
          notes: [
            { pitch: 69, start: beat * 33, duration: beat, velocity: 84, channel: 0 },
            { pitch: 71, start: beat * 37, duration: beat, velocity: 82, channel: 0 },
          ],
        },
        {
          name: "Chords",
          notes: Array.from({ length: 16 }, (_, bar) => ({
            pitch: 48 + (bar % 4),
            start: bar * 4 * beat,
            duration: 4 * beat,
            velocity: 64,
            channel: 0,
          })),
        },
      ],
    })
    const analysis = analyzeMidiImport(bytes, "split-melody.mid")
    expect(analysis.melodyTrackIndices).toEqual([1, 2])
    const created = createMidiProjectFromAnalysis(analysis, { reviewConfirmed: true })
    expect(created.project.importedArrangement?.tracks.filter((track) => track.role === "melody")).toHaveLength(2)
    expect(created.project.melodyVariants[0].notes.map((note) => note.pitch)).toEqual([64, 67, 69, 71])
    expect(created.report.warnings).toContain("同名の分割Melodyトラック2本を、1本の原曲Melodyとして結合しました。")
  })

  it("Logicの同名分割トラック群を短いFinal Liftより優先して主旋律判定する", () => {
    const beat = TICKS_PER_QUARTER
    const bytes = buildSmf({
      name: "Logic Split Song",
      tempoBpm: 128,
      timeSignature: { numerator: 4, denominator: 4 },
      markers: [],
      tracks: [
        { name: "Keyboard Player - Freely", notes: [{ pitch: 66, start: 0, duration: beat, velocity: 82, channel: 0 }] },
        { name: "Keyboard Player - Freely", notes: [{ pitch: 69, start: beat * 32, duration: beat, velocity: 82, channel: 0 }] },
        { name: "Keyboard Player - Freely", notes: [{ pitch: 71, start: beat * 64, duration: beat, velocity: 82, channel: 0 }] },
        { name: "SYN_FinalLift", notes: Array.from({ length: 8 }, (_, index) => ({
          pitch: 84 + index,
          start: beat * (72 + index / 2),
          duration: beat / 2,
          velocity: 90,
          channel: 0,
        })) },
      ],
    })
    const analysis = analyzeMidiImport(bytes, "logic-split.mid")

    expect(analysis.tracks.find((track) => track.index === analysis.melodyTrackIndex)?.name).toBe("Keyboard Player - Freely")
    expect(analysis.melodyTrackIndices).toEqual([1, 2, 3])
    expect(analysis.tracks.find((track) => track.name === "SYN_FinalLift")?.recommendedRole).not.toBe("melody")
  })

  it("最後の発音より遠いLogic End Of Track空白を曲尺へ含めない", () => {
    const beat = TICKS_PER_QUARTER
    const bytes = buildSmf({
      name: "Trailing Logic Space",
      tempoBpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      markers: [],
      tracks: [{
        name: "Lead Melody",
        notes: [{ pitch: 69, start: 0, duration: beat * 32, velocity: 80, channel: 0 }],
        textEvents: [{ tick: beat * 320, text: "Logic trailing event" }],
      }],
    })
    const parsed = parseMidi(bytes)
    const analysis = analyzeMidiImport(bytes, "trailing-space.mid")

    expect(parsed.endTick / beat).toBe(32)
    expect(analysis.totalBars).toBe(8)
  })

  it("Logic Production Packageのトラック名から往復素材と役割を判定する", () => {
    const beat = TICKS_PER_QUARTER
    const bytes = buildSmf({
      name: "Logic Production Package",
      tempoBpm: 96,
      timeSignature: { numerator: 4, denominator: 4 },
      markers: [{ tick: 0, text: "Intro" }],
      tracks: [
        { name: "01 Bass Guide", notes: [{ pitch: 36, start: 0, duration: beat * 4, velocity: 70, channel: 0 }] },
        { name: "03 Active Melody", notes: [{ pitch: 69, start: 0, duration: beat, velocity: 80, channel: 0 }] },
        { name: "04 Melody Accompaniment", notes: [{ pitch: 60, start: beat, duration: beat, velocity: 64, channel: 0 }] },
        { name: "05 Accompaniment Pulse", notes: [{ pitch: 48, start: 0, duration: beat / 2, velocity: 68, channel: 0 }] },
        { name: "06 Counter", notes: [{ pitch: 57, start: beat * 2, duration: beat, velocity: 64, channel: 0 }] },
        { name: "07 Decoration and Transition", notes: [{ pitch: 84, start: beat * 3, duration: beat, velocity: 58, channel: 0 }] },
      ],
    })
    const analysis = analyzeMidiImport(bytes, "logic-return.mid")
    expect(analysis.suggestedSourceKind).toBe("logic-project")
    expect(analysis.tracks.filter((track) => track.noteCount > 0).map((track) => track.recommendedRole)).toEqual([
      "bass", "melody", "accompaniment", "drums", "counter", "decoration",
    ])
  })

  it("マーカーがないMIDIは曲全体を1セクションにし、推定上の注意を保持する", () => {
    const { project, report } = midiToComposerProject(fixture(false), "no-markers.mid")
    expect(project.sections).toHaveLength(1)
    expect(project.sections[0].name).toBe("Imported Song")
    expect(project.sections[0].lengthBars).toBe(8)
    expect(report.warnings.some((warning) => warning.includes("1セクション"))).toBe(true)
  })

  it("確認画面のMelody選択・Section境界・コード修正を確定プロジェクトへ反映する", () => {
    const analysis = analyzeMidiImport(fixture(), "review.mid")
    expect(analysis.tracks.find((track) => track.name === "Lead Melody")?.recommendedRole).toBe("melody")
    expect(analysis.tracks.find((track) => track.name === "Piano Chords")?.recommendedRole).toBe("harmony")

    const pianoIndex = analysis.tracks.find((track) => track.name === "Piano Chords")?.index
    expect(pianoIndex).toBeTypeOf("number")
    const { project } = createMidiProjectFromAnalysis(analysis, {
      melodyTrackIndex: pianoIndex,
      sections: [
        { id: "s1", name: "Opening", role: "intro", startBar: 1 },
        { id: "s2", name: "Hook", role: "chorus", startBar: 3 },
      ],
      chordSymbolOverrides: { [midiChordOverrideKey(1, 0)]: "Dm(add9)" },
      title: "Reviewed MIDI",
      tempo: 112,
      key: "Dm",
      reviewConfirmed: true,
    })
    expect(project.title).toBe("Reviewed MIDI")
    expect(project.song).toMatchObject({ tempo: 112, key: "Dm" })
    expect(project.sections.map((section) => [section.name, section.role, section.lengthBars])).toEqual([
      ["Opening", "intro", 2],
      ["Hook", "chorus", 6],
    ])
    expect(project.chords.find((chord) => chord.sectionId === project.sections[0].id && chord.startBeat === 0)?.symbol).toBe("Dm(add9)")
    expect(project.sourceImport).toMatchObject({
      reviewConfirmed: true,
      melodyTrackName: "Piano Chords",
      keyInferenceSource: "user-confirmed",
      keyInferenceConfidence: 1,
    })
  })

  it("壊れたファイルをMIDIとして受理しない", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })
})
