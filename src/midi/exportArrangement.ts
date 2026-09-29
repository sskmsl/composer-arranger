import { songTempoChanges } from "@/core/tempoMap"
import type { FullSongArrangement, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { buildSmf, gridAlignedTicks, TICKS_PER_QUARTER, type SmfTrack } from "./smf"
import { arrangementTrackProgram, type SoundSettings } from "@/core/gmInstruments"
import { withGmSounds, type SoundedTrack } from "./gmExport"

const SOFTWARE_INSTRUMENT_MIDI_CHANNEL = 0

export interface ArrangementTrackPlacement {
  /** 個別MIDIは曲頭からの絶対位置を保持するため、Logic上では常に1小節目へ置く。 */
  importBar: 1
  firstSoundingBar: number
  lastSoundingBar: number
}

/** 個別MIDIの配置位置と、実際に音が現れる小節範囲をUIへ伝える。 */
export function arrangementTrackPlacement(
  project: ComposerProject,
  track: GeneratedArrangementTrack,
): ArrangementTrackPlacement | null {
  if (track.notes.length === 0) return null
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const firstBeat = Math.min(...track.notes.map((note) => note.startBeat))
  const lastBeat = Math.max(...track.notes.map((note) => note.startBeat + note.durationBeats))
  return {
    importBar: 1,
    firstSoundingBar: Math.floor(firstBeat / beatsPerBar) + 1,
    lastSoundingBar: Math.max(1, Math.ceil(lastBeat / beatsPerBar)),
  }
}

function toSmfTrack(track: GeneratedArrangementTrack): SmfTrack {
  return {
    name: track.name,
    notes: track.notes.map((note) => ({
      pitch: note.pitch,
      ...gridAlignedTicks(note.startBeat, note.durationBeats),
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

/** 全曲アレンジのうち、鳴らしている(ミュートしていない)トラックを、楽器(GM向けの書き出し用)つきのSMFトラックにする */
export function arrangementSoundedTracks(arrangement: FullSongArrangement | null | undefined): SoundedTrack[] {
  return (arrangement?.tracks ?? [])
    .filter((track) => !track.muted && track.notes.length > 0)
    .map((track) => ({ track: toSmfTrack(track), sound: arrangementTrackProgram(track.id) }))
}

/** 全曲アレンジのうち、鳴らしている(ミュートしていない)トラックをSMFトラックにする */
export function arrangementSmfTracks(arrangement: FullSongArrangement | null | undefined): SmfTrack[] {
  return arrangementSoundedTracks(arrangement).map((entry) => entry.track)
}

function song(
  project: ComposerProject,
  tracks: GeneratedArrangementTrack[],
  includeAdoptedLayers = false,
  gmPrograms?: SoundSettings["programs"],
): Uint8Array {
  const timeSignature = parseTimeSignature(project.song.timeSignature)
  const selectedMaterial = includeAdoptedLayers
    ? buildSongPlaybackMaterial(
        project,
        project.fullSongArrangement?.plan.directive?.timelineConstraints,
      )
    : null
  const selectedTracks: SoundedTrack[] = selectedMaterial
    ? ([
        selectedMaterial.counterLayers.length > 0
          ? { sound: "counter" as const, track: {
              name: "Selected Counter Melody",
              notes: selectedMaterial.counterLayers.map((note) => ({
                pitch: note.pitch,
                ...gridAlignedTicks(note.startBeat, note.durationBeats),
                velocity: note.velocity,
                channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
              })),
            } }
          : null,
        selectedMaterial.decorationLayers.length > 0
          ? { sound: "decoration" as const, track: {
              name: "Selected Decoration",
              notes: selectedMaterial.decorationLayers.map((note) => ({
                pitch: note.pitch,
                ...gridAlignedTicks(note.startBeat, note.durationBeats),
                velocity: note.velocity,
                channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
              })),
            } }
          : null,
        selectedMaterial.phraseLayers.length > 0
          ? { sound: "phrase" as const, track: {
              name: "Selected Phrases",
              notes: selectedMaterial.phraseLayers.map((note) => ({
                pitch: note.pitch,
                ...gridAlignedTicks(note.startBeat, note.durationBeats),
                velocity: note.velocity,
                channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
              })),
            } }
          : null,
        selectedMaterial.signaturePhraseLayers.length > 0
          ? { sound: "signature" as const, track: {
              name: "Selected Intro Phrases",
              notes: selectedMaterial.signaturePhraseLayers.map((note) => ({
                pitch: note.pitch,
                ...gridAlignedTicks(note.startBeat, note.durationBeats),
                velocity: note.velocity,
                channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
              })),
            } }
          : null,
      ] as Array<SoundedTrack | null>).filter((entry): entry is SoundedTrack => Boolean(entry))
    : []
  return buildSmf({
    name: `${project.title} Arrangement`,
    tempoBpm: project.song.tempo,
    tempoChanges: songTempoChanges(project).map((change) => ({
      tick: Math.round(change.beat * TICKS_PER_QUARTER),
      bpm: change.bpm,
    })),
    timeSignature,
    markers: project.sections.map((section) => ({
      tick: Math.round((section.startBar - 1) * timeSignature.beatsPerBar * TICKS_PER_QUARTER),
      text: section.name,
    })),
    tracks: withGmSounds([
      ...arrangementSoundedTracks({ tracks } as FullSongArrangement),
      ...selectedTracks,
    ], gmPrograms),
  })
}

export function exportArrangementMidi(
  project: ComposerProject,
  arrangement: FullSongArrangement,
  gmPrograms?: SoundSettings["programs"],
): Uint8Array {
  return song(project, arrangement.tracks, true, gmPrograms)
}

export function exportArrangementTrackMidi(
  project: ComposerProject,
  arrangement: FullSongArrangement,
  trackId: GeneratedArrangementTrack["id"],
  gmPrograms?: SoundSettings["programs"],
): Uint8Array {
  const track = arrangement.tracks.find((candidate) => candidate.id === trackId)
  return song(project, track ? [{ ...track, muted: false }] : [], false, gmPrograms)
}
