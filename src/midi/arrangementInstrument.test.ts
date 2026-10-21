import { describe, expect, it } from "vitest"
import { createEmptyProject, normalizeProject } from "@/core/project"
import type { FullSongArrangement, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { arrangementInstrument, DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"
import { gmPreviewRequests } from "@/audio/previewPlayer"
import { arrangementSoundedTracks, exportArrangementTrackMidi } from "./exportArrangement"
import { logicSoundRows } from "./logicProductionPackage"
import { parseMidi } from "./importMidi"

const track: GeneratedArrangementTrack = {
  id: "syn-pulse", name: "Comping", family: "synth", muted: false, generationRevision: 0, purpose: "accompaniment",
  instrument: { program: 24, reason: "分散伴奏" },
  notes: [{ id: "n", sectionId: "s", startBeat: 4, durationBeats: .5, pitch: 60, velocity: 64, locks: [], character: "safe", reason: "和声" }],
}

describe("saved arrangement instrument", () => {
  it("uses one decision for preview, MIDI, production guidance and saved reload", () => {
    const p = createEmptyProject("Instrument roundtrip")
    p.fullSongArrangement = { version: "1.0.0", tracks: [track], plan: { version: "1.0.0", seed: 19, brief: "", sections: [] }, analysis: { sections: [] } } as unknown as FullSongArrangement
    const loaded = normalizeProject(JSON.parse(JSON.stringify(p)))
    const arrangement = loaded.fullSongArrangement!
    expect(arrangementSoundedTracks(arrangement)[0].sound).toBe(24)
    const requests = gmPreviewRequests({ bpm: 100, mode: "melody-only", chords: [], melody: [], arrangementTracks: arrangement.tracks }, DEFAULT_PART_PROGRAMS)
    expect([...requests.keys()]).toEqual(["acoustic_guitar_nylon"])
    const midi = parseMidi(exportArrangementTrackMidi(loaded, arrangement, "syn-pulse", DEFAULT_PART_PROGRAMS))
    expect(midi.tracks.flatMap((t) => t.notes).map((n) => n.pitch)).toEqual([60])
    expect(logicSoundRows(loaded).find((r) => r.trackName === "Comping")).toMatchObject({ product: "Kontakt 8", preset: "Session Guitarist - Picked Nylon / Melody / Calm Sea (Melody)" })
  })

  it("keeps legacy defaults, ignores invalid programs and keeps drums on the drum kit", () => {
    expect(arrangementInstrument({ id: "syn-pulse" })).toBe(81)
    for (const program of [-1, 128, 1.5, NaN]) expect(arrangementInstrument({ ...track, instrument: { program, reason: "invalid" } })).toBe(81)
    expect(arrangementInstrument({ id: "dr-kick", instrument: { program: 24, reason: "ignored" } })).toBe("drums")
  })
})
