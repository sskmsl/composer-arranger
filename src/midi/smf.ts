/**
 * Standard MIDI File (SMF) Type 1 エンコーダ。外部ライブラリを使わずバイナリを直接組み立てる。
 */
export const TICKS_PER_QUARTER = 480

export interface MidiNote {
  pitch: number
  start: number
  duration: number
  velocity: number
  channel: number
}

export interface MidiMarker {
  tick: number
  text: string
}

function vlq(value: number): number[] {
  let v = Math.max(0, Math.floor(value))
  const bytes = [v & 0x7f]
  v = Math.floor(v / 128)
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  return bytes
}

function uint32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}
function uint16(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff]
}
function textBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}
function metaEvent(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data]
}

interface AbsEvent {
  tick: number
  order: number
  data: number[]
}

function buildTrack(events: AbsEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order)
  const body: number[] = []
  let last = 0
  for (const e of sorted) {
    body.push(...vlq(e.tick - last), ...e.data)
    last = e.tick
  }
  body.push(0x00, 0xff, 0x2f, 0x00)
  return [...textBytes("MTrk"), ...uint32(body.length), ...body]
}

export interface SmfTrack {
  name: string
  notes: MidiNote[]
  textEvents?: MidiMarker[]
}

export interface SmfSong {
  name: string
  tempoBpm: number
  /** MIDIの拍子メタイベントに書き出す表記上の分子・分母(例: 6/8ならnumerator:6, denominator:8) */
  timeSignature: { numerator: number; denominator: number }
  markers: MidiMarker[]
  tracks: SmfTrack[]
}

export function buildSmf(song: SmfSong): Uint8Array {
  const microsecPerQuarter = Math.round(60_000_000 / song.tempoBpm)
  const denomPow2 = Math.round(Math.log2(song.timeSignature.denominator))
  const conductor: AbsEvent[] = [
    { tick: 0, order: 0, data: metaEvent(0x03, textBytes(song.name)) },
    { tick: 0, order: 0, data: metaEvent(0x58, [song.timeSignature.numerator, denomPow2, 0x18, 0x08]) },
    {
      tick: 0,
      order: 0,
      data: metaEvent(0x51, [
        (microsecPerQuarter >>> 16) & 0xff,
        (microsecPerQuarter >>> 8) & 0xff,
        microsecPerQuarter & 0xff,
      ]),
    },
    ...song.markers.map((m) => ({ tick: m.tick, order: 0, data: metaEvent(0x06, textBytes(m.text)) })),
  ]

  const instrumentTracks = song.tracks.map((track) => {
    const events: AbsEvent[] = [
      { tick: 0, order: 0, data: metaEvent(0x03, textBytes(track.name)) },
      ...(track.textEvents ?? []).map((m) => ({ tick: m.tick, order: 0, data: metaEvent(0x01, textBytes(m.text)) })),
    ]
    for (const n of track.notes) {
      events.push({ tick: n.start, order: 2, data: [0x90 | (n.channel & 0x0f), n.pitch & 0x7f, n.velocity & 0x7f] })
      events.push({ tick: n.start + n.duration, order: 1, data: [0x80 | (n.channel & 0x0f), n.pitch & 0x7f, 0x40] })
    }
    return buildTrack(events)
  })

  const header = [
    ...textBytes("MThd"),
    ...uint32(6),
    ...uint16(1),
    ...uint16(1 + song.tracks.length),
    ...uint16(TICKS_PER_QUARTER),
  ]

  return new Uint8Array([...header, ...buildTrack(conductor), ...instrumentTracks.flat()])
}
