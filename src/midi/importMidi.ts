import {
  createEmptyProject,
  TIME_BASE,
  type ChordEvent,
  type ComposerProject,
  type ImportedArrangementMaterial,
  type ImportedArrangementTrackRole,
} from "@/core/project"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { Section, SectionRole } from "@/core/section"
import { DEFAULT_SECTION_CONTENT } from "@/core/sectionContent"

export const MIDI_IMPORT_ACCEPT = ".mid,.midi,audio/midi,audio/x-midi"

interface ParsedMidiNote {
  pitch: number
  velocity: number
  channel: number
  startTick: number
  durationTicks: number
}

interface ParsedMidiTrack {
  name: string
  notes: ParsedMidiNote[]
}

interface ParsedMidiMarker {
  tick: number
  text: string
}

interface ParsedMidiSong {
  format: number
  ppq: number
  title: string
  tempoBpm: number
  timeSignature: { numerator: number; denominator: number }
  keySignature: { sharpsFlats: number; minor: boolean } | null
  markers: ParsedMidiMarker[]
  tracks: ParsedMidiTrack[]
  endTick: number
}

export interface MidiProjectImportResult {
  project: ComposerProject
  report: {
    melodyTrackName: string
    melodyTrackConfidence: number
    chordInferenceConfidence: number
    sectionCount: number
    warnings: string[]
  }
}

export type MidiImportTrackRole = ImportedArrangementTrackRole

export interface MidiImportTrackSummary {
  index: number
  name: string
  noteCount: number
  averagePitch: number | null
  channelNumbers: number[]
  recommendedRole: MidiImportTrackRole
}

export interface MidiImportSectionDraft {
  id: string
  name: string
  role: SectionRole
  startBar: number
}

export interface MidiImportAnalysis {
  fileName: string
  title: string
  tempo: number
  key: string
  timeSignature: string
  totalBars: number
  tracks: MidiImportTrackSummary[]
  sections: MidiImportSectionDraft[]
  melodyTrackIndex: number
  melodyTrackConfidence: number
  sectionsFromMarkers: boolean
  warnings: string[]
  suggestedSourceKind: "logic-project" | "external-song"
  /** UIから隠す必要はないが、編集対象ではない解析済みイベント。再パースせず確定へ進むため保持する。 */
  source: ParsedMidiSong
}

export interface MidiImportReviewOptions {
  melodyTrackIndex?: number
  trackRoles?: Record<number, Exclude<MidiImportTrackRole, "melody">>
  sections?: MidiImportSectionDraft[]
  chordSymbolOverrides?: Record<string, string>
  title?: string
  tempo?: number
  key?: string
  /** 人が解析結果を確認・編集して確定した場合のみ true。 */
  reviewConfirmed?: boolean
  sourceKind?: "logic-project" | "external-song"
}

class MidiReader {
  private offset = 0
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  position(): number {
    return this.offset
  }

