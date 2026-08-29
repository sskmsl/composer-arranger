import type { FullSongArrangement, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { buildSmf, TICKS_PER_QUARTER, type SmfTrack } from "./smf"

const SOFTWARE_INSTRUMENT_MIDI_CHANNEL = 0

function toSmfTrack(track: GeneratedArrangementTrack): SmfTrack {
  return {
    name: track.name,
    notes: track.notes.map((note) => ({
      pitch: note.pitch,
      start: Math.round(note.startBeat * TICKS_PER_QUARTER),
      duration: Math.max(1, Math.round(note.durationBeats * TICKS_PER_QUARTER)),
      velocity: note.velocity,
      channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
    })),
    textEvents: track.notes
      .filter((note, index, all) => index === all.findIndex((candidate) => candidate.sectionId === note.sectionId))
      .map((note) => ({
        tick: Math.round(note.startBeat * TICKS_PER_QUARTER),
        text: note.reason,
      })),
  }
}

function song(
  project: ComposerProject,
  tracks: GeneratedArrangementTrack[],
): Uint8Array {
  const timeSignature = parseTimeSignature(project.song.timeSignature)
  return buildSmf({
    name: `${project.title} Arrangement`,
    tempoBpm: project.song.tempo,
    timeSignature,
    markers: project.sections.map((section) => ({
      tick: Math.round((section.startBar - 1) * timeSignature.beatsPerBar * TICKS_PER_QUARTER),
      text: section.name,
    })),
    tracks: tracks.filter((track) => !track.muted && track.notes.length > 0).map(toSmfTrack),
  })
}

export function exportArrangementMidi(
  project: ComposerProject,
  arrangement: FullSongArrangement,
): Uint8Array {
  return song(project, arrangement.tracks)
}

export function exportArrangementTrackMidi(
  project: ComposerProject,
  arrangement: FullSongArrangement,
  trackId: GeneratedArrangementTrack["id"],
): Uint8Array {
  const track = arrangement.tracks.find((candidate) => candidate.id === trackId)
  return song(project, track ? [{ ...track, muted: false }] : [])
}
