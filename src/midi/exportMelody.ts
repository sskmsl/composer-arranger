import { effectiveSectionKey, type ChordEvent, type ComposerProject } from "@/core/project"
import { keySignatureOf } from "@/core/scale"
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
  /** Phraseなど、Melody Variantへ昇格させない短い独立素材。 */
  melodyNotes?: MelodyNote[]
  /** 既定は従来互換のActive Melody。Phrase出力時のみ上書きする。 */
  leadTrackName?: string
  /** Decoration単体出力など、空のLeadトラックを不要にする場合だけfalse。 */
  includeLeadTrack?: boolean
  /** Issue #45: コードから導出した独立Accompaniment Patternノート。 */
  accompanimentPatternNotes?: MelodyNote[]
  /** Issue #70: Active Melodyを変更しないCounter候補。 */
  reactiveNotes?: MelodyNote[]
  reactiveTrackName?: string
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
  const leadNotes = opts.melody
    ? notesByPartRole(opts.melody, "lead").filter(inRange)
    : (opts.melodyNotes ?? []).filter(inRange)
  const accompanimentNotes = opts.melody ? notesByPartRole(opts.melody, "accompaniment").filter(inRange) : []
  const accompanimentPatternNotes = (opts.accompanimentPatternNotes ?? []).filter(inRange)
  const reactiveNotes = (opts.reactiveNotes ?? []).filter(inRange)

  const tracks: SmfTrack[] =
    opts.includeLeadTrack === false
      ? []
      : [{ name: opts.leadTrackName ?? "Active Melody", notes: leadNotes.map(toSmfNote) }]
  if (accompanimentNotes.length > 0) {
    tracks.push({ name: "Accompaniment", notes: accompanimentNotes.map(toSmfNote) })
  }
  if (accompanimentPatternNotes.length > 0) {
    tracks.push({
      name: "Accompaniment Pattern",
      notes: accompanimentPatternNotes.map(toSmfNote),
    })
  }
  if (reactiveNotes.length > 0) {
    tracks.push({
      name: opts.reactiveTrackName ?? "Counter Melody",
      notes: reactiveNotes.map(toSmfNote),
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
  const material = buildSongPlaybackMaterial(
    project,
    project.fullSongArrangement?.plan.directive?.timelineConstraints,
  )
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
  if (material.counterLayers.length > 0) {
    tracks.push({
      name: "Selected Counter Melody",
      notes: material.counterLayers.map(toSmfNote),
    })
  }
  if (material.decorationLayers.length > 0) {
    tracks.push({
      name: "Selected Decoration",
      notes: material.decorationLayers.map(toSmfNote),
    })
  }
  if (material.phraseLayers.length > 0) {
    tracks.push({
      name: "Selected Phrases",
      notes: material.phraseLayers.map(toSmfNote),
    })
  }
  if (material.signaturePhraseLayers.length > 0) {
    tracks.push({
      name: "Selected Intro Phrases",
      notes: material.signaturePhraseLayers.map(toSmfNote),
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

  // 調号: 曲頭は最初のセクションの調、以降は調が変わるセクションの頭で変更する
  const keyChanges: NonNullable<Parameters<typeof buildSmf>[0]["keyChanges"]> = []
  let keySignature: ReturnType<typeof keySignatureOf> = keySignatureOf(project.song.key)
  let previousKey: string | null = null
  for (const section of project.sections) {
    const sectionKey = effectiveSectionKey(project, section.id)
    const signature = keySignatureOf(sectionKey)
    if (previousKey === null) {
      keySignature = signature ?? keySignature
    } else if (sectionKey !== previousKey && signature) {
      keyChanges.push({ tick: beatsToTicks((section.startBar - 1) * ts.beatsPerBar), ...signature })
    }
    previousKey = sectionKey
  }

  return buildSmf({
    name: project.title,
    tempoBpm: project.song.tempo,
    timeSignature: ts,
    ...(keySignature ? { keySignature } : {}),
    keyChanges,
    markers: project.sections.map((section) => ({
      tick: beatsToTicks((section.startBar - 1) * ts.beatsPerBar),
      text: section.name,
    })),
    tracks,
  })
}

interface MidiSaveFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
  }>
}

type MidiSavePicker = (options: {
  suggestedName: string
  types: Array<{
    description: string
    accept: Record<string, string[]>
  }>
}) => Promise<MidiSaveFileHandle>

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export function downloadMidi(bytes: Uint8Array, filename: string): void {
  // Uint8Arrayが大きなArrayBufferの一部分だった場合でも、対象範囲だけを書き出す。
  // また、クリック直後にObject URLを破棄するとSafari/Chromeの一部環境で
  // ダウンロード開始前にURLが無効になるため、後片付けは遅延させる。
  const payload = bytes.slice().buffer
  const blob = new Blob([payload], { type: "audio/midi" })
  const safeBaseName = [...filename]
    .map((character) => character.charCodeAt(0) < 32 ? "-" : character)
    .join("")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim() || "composer-arranger"
  const downloadName = safeBaseName.toLowerCase().endsWith(".mid")
    ? safeBaseName
    : `${safeBaseName}.mid`

  const fallbackDownload = () => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = downloadName
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    window.setTimeout(() => {
      a.remove()
      URL.revokeObjectURL(url)
    }, 1_000)
  }

  const savePicker = (window as Window & {
    showSaveFilePicker?: MidiSavePicker
  }).showSaveFilePicker
  if (!window.isSecureContext || !savePicker) {
    fallbackDownload()
    return
  }

  // Desktop Chromeでは保存先を明示できるOS標準ダイアログを優先する。
  // 未対応・一時的な失敗時は通常のブラウザダウンロードへ戻す。
  void savePicker({
    suggestedName: downloadName,
    types: [{
      description: "Standard MIDI File",
      accept: { "audio/midi": [".mid"] },
    }],
  })
    .then(async (handle) => {
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    })
    .catch((error: unknown) => {
      if (!isAbortError(error)) fallbackDownload()
    })
}