  remaining(): number {
    return this.bytes.length - this.offset
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.bytes.length) throw new Error("MIDIのチャンク長が不正です。")
    this.offset = offset
  }

  byte(): number {
    if (this.offset >= this.bytes.length) throw new Error("MIDIファイルが途中で終了しています。")
    return this.bytes[this.offset++]
  }

  bytesOf(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("MIDIイベントの長さが不正です。")
    }
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  uint16(): number {
    return (this.byte() << 8) | this.byte()
  }

  uint32(): number {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0
  }

  text(length: number): string {
    return new TextDecoder().decode(this.bytesOf(length)).replace(/\0/g, "").trim()
  }

  fourCc(): string {
    return String.fromCharCode(...this.bytesOf(4))
  }

  vlq(): number {
    let value = 0
    for (let index = 0; index < 4; index += 1) {
      const byte = this.byte()
      value = (value << 7) | (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new Error("MIDIの可変長数値が不正です。")
  }
}

function channelDataLength(status: number): number {
  const kind = status & 0xf0
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2
}

function parseTrack(reader: MidiReader, endOffset: number, trackIndex: number): {
  track: ParsedMidiTrack
  markers: ParsedMidiMarker[]
  title: string
  tempoBpm: number | null
  timeSignature: ParsedMidiSong["timeSignature"] | null
  keySignature: ParsedMidiSong["keySignature"]
  endTick: number
} {
  let tick = 0
  let runningStatus: number | null = null
  let name = `Track ${trackIndex + 1}`
  let title = ""
  let tempoBpm: number | null = null
  let timeSignature: ParsedMidiSong["timeSignature"] | null = null
  let keySignature: ParsedMidiSong["keySignature"] = null
  const markers: ParsedMidiMarker[] = []
  const notes: ParsedMidiNote[] = []
  const active = new Map<string, Array<{ startTick: number; velocity: number }>>()

  const closeNote = (channel: number, pitch: number) => {
    const key = `${channel}:${pitch}`
    const stack = active.get(key)
    const opened = stack?.shift()
    if (!opened) return
    notes.push({
      pitch,
      channel,
      velocity: opened.velocity,
      startTick: opened.startTick,
      durationTicks: Math.max(1, tick - opened.startTick),
    })
    if (stack?.length === 0) active.delete(key)
  }

  while (reader.position() < endOffset) {
    tick += reader.vlq()
    let status = reader.byte()
    let firstData: number | null = null
    if (status < 0x80) {
      if (runningStatus === null) throw new Error("MIDIのRunning Statusが不正です。")
      firstData = status
      status = runningStatus
    } else if (status < 0xf0) {
      runningStatus = status
    }

    if (status === 0xff) {
      runningStatus = null
      const type = reader.byte()
      const length = reader.vlq()
      const dataStart = reader.position()
      if (type === 0x03) {
        const value = reader.text(length)
        if (value) {
          name = value
          if (!title) title = value
        }
      } else if (type === 0x06) {
        const value = reader.text(length)
        if (value) markers.push({ tick, text: value })
      } else if (type === 0x51 && length === 3) {
        const micros = (reader.byte() << 16) | (reader.byte() << 8) | reader.byte()
        if (micros > 0) tempoBpm = 60_000_000 / micros
      } else if (type === 0x58 && length >= 2) {
        const numerator = reader.byte()
        const denominator = 2 ** reader.byte()
        timeSignature = { numerator, denominator }
      } else if (type === 0x59 && length >= 2) {
        const raw = reader.byte()
        keySignature = { sharpsFlats: raw > 127 ? raw - 256 : raw, minor: reader.byte() === 1 }
      }
      reader.seek(dataStart + length)
      if (type === 0x2f) break
      continue
    }

    if (status === 0xf0 || status === 0xf7) {
      runningStatus = null
      reader.bytesOf(reader.vlq())
      continue
    }
    if (status >= 0xf0) throw new Error(`未対応のMIDI System Eventです: 0x${status.toString(16)}`)

    const length = channelDataLength(status)
    const data1 = firstData ?? reader.byte()
    const data2 = length === 2 ? reader.byte() : 0
    const channel = status & 0x0f
    const kind = status & 0xf0
    if (kind === 0x90 && data2 > 0) {
      const key = `${channel}:${data1}`
      const stack = active.get(key) ?? []
      stack.push({ startTick: tick, velocity: data2 })
      active.set(key, stack)
    } else if (kind === 0x80 || (kind === 0x90 && data2 === 0)) {
      closeNote(channel, data1)
    }
  }

  for (const [key, stack] of active) {
    const [channel, pitch] = key.split(":").map(Number)
    for (const opened of stack) {
      notes.push({
        pitch,
        channel,
        velocity: opened.velocity,
        startTick: opened.startTick,
        durationTicks: Math.max(1, tick - opened.startTick),
      })
    }
  }
  reader.seek(endOffset)
  return {
    track: { name, notes: notes.sort((left, right) => left.startTick - right.startTick || left.pitch - right.pitch) },
    markers,
    title,
    tempoBpm,
    timeSignature,
    keySignature,
    endTick: tick,
  }
}

export function parseMidi(bytes: Uint8Array): ParsedMidiSong {
  const reader = new MidiReader(bytes)
  if (reader.fourCc() !== "MThd") throw new Error("Standard MIDI Fileではありません。")
  const headerLength = reader.uint32()
  if (headerLength < 6) throw new Error("MIDIヘッダーが不正です。")
  const format = reader.uint16()
  const trackCount = reader.uint16()
  const division = reader.uint16()
  if ((division & 0x8000) !== 0) throw new Error("SMPTE時間形式のMIDIにはまだ対応していません。")
  if (format > 1) throw new Error("SMF Type 0またはType 1のMIDIを選択してください。")
  if (trackCount < 1) throw new Error("MIDIにトラックがありません。")
  reader.seek(8 + headerLength)

  const tracks: ParsedMidiTrack[] = []
  const markers: ParsedMidiMarker[] = []
  let title = ""
  let tempoBpm = 120
  let timeSignature = { numerator: 4, denominator: 4 }
  let keySignature: ParsedMidiSong["keySignature"] = null
  let endTick = 0
  let tempoFound = false
  let timeSignatureFound = false
  let keyFound = false

  for (let index = 0; index < trackCount; index += 1) {
    if (reader.remaining() < 8 || reader.fourCc() !== "MTrk") throw new Error("MIDIトラックが不正です。")
    const length = reader.uint32()
    const endOffset = reader.position() + length
    const parsed = parseTrack(reader, endOffset, index)
    tracks.push(parsed.track)
    markers.push(...parsed.markers)
    if (!title && parsed.title) title = parsed.title
    if (!tempoFound && parsed.tempoBpm !== null) {
      tempoBpm = parsed.tempoBpm
      tempoFound = true
    }
    if (!timeSignatureFound && parsed.timeSignature) {
      timeSignature = parsed.timeSignature
      timeSignatureFound = true
    }
    if (!keyFound && parsed.keySignature) {
      keySignature = parsed.keySignature
      keyFound = true
    }
    endTick = Math.max(endTick, parsed.endTick)
  }
  return { format, ppq: division, title, tempoBpm, timeSignature, keySignature, markers, tracks, endTick }
}

const SHARP_KEYS = ["C", "G", "D", "A", "E", "B", "F#", "C#"]
const FLAT_KEYS = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]
const SHARP_MINOR_KEYS = ["Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m"]
const FLAT_MINOR_KEYS = ["Am", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm", "Abm"]
const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

function keyFromSignature(signature: NonNullable<ParsedMidiSong["keySignature"]>): string {
  const count = Math.min(7, Math.abs(signature.sharpsFlats))
  if (signature.minor) return signature.sharpsFlats >= 0 ? SHARP_MINOR_KEYS[count] : FLAT_MINOR_KEYS[count]
  return signature.sharpsFlats >= 0 ? SHARP_KEYS[count] : FLAT_KEYS[count]
}

function pitchClassProfile(notes: ParsedMidiNote[]): number[] {
  const profile = Array.from({ length: 12 }, () => 0)
  for (const note of notes) profile[note.pitch % 12] += Math.max(1, note.durationTicks)
  const total = profile.reduce((sum, value) => sum + value, 0) || 1
  return profile.map((value) => value / total)
}

function inferKey(notes: ParsedMidiNote[]): string {
  const source = pitchClassProfile(notes)
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
  const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  let best = { score: -Infinity, root: 0, minor: false }
  for (let root = 0; root < 12; root += 1) {
    for (const isMinor of [false, true]) {
      const template = isMinor ? minor : major
      const score = source.reduce((sum, value, pc) => sum + value * template[(pc - root + 12) % 12], 0)
      if (score > best.score) best = { score, root, minor: isMinor }
    }
  }
  return `${PC_NAMES[best.root]}${best.minor ? "m" : ""}`
}

function isDrumTrack(track: ParsedMidiTrack): boolean {
  return track.notes.length > 0 && track.notes.filter((note) => note.channel === 9).length / track.notes.length > 0.5
}

function melodyTrackScore(track: ParsedMidiTrack): number {
  if (track.notes.length === 0 || isDrumTrack(track)) return -Infinity
  const sorted = [...track.notes].sort((left, right) => left.startTick - right.startTick || left.pitch - right.pitch)
  let overlapCount = 0
  let latestEnd = -1
  for (const note of sorted) {
    if (note.startTick < latestEnd) overlapCount += 1
    latestEnd = Math.max(latestEnd, note.startTick + note.durationTicks)
  }
  const monophony = 1 - overlapCount / Math.max(1, sorted.length)
  const averagePitch = sorted.reduce((sum, note) => sum + note.pitch, 0) / sorted.length
  const named = /(melody|lead|vocal|vox|voice|main|theme|メロディ|主旋律)/i.test(track.name) ? 1 : 0
  const accompanimentNamed = /(chord|pad|piano|bass|drum|伴奏|コード)/i.test(track.name) ? 1 : 0
  return named * 4 + monophony * 3 + Math.min(1, sorted.length / 24) + averagePitch / 127 - accompanimentNamed * 2
}

function chooseMelodyTrack(tracks: ParsedMidiTrack[]): { track: ParsedMidiTrack; index: number; confidence: number } {
  const ranked = tracks
    .map((track, index) => ({ track, index, score: melodyTrackScore(track) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)
  if (ranked.length === 0) throw new Error("読み込める音符トラックがありません。")
  const gap = ranked.length > 1 ? ranked[0].score - ranked[1].score : 3
  return { track: ranked[0].track, index: ranked[0].index, confidence: Number(Math.min(0.98, 0.58 + gap * 0.1).toFixed(2)) }
}

function recommendedTrackRole(track: ParsedMidiTrack, index: number, melodyIndex: number): MidiImportTrackRole {
  if (index === melodyIndex) return "melody"
  if (track.notes.length === 0) return "ignore"
  if (isDrumTrack(track)) return "drums"
  const pitched = track.notes.filter((note) => note.channel !== 9)
  const averagePitch = pitched.reduce((sum, note) => sum + note.pitch, 0) / Math.max(1, pitched.length)
  if (/(decoration|transition|fx|effect|riser|reverse|装飾)/i.test(track.name)) return "decoration"
  if (/(counter|response|answer|対旋律)/i.test(track.name)) return "counter"
  if (/(string|violin|viola|cello|ensemble|ストリング)/i.test(track.name)) return "strings"
  if (/(pulse|percussion|perc|rhythm|beat)/i.test(track.name)) return "drums"
  if (/(bass|sub|低音|ベース)/i.test(track.name) || averagePitch < 49) return "bass"
  if (/(chord|pad|piano|keys|string|guitar|伴奏|コード)/i.test(track.name)) return "harmony"
  if (/(accompaniment|arpeggio|ostinato|pattern)/i.test(track.name)) return "accompaniment"
  return "other"
}

function suggestedSourceKind(song: ParsedMidiSong): "logic-project" | "external-song" {
  const names = song.tracks.map((track) => track.name).join(" ")
  return /(logic production package|active melody|bass guide|chord guide|accompaniment pulse|decoration and transition)/i.test(names)
    ? "logic-project"
    : "external-song"
}

function sectionRoleFromName(name: string): SectionRole {
  if (/(intro|イントロ)/i.test(name)) return "intro"
  if (/(pre.?chorus|bメロ)/i.test(name)) return "pre-chorus"
  if (/(grand.?chorus|大サビ)/i.test(name)) return "grand-chorus"
  if (/(breakdown.?chorus|落ちサビ)/i.test(name)) return "breakdown-chorus"
  if (/(chorus|サビ)/i.test(name)) return "chorus"
  if (/(verse|aメロ)/i.test(name)) return "verse"
  if (/(c.?melody|cメロ)/i.test(name)) return "c-melody"
  if (/(bridge|ブリッジ)/i.test(name)) return "bridge"
  if (/(outro|エンディング|アウトロ)/i.test(name)) return "outro"
  return "instrumental"
}

interface SectionWindow {
  section: Section
  startBeat: number
  endBeat: number
}

function buildSections(song: ParsedMidiSong): { windows: SectionWindow[]; fromMarkers: boolean } {
  const beatsPerBar = song.timeSignature.numerator * 4 / song.timeSignature.denominator
  const totalBeats = Math.max(beatsPerBar, song.endTick / song.ppq)
  const totalBars = Math.max(1, Math.ceil(totalBeats / beatsPerBar))
  const markerBars = song.markers
    .map((marker) => ({ bar: Math.max(0, Math.round(marker.tick / song.ppq / beatsPerBar)), name: marker.text }))
    .filter((marker) => marker.bar < totalBars)
    .sort((left, right) => left.bar - right.bar)
    .filter((marker, index, values) => index === 0 || marker.bar !== values[index - 1].bar)
  if (markerBars.length === 0) {
    const section: Section = {
      id: crypto.randomUUID(),
      name: "Imported Song",
      role: "instrumental",
      startBar: 1,
      lengthBars: totalBars,
      content: { ...DEFAULT_SECTION_CONTENT },
    }
    return { windows: [{ section, startBeat: 0, endBeat: totalBars * beatsPerBar }], fromMarkers: false }
  }
  if (markerBars[0].bar > 0) markerBars.unshift({ bar: 0, name: "Imported Intro" })
  const windows = markerBars.map((marker, index) => {
    const nextBar = markerBars[index + 1]?.bar ?? totalBars
    const lengthBars = Math.max(1, nextBar - marker.bar)
    const section: Section = {
      id: crypto.randomUUID(),
      name: marker.name || `Section ${index + 1}`,
      role: sectionRoleFromName(marker.name),
      startBar: marker.bar + 1,
      lengthBars,
      content: { ...DEFAULT_SECTION_CONTENT },
    }
    return { section, startBeat: marker.bar * beatsPerBar, endBeat: (marker.bar + lengthBars) * beatsPerBar }
  })
  return { windows, fromMarkers: true }
}

function windowsFromSectionDrafts(
  song: ParsedMidiSong,
  drafts: MidiImportSectionDraft[],
): SectionWindow[] {
  const beatsPerBar = song.timeSignature.numerator * 4 / song.timeSignature.denominator
  const totalBars = Math.max(1, Math.ceil(Math.max(beatsPerBar, song.endTick / song.ppq) / beatsPerBar))
  const normalized = drafts
    .map((draft, index) => ({
      ...draft,
      name: draft.name.trim() || `Section ${index + 1}`,
      startBar: Math.max(1, Math.min(totalBars, Math.round(draft.startBar))),
    }))
    .sort((left, right) => left.startBar - right.startBar)
    .filter((draft, index, values) => index === 0 || draft.startBar !== values[index - 1].startBar)
  if (normalized.length === 0 || normalized[0].startBar !== 1) {
    normalized.unshift({ id: "import-section-1", name: "Imported Intro", role: "intro", startBar: 1 })
  }
  return normalized.map((draft, index) => {
    const nextStartBar = normalized[index + 1]?.startBar ?? totalBars + 1
    const lengthBars = Math.max(1, nextStartBar - draft.startBar)
    const section: Section = {
      id: crypto.randomUUID(),
      name: draft.name,
      role: draft.role,
      startBar: draft.startBar,
      lengthBars,
      content: { ...DEFAULT_SECTION_CONTENT },
    }
    return {
      section,
      startBeat: (draft.startBar - 1) * beatsPerBar,
      endBeat: (draft.startBar - 1 + lengthBars) * beatsPerBar,
    }
  })
}

export function midiChordOverrideKey(sectionStartBar: number, chordStartBeat: number): string {
  return `${sectionStartBar}:${Number(chordStartBeat.toFixed(4))}`
}

const CHORD_TEMPLATES = [
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "dim", intervals: [0, 3, 6] },
  { suffix: "sus2", intervals: [0, 2, 7] },
  { suffix: "sus4", intervals: [0, 5, 7] },
] as const

function inferChordForWindow(notes: ParsedMidiNote[], startTick: number, endTick: number): { symbol: string; score: number } | null {
  const weights = Array.from({ length: 12 }, () => 0)
  let lowest: ParsedMidiNote | null = null
  for (const note of notes) {
    const overlap = Math.max(0, Math.min(endTick, note.startTick + note.durationTicks) - Math.max(startTick, note.startTick))
    if (overlap <= 0) continue
    weights[note.pitch % 12] += overlap
    if (!lowest || note.pitch < lowest.pitch) lowest = note
  }
  const total = weights.reduce((sum, value) => sum + value, 0)
  if (total === 0) return null
  let best = { symbol: "C", score: -Infinity }
  for (let root = 0; root < 12; root += 1) {
    for (const template of CHORD_TEMPLATES) {
      const tones = new Set(template.intervals.map((interval) => (root + interval) % 12))
      const inside = weights.reduce((sum, value, pc) => sum + (tones.has(pc) ? value : 0), 0)
      const rootWeight = weights[root] / total
      const bassBonus = lowest && lowest.pitch % 12 === root ? 0.12 : 0
      const complexityPenalty = template.suffix.startsWith("sus") ? 0.025 : template.suffix === "dim" ? 0.015 : 0
      const score = inside / total * 0.84 + rootWeight * 0.16 + bassBonus - complexityPenalty
      if (score > best.score) best = { symbol: `${PC_NAMES[root]}${template.suffix}`, score }
    }
  }
  return best
}

function inferChords(
  song: ParsedMidiSong,
  accompanimentNotes: ParsedMidiNote[],
  windows: SectionWindow[],
  fallbackKey: string,
): { chords: ChordEvent[]; confidence: number } {
  const beatsPerBar = song.timeSignature.numerator * 4 / song.timeSignature.denominator
  const slotBeats = Math.max(1, beatsPerBar / 2)
  const slots: Array<{ startBeat: number; durationBeats: number; symbol: string; score: number }> = []
  let previousSymbol = fallbackKey.replace(/m$/, "") || "C"
  for (let startBeat = 0; startBeat < song.endTick / song.ppq; startBeat += slotBeats) {
    const durationBeats = Math.min(slotBeats, song.endTick / song.ppq - startBeat)
    const inferred = inferChordForWindow(
      accompanimentNotes,
      Math.round(startBeat * song.ppq),
      Math.round((startBeat + durationBeats) * song.ppq),
    )
    const symbol = inferred?.symbol ?? previousSymbol
    slots.push({ startBeat, durationBeats, symbol, score: inferred?.score ?? 0.25 })
    previousSymbol = symbol
  }
  const merged: typeof slots = []
  for (const slot of slots) {
    const previous = merged[merged.length - 1]
    if (previous && previous.symbol === slot.symbol && Math.abs(previous.startBeat + previous.durationBeats - slot.startBeat) < 0.001) {
      const totalDuration = previous.durationBeats + slot.durationBeats
      previous.score = (previous.score * previous.durationBeats + slot.score * slot.durationBeats) / totalDuration
      previous.durationBeats = totalDuration
    } else merged.push({ ...slot })
  }
  const chords: ChordEvent[] = []
  for (const window of windows) {
    for (const chord of merged) {
      const start = Math.max(window.startBeat, chord.startBeat)
      const end = Math.min(window.endBeat, chord.startBeat + chord.durationBeats)
      if (end <= start) continue
      chords.push({
        id: crypto.randomUUID(),
        sectionId: window.section.id,
        startBeat: start - window.startBeat,
        durationBeats: end - start,
        symbol: chord.symbol,
        bass: null,
      })
    }
  }
  const confidence = slots.reduce((sum, slot) => sum + slot.score, 0) / Math.max(1, slots.length)
  return { chords, confidence: Number(Math.min(0.98, confidence).toFixed(2)) }
}

function notesForSection(track: ParsedMidiTrack, song: ParsedMidiSong, window: SectionWindow): MelodyNote[] {
  return track.notes.filter((note) => note.channel !== 9).flatMap((note) => {
    const globalStart = note.startTick / song.ppq
    const globalEnd = (note.startTick + note.durationTicks) / song.ppq
    const start = Math.max(window.startBeat, globalStart)
    const end = Math.min(window.endBeat, globalEnd)
    if (end <= start) return []
    return [{
      id: crypto.randomUUID(),
      startBeat: Number((start - window.startBeat).toFixed(4)),
      durationBeats: Number(Math.max(1 / 64, end - start).toFixed(4)),
      pitch: note.pitch,
      velocity: note.velocity,
      locks: [],
    }]
  })
}

function cleanFileName(fileName: string): string {
  return fileName.replace(/\.(mid|midi)$/i, "").trim() || "Imported MIDI"
}

export function analyzeMidiImport(bytes: Uint8Array, fileName: string): MidiImportAnalysis {
  const song = parseMidi(bytes)
  const pitchedTracks = song.tracks.filter((track) => track.notes.some((note) => note.channel !== 9))
  const allPitchedNotes = pitchedTracks.flatMap((track) => track.notes.filter((note) => note.channel !== 9))
  if (allPitchedNotes.length === 0) throw new Error("MIDIに音程を持つノートがありません。")
  const melody = chooseMelodyTrack(song.tracks)
  const key = song.keySignature ? keyFromSignature(song.keySignature) : inferKey(allPitchedNotes)
  const { windows, fromMarkers } = buildSections(song)
  const beatsPerBar = song.timeSignature.numerator * 4 / song.timeSignature.denominator
  const totalBars = Math.max(1, Math.ceil(Math.max(beatsPerBar, song.endTick / song.ppq) / beatsPerBar))
  const warnings: string[] = []
  if (!fromMarkers) warnings.push("セクションマーカーがないため、曲全体を1セクションとして候補化しました。")
  if (!song.keySignature) warnings.push("キー情報がないため、ノート分布から推定しました。")
  if (melody.confidence < 0.72) warnings.push("メロディトラックの判定候補が拮抗しています。主旋律トラックを確認してください。")
  return {
    fileName,
    title: song.title || cleanFileName(fileName),
    tempo: Math.max(20, Math.min(300, Math.round(song.tempoBpm * 10) / 10)),
    key,
    timeSignature: `${song.timeSignature.numerator}/${song.timeSignature.denominator}`,
    totalBars,
    tracks: song.tracks.map((track, index) => {
      const pitched = track.notes.filter((note) => note.channel !== 9)
      return {
        index,
        name: track.name,
        noteCount: track.notes.length,
        averagePitch: pitched.length > 0
          ? Number((pitched.reduce((sum, note) => sum + note.pitch, 0) / pitched.length).toFixed(1))
          : null,
        channelNumbers: [...new Set(track.notes.map((note) => note.channel + 1))].sort((left, right) => left - right),
        recommendedRole: recommendedTrackRole(track, index, melody.index),
      }
    }),
    sections: windows.map((window, index) => ({
      id: `import-section-${index + 1}`,
      name: window.section.name,
      role: window.section.role,
      startBar: window.section.startBar,
    })),
    melodyTrackIndex: melody.index,
    melodyTrackConfidence: melody.confidence,
    sectionsFromMarkers: fromMarkers,
    warnings,
    suggestedSourceKind: suggestedSourceKind(song),
    source: song,
  }
}

export function createMidiProjectFromAnalysis(
  analysis: MidiImportAnalysis,
  options: MidiImportReviewOptions = {},
): MidiProjectImportResult {
  const song = analysis.source
  const melodyIndex = options.melodyTrackIndex ?? analysis.melodyTrackIndex
  const melodyTrack = melodyIndex >= 0 ? song.tracks[melodyIndex] : undefined
  if (melodyIndex >= 0 && (!melodyTrack || melodyTrack.notes.every((note) => note.channel === 9))) {
    throw new Error("主旋律として利用できるトラックを選択してください。")
  }
  const roles = Object.fromEntries(
    analysis.tracks.map((track) => [
      track.index,
      track.index === melodyIndex
        ? "melody"
        : options.trackRoles?.[track.index] ?? (track.recommendedRole === "melody" ? "other" : track.recommendedRole),
    ]),
  ) as Record<number, MidiImportTrackRole>
  const windows = windowsFromSectionDrafts(song, options.sections ?? analysis.sections)
  const allPitchedNotes = song.tracks.flatMap((track) => track.notes.filter((note) => note.channel !== 9))
  const accompanimentTracks = song.tracks.filter((_track, index) => roles[index] === "harmony" || roles[index] === "bass")
  const accompanimentNotes = accompanimentTracks.flatMap((track) => track.notes.filter((note) => note.channel !== 9))
  const chordSource = accompanimentNotes.length > 0 ? accompanimentNotes : allPitchedNotes
  const key = options.key?.trim() || analysis.key
  const harmony = inferChords(song, chordSource, windows, key)
  const overrides = options.chordSymbolOverrides ?? {}
  const chords = harmony.chords.map((chord) => {
    const section = windows.find((window) => window.section.id === chord.sectionId)?.section
    const override = section ? overrides[midiChordOverrideKey(section.startBar, chord.startBeat)]?.trim() : ""
    return override ? { ...chord, symbol: override } : chord
  })
  const project = createEmptyProject(options.title?.trim() || analysis.title)
  const batchId = crypto.randomUUID()
  const variants: MelodyVariant[] = melodyTrack ? windows.flatMap((window, index) => {
    const notes = notesForSection(melodyTrack, song, window)
    if (notes.length === 0) return []
    return [{
      id: crypto.randomUUID(),
      name: `${window.section.name} · ${melodyTrack.name}`,
      sectionId: window.section.id,
      sourceMode: "import-midi",
      notes,
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features: null,
      generatorVersion: "midi-import-1",
      seed: index,
      songProfile: project.song.songProfile,
      parentMelodyId: null,
      batchId,
      createdAt: new Date().toISOString(),
      leadContent: "melody",
    }]
  }) : []
  const assignments = Object.fromEntries(variants.map((variant) => [variant.sectionId, variant.id]))
  const warnings = [...analysis.warnings]
  if (accompanimentNotes.length === 0) warnings.push("Harmony/Bassトラックがないため、コード推定の信頼度は低めです。")

  const importedAt = new Date().toISOString()
  const sourceKind = options.sourceKind ?? analysis.suggestedSourceKind
  const importedArrangement: ImportedArrangementMaterial = {
    version: "1.0.0",
    sourceKind,
    totalBeats: Number((song.endTick / song.ppq).toFixed(4)),
    tracks: song.tracks.flatMap((track, trackIndex) => {
      const role = roles[trackIndex]
      if (role === "ignore" || track.notes.length === 0) return []
      return [{
        sourceTrackIndex: trackIndex,
        name: track.name,
        role,
        notes: track.notes.map((note) => [
          Number((note.startTick / song.ppq).toFixed(4)),
          Number((Math.max(1, note.durationTicks) / song.ppq).toFixed(4)),
          note.pitch,
          note.velocity,
          note.channel + 1,
        ]),
      }]
    }),
  }
  const resultProject: ComposerProject = {
    ...project,
    song: {
      ...project.song,
      key,
      tempo: Math.max(20, Math.min(300, Number(options.tempo) || analysis.tempo)),
      timeSignature: `${song.timeSignature.numerator}/${song.timeSignature.denominator}`,
    },
    sections: windows.map((window) => window.section),
    chords,
    melodyVariants: variants,
    activeMelodyId: variants[0]?.id ?? null,
    sectionMelodyAssignments: assignments,
    notes: `${sourceKind === "logic-project" ? "Logic Pro" : "外部曲"}のMIDIから作成 (${analysis.fileName})。コード・メロディ・キーは推定を含みます。`,
    sourceImport: {
      type: "midi",
      sourceKind,
      fileName: analysis.fileName,
      importedAt,
      format: song.format,
      ppq: song.ppq,
      trackCount: song.tracks.length,
      melodyTrackName: melodyTrack?.name ?? "主旋律なし",
      melodyTrackConfidence: melodyTrack ? (melodyIndex === analysis.melodyTrackIndex ? analysis.melodyTrackConfidence : 1) : 0,
      chordInferenceConfidence: harmony.confidence,
      sectionsFromMarkers: analysis.sectionsFromMarkers,
      reviewConfirmed: options.reviewConfirmed ?? false,
      trackAssignments: analysis.tracks.map((track) => ({
        trackName: track.name,
        role: roles[track.index],
      })),
      warnings,
    },
    importedArrangement,
    timeBase: TIME_BASE,
  }
  return {
    project: resultProject,
    report: {
      melodyTrackName: melodyTrack?.name ?? "主旋律なし",
      melodyTrackConfidence: melodyTrack ? (melodyIndex === analysis.melodyTrackIndex ? analysis.melodyTrackConfidence : 1) : 0,
      chordInferenceConfidence: harmony.confidence,
      sectionCount: windows.length,
      warnings,
    },
  }
}

export function midiToComposerProject(bytes: Uint8Array, fileName: string): MidiProjectImportResult {
  return createMidiProjectFromAnalysis(analyzeMidiImport(bytes, fileName))
}

export async function readMidiProjectFile(file: File): Promise<MidiProjectImportResult> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith(".mid") && !lower.endsWith(".midi") && !file.type.includes("midi")) {
    throw new Error(".mid または .midi ファイルを選択してください。")
  }
  return midiToComposerProject(new Uint8Array(await file.arrayBuffer()), file.name)
}

export async function analyzeMidiProjectFile(file: File): Promise<MidiImportAnalysis> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith(".mid") && !lower.endsWith(".midi") && !file.type.includes("midi")) {
    throw new Error(".mid または .midi ファイルを選択してください。")
  }
  return analyzeMidiImport(new Uint8Array(await file.arrayBuffer()), file.name)
}
