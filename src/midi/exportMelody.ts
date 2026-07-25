import type { ChordEvent, ComposerProject } from "@/core/project"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import { notesByPartRole } from "@/core/sectionLayers"
import { parseTimeSignature } from "@/core/section"
import { parseChordSymbol } from "@/core/chord"
import { voiceChord } from "@/audio/chordVoicing"
import { buildSmf, TICKS_PER_QUARTER, type SmfTrack } from "./smf"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

/**
 * Logic ProがSMFを読み込む際、トラックごとに異なるチャンネルを持つと
 * Melody以外をGM Deviceの外部MIDIとして割り当てることがある。
 * SMF Type 1のトラック分離は維持し、全楽器トラックをMelodyと同じChannel 1へ揃える。
 */
const SOFTWARE_INSTRUMENT_MIDI_CHANNEL = 0

export interface ExportMelodyOptions {
  title: string
  sectionName: string
  tempo: number
  timeSignature: string
  chords: ChordEvent[]
  melody?: MelodyVariant
  /** Issue #45: コードから導出した独立Accompaniment Patternノート。 */
  accompanimentPatternNotes?: MelodyNote[]
  includeChords: boolean
  /** 指定するとその範囲(セクション相対拍)のみ書き出す */
  range?: { startBeat: number; endBeat: number }
}

function beatsToTicks(beats: number): number {
  return Math.round(beats * TICKS_PER_QUARTER)
}

export function exportMelodyMidi(opts: ExportMelodyOptions): Uint8Array {
  const ts = parseTimeSignature(opts.timeSignature)
  const range = opts.range ?? { startBeat: 0, endBeat: Infinity }

  const inRange = (note: MelodyNote) => note.startBeat >= range.startBeat && note.startBeat < range.endBeat
  const toSmfNote = (note: MelodyNote) => ({
    pitch: note.pitch,
    start: beatsToTicks(note.startBeat - range.startBeat),
    // 持続音はそのまま書き出す(コード境界での分割はしない)
    duration: beatsToTicks(note.durationBeats),
    velocity: note.velocity,
    channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
  })

  // Issue #41: partRoleの正はLayer。lead と accompaniment を別トラックへ分ける
  // (Ostinato/Droneを将来Arrangement Engineへ移すときの移行コストを作らない)。
  const leadNotes = opts.melody ? notesByPartRole(opts.melody, "lead").filter(inRange) : []
  const accompanimentNotes = opts.melody ? notesByPartRole(opts.melody, "accompaniment").filter(inRange) : []
  const accompanimentPatternNotes = (opts.accompanimentPatternNotes ?? []).filter(inRange)

  const tracks: SmfTrack[] = [{ name: "Active Melody", notes: leadNotes.map(toSmfNote) }]
  if (accompanimentNotes.length > 0) {
    tracks.push({ name: "Accompaniment", notes: accompanimentNotes.map(toSmfNote) })
  }
  if (accompanimentPatternNotes.length > 0) {
    tracks.push({
      name: "Accompaniment Pattern",
      notes: accompanimentPatternNotes.map(toSmfNote),
    })
  }

  if (opts.includeChords) {
    const chordNotes: SmfTrack["notes"] = []
    for (const c of opts.chords) {
      if (c.startBeat < range.startBeat || c.startBeat >= range.endBeat) continue
      const parsed = parseChordSymbol(c.symbol, c.bass ?? undefined)
      if (!parsed) continue
      const voicing = voiceChord(parsed)
      const start = beatsToTicks(c.startBeat - range.startBeat)
      const duration = beatsToTicks(c.durationBeats)
      chordNotes.push({
        pitch: voicing.bassMidi,
        start,
        duration,
        velocity: 70,
        channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
      })
      for (const m of voicing.upperMidi) {
        chordNotes.push({
          pitch: m,
          start,
          duration,
          velocity: 60,
          channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
        })
      }
    }
    tracks.unshift({ name: "Chords", notes: chordNotes })
  }

  return buildSmf({
    name: opts.title,
    tempoBpm: opts.tempo,
    timeSignature: ts,
    markers: [{ tick: 0, text: opts.sectionName }],
    tracks,
  })
}

export function exportSongMidi(project: ComposerProject, includeChords = true): Uint8Array {
  const ts = parseTimeSignature(project.song.timeSignature)
  const material = buildSongPlaybackMaterial(project)
  const toSmfNote = (note: MelodyNote) => ({
    pitch: note.pitch,
    start: beatsToTicks(note.startBeat),
    duration: beatsToTicks(note.durationBeats),
    velocity: note.velocity,
    channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
  })

  // Issue #41: lead と accompaniment(Ostinato/Drone)を別トラックへ分ける
  const tracks: SmfTrack[] = [{ name: "Active Melodies", notes: material.lead.map(toSmfNote) }]
  if (material.accompaniment.length > 0) {
    tracks.push({ name: "Accompaniment", notes: material.accompaniment.map(toSmfNote) })
  }
  if (material.accompanimentPattern.length > 0) {
    tracks.push({
      name: "Accompaniment Pattern",
      notes: material.accompanimentPattern.map(toSmfNote),
    })
  }

  if (includeChords) {
    const chordNotes: SmfTrack["notes"] = []
    for (const chord of material.chords) {
      const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      if (!parsed) continue
      const voicing = voiceChord(parsed)
      const start = beatsToTicks(chord.startBeat)
      const duration = beatsToTicks(chord.durationBeats)
      chordNotes.push({
        pitch: voicing.bassMidi,
        start,
        duration,
        velocity: 70,
        channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
      })
      for (const pitch of voicing.upperMidi) {
        chordNotes.push({
          pitch,
          start,
          duration,
          velocity: 60,
          channel: SOFTWARE_INSTRUMENT_MIDI_CHANNEL,
        })
      }
    }
    tracks.unshift({ name: "Chords", notes: chordNotes })
  }

  return buildSmf({
    name: project.title,
    tempoBpm: project.song.tempo,
    timeSignature: ts,
    markers: project.sections.map((section) => ({
      tick: beatsToTicks((section.startBar - 1) * ts.beatsPerBar),
      text: section.name,
    })),
    tracks,
  })
}

export function downloadMidi(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/midi" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename.endsWith(".mid") ? filename : `${filename}.mid`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
