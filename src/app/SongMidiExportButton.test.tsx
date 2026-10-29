import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import { DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from "@/core/arrangementGeneration"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import * as midi from "@/midi/exportMelody"
import { GmChannelCapacityError } from "@/midi/gmExport"
import { SongMidiExportButton } from "./SongMidiExportButton"
import { prepareSongMidiExport } from "./songMidiExport"

const project = createEmptyProject("Export notification")
project.sections = [{ id: "s", name: "サビ", role: "chorus", startBar: 1, lengthBars: 8 }]
const arrangement = generateFullSongArrangement(project, { seed: 19 })
const overloaded = { ...project, fullSongArrangement: {
  ...arrangement, tracks: (Object.keys(ARRANGEMENT_TRACK_NAMES) as ArrangementTrackId[])
    .filter(id => id.startsWith("syn-") || id.startsWith("str-")).slice(0, 16).map((id, i) => ({
    ...arrangement.tracks[0], id, name: ARRANGEMENT_TRACK_NAMES[id], family: "synth" as const,
    muted: false, instrument: { program: i, reason: "Capacity fixture" },
    notes: [{ id: `n${i}`, sectionId: "s", startBeat: 0, durationBeats: 4, pitch: 60, velocity: 80, locks: [], character: "safe" as const, reason: "Capacity fixture" }],
  })),
} }

afterEach(() => vi.restoreAllMocks())
describe("whole-song MIDI failure feedback", () => {
  it("converts a real channel-capacity error into an actionable message without changing the project", () => {
    const before = structuredClone(overloaded)
    expect(overloaded.fullSongArrangement.tracks).toHaveLength(16)
    expect(() => midi.exportSongMidi(overloaded, true, true, DEFAULT_PART_PROGRAMS)).toThrow(GmChannelCapacityError)
    const result = prepareSongMidiExport(overloaded, DEFAULT_PART_PROGRAMS)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("Capacity fixture unexpectedly exported")
    expect(result.message).toContain("楽器を揃える")
    expect(result.message).toContain("レイヤーを減らして")
    expect(result.message).not.toMatch(/GmChannel|tick|program/)
    expect(overloaded).toEqual(before)
  })
  it("keeps successful output byte-for-byte identical in both MIDI formats", () => {
    for (const programs of [undefined, DEFAULT_PART_PROGRAMS]) {
      const result = prepareSongMidiExport(project, programs)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.message)
      expect(result.bytes).toEqual(midi.exportSongMidi(project, true, true, programs))
    }
  })
  it("propagates unexpected exceptions rather than treating them as capacity failures", () => {
    const error = new Error("Unexpected export failure")
    vi.spyOn(midi, "exportSongMidi").mockImplementationOnce(() => { throw error })
    expect(() => prepareSongMidiExport(project)).toThrow(error)
  })
  it("starts without an alert and disables export when the song is empty", () => {
    const html = renderToStaticMarkup(<SongMidiExportButton project={createEmptyProject()} />)
    expect(html).toContain("disabled")
    expect(html).not.toContain('role="alert"')
  })
})
