import type { ChordEvent, ComposerProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import { parseTimeSignature } from "@/core/section"
import { parseChordSymbol } from "@/core/chord"
import { voiceChord } from "@/audio/chordVoicing"
import { buildSmf, TICKS_PER_QUARTER, type SmfTrack } from "./smf"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

export interface ExportMelodyOptions {
  title: string
  sectionName: string
  tempo: number
  timeSignature: string
  chords: ChordEvent[]
  melody: MelodyVariant
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

  const melodyTrack: SmfTrack = {
    name: "Active Melody",
    notes: opts.melody.notes
      .filter((n) => n.startBeat >= range.startBeat && n.startBeat < range.endBeat)
      .map((n) => ({
        pitch: n.pitch,
        start: beatsToTicks(n.startBeat - range.startBeat),
        duration: beatsToTicks(n.durationBeats),
        velocity: n.velocity,
        channel: 0,
      })),
  }

  const tracks: SmfTrack[] = [melodyTrack]

  if (opts.includeChords) {
    const chordNotes: SmfTrack["notes"] = []
    for (const c of opts.chords) {
      if (c.startBeat < range.startBeat || c.startBeat >= range.endBeat) continue
      const parsed = parseChordSymbol(c.symbol, c.bass ?? undefined)
      if (!parsed) continue
      const voicing = voiceChord(parsed)
      const start = beatsToTicks(c.startBeat - range.startBeat)
      const duration = beatsToTicks(c.durationBeats)
      chordNotes.push({ pitch: voicing.bassMidi, start, duration, velocity: 70, channel: 1 })
      for (const m of voicing.upperMidi) {
        chordNotes.push({ pitch: m, start, duration, velocity: 60, channel: 1 })
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
  const melodyTrack: SmfTrack = {
    name: "Active Melodies",
    notes: material.melody.map((note) => ({
      pitch: note.pitch,
      start: beatsToTicks(note.startBeat),
      duration: beatsToTicks(note.durationBeats),
      velocity: note.velocity,
      channel: 0,
    })),
  }
  const tracks: SmfTrack[] = [melodyTrack]

  if (includeChords) {
    const chordNotes: SmfTrack["notes"] = []
    for (const chord of material.chords) {
      const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      if (!parsed) continue
      const voicing = voiceChord(parsed)
      const start = beatsToTicks(chord.startBeat)
      const duration = beatsToTicks(chord.durationBeats)
      chordNotes.push({ pitch: voicing.bassMidi, start, duration, velocity: 70, channel: 1 })
      for (const pitch of voicing.upperMidi) {
        chordNotes.push({ pitch, start, duration, velocity: 60, channel: 1 })
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
