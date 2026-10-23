import { describe, expect, it } from "vitest"
import { buildSmf, type SmfTrack } from "./smf"
import { GmChannelCapacityError, withGmSounds, type SoundedTrack } from "./gmExport"
import { DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"

const note = (pitch: number, start: number, duration: number) => ({ pitch, start, duration, velocity: 90, channel: 0 })
const entry = (index: number, program: number, notes: SmfTrack["notes"]): SoundedTrack => ({
  sound: program,
  track: { name: `Track ${index}`, notes },
})

interface ReadEvent {
  tick: number
  trackIndex: number
  index: number
  kind: "program" | "on" | "off"
  channel: number
  value: number
}

function readEvents(bytes: Uint8Array): { names: string[]; events: ReadEvent[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names: string[] = []
  const events: ReadEvent[] = []
  let offset = 14, trackIndex = -1
  while (offset < bytes.length) {
    const end = offset + 8 + view.getUint32(offset + 4)
    let position = offset + 8, tick = 0, runningStatus = 0, eventIndex = 0, name = ""
    const vlq = () => {
      let value = 0, byte = 0
      do { byte = bytes[position++]; value = value * 128 + (byte & 0x7f) } while (byte & 0x80)
      return value
    }
    while (position < end) {
      tick += vlq()
      if (bytes[position] & 0x80) runningStatus = bytes[position++]
      if (runningStatus === 0xff) {
        const type = bytes[position++], length = vlq()
        if (type === 0x03) name = new TextDecoder().decode(bytes.slice(position, position + length))
        position += length
      } else if (runningStatus === 0xf0 || runningStatus === 0xf7) {
        const length = vlq(); position += length
      } else {
        const command = runningStatus & 0xf0, channel = runningStatus & 0x0f, first = bytes[position++]
        if (command === 0xc0) events.push({ tick, trackIndex, index: eventIndex++, kind: "program", channel, value: first })
        else if (command === 0xd0) eventIndex += 1
        else {
          const second = bytes[position++]
          if (command === 0x90 && second > 0) events.push({ tick, trackIndex, index: eventIndex++, kind: "on", channel, value: first })
          else if (command === 0x80 || command === 0x90) events.push({ tick, trackIndex, index: eventIndex++, kind: "off", channel, value: first })
          else eventIndex += 1
        }
      }
    }
    if (trackIndex >= 0) names[trackIndex] = name
    trackIndex += 1
    offset = end
  }
  return { names, events: events.sort((a, b) => a.tick - b.tick || a.trackIndex - b.trackIndex || a.index - b.index) }
}

function assertNoSamePitchNoteOffCollision(tracks: SmfTrack[]) {
  const notes = tracks.flatMap((track, trackIndex) => track.notes.map((value) => ({ ...value, trackIndex })))
  for (let i = 0; i < notes.length; i += 1) for (let j = i + 1; j < notes.length; j += 1) {
    const a = notes[i], b = notes[j]
    if (a.channel !== b.channel || a.pitch !== b.pitch) continue
    const aEnd = a.start + a.duration, bEnd = b.start + b.duration
    const strictlySeparate = aEnd < b.start || bEnd < a.start
    const orderedInOneTrack = a.trackIndex === b.trackIndex && (aEnd === b.start || bEnd === a.start)
    expect(strictlySeparate || orderedInOneTrack).toBe(true)
  }
}

describe("GMチャンネルの安全な共有と時間再利用", () => {
  it("15トラック以下の既存割り当ては変更しない", () => {
    const entries = Array.from({ length: 15 }, (_, index) => entry(index, index, [note(60 + index, 0, 20)]))
    const assigned = withGmSounds(entries, DEFAULT_PART_PROGRAMS)
    expect(assigned.map((track) => track.channel)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15])
    expect(assigned.map((track) => track.program)).toEqual(Array.from({ length: 15 }, (_, index) => index))
    expect(assigned.every((track) => track.programChanges == null)).toBe(true)
  })

  it("同じprogramは共有するが、重なる同音高は別チャンネルに分ける", () => {
    const entries = Array.from({ length: 16 }, (_, index) =>
      entry(index, 40, [note(index < 2 ? 60 : 61 + index, 0, 40)]))
    const assigned = withGmSounds(entries, DEFAULT_PART_PROGRAMS)
    expect(assigned[0].notes[0].channel).not.toBe(assigned[1].notes[0].channel)
    expect(new Set(assigned.flatMap((track) => track.notes.map((value) => value.channel))).size).toBe(2)
    assertNoSamePitchNoteOffCollision(assigned)
  })

  it("持続音には触れず、完全な無音区間だけ別programへ再利用する", () => {
    const entries = [
      entry(0, 0, [note(60, 0, 100)]),
      ...Array.from({ length: 14 }, (_, index) => entry(index + 1, index + 1, [note(62 + index, 200, 20)])),
      entry(15, 15, [note(84, 50, 20), note(85, 120, 20)]),
    ]
    const assigned = withGmSounds(entries, DEFAULT_PART_PROGRAMS)
    const sustainedChannel = assigned[0].notes[0].channel
    const duringSustain = assigned[15].notes.find((value) => value.start === 50)
    expect(duringSustain?.channel).not.toBe(sustainedChannel)
    const changesDuringSustain = assigned.flatMap((track) => track.programChanges ?? [])
      .filter((change) => change.channel === sustainedChannel && change.tick > 0 && change.tick <= 100)
    expect(changesDuringSustain).toEqual([])
  })

  it("同programの別トラックが後から加わっても持続中に同値ProgramChangeを再送しない", () => {
    const entries = [
      entry(0, 48, [note(60, 0, 100)]),
      entry(1, 48, [note(64, 20, 20)]),
      ...Array.from({ length: 14 }, (_, index) => entry(index + 2, index, [note(70 + index, 200, 20)])),
    ]
    const assigned = withGmSounds(entries, DEFAULT_PART_PROGRAMS)
    const sharedChannel = assigned[0].notes[0].channel
    expect(assigned[1].notes[0].channel).toBe(sharedChannel)
    expect(assigned.flatMap((track) => track.programChanges ?? [])
      .filter((change) => change.channel === sharedChannel && change.tick > 0 && change.tick < 100)).toEqual([])
  })

  it("別トラックの同tick終了と開始は順序未定として同じチャンネルへ詰めない", () => {
    const entries = [
      entry(0, 0, [note(60, 0, 10)]),
      ...Array.from({ length: 14 }, (_, index) => entry(index + 1, index + 1, [note(62 + index, 100, 10)])),
      entry(15, 15, [note(84, 10, 10)]),
    ]
    const assigned = withGmSounds(entries, DEFAULT_PART_PROGRAMS)
    expect(assigned[15].notes[0].channel).not.toBe(assigned[0].notes[0].channel)
  })

  it("真に同時に16チャンネル必要なら音色を統合せず明示的に失敗する", () => {
    const entries = Array.from({ length: 16 }, (_, index) => entry(index, index, [note(60 + index, 0, 40)]))
    expect(() => withGmSounds(entries, DEFAULT_PART_PROGRAMS)).toThrow(GmChannelCapacityError)
  })

  it("最終SMFでも各NoteOn直前のProgramChangeとノート内容を保持する", () => {
    const entries = Array.from({ length: 16 }, (_, index) =>
      entry(index, index, [note(60 + index, index * 20, 10)]))
    const assigned = withGmSounds(entries, DEFAULT_PART_PROGRAMS)
    const bytes = buildSmf({
      name: "GM reuse",
      tempoBpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      markers: [],
      tracks: assigned,
    })
    expect(bytes.length).toBeGreaterThan(0)
    expect(assigned[15].notes[0].channel).toBe(assigned[0].notes[0].channel)
    expect(assigned.flatMap((track) => track.notes).map(({ pitch, start, duration, velocity }) =>
      ({ pitch, start, duration, velocity }))).toEqual(entries.flatMap(({ track }) => track.notes).map(({ pitch, start, duration, velocity }) =>
      ({ pitch, start, duration, velocity })))
    for (let index = 0; index < assigned.length; index += 1) {
      const value = assigned[index].notes[0]
      expect(assigned[index].programChanges).toContainEqual({ tick: value.start, channel: value.channel, program: index })
    }
    const read = readEvents(bytes)
    const programs = new Map<number, number>()
    const active = new Set<string>()
    let noteOns = 0
    for (const event of read.events) {
      if (event.kind === "program") programs.set(event.channel, event.value)
      else if (event.kind === "on") {
        const expected = Number(read.names[event.trackIndex].replace("Track ", ""))
        expect(programs.get(event.channel)).toBe(expected)
        const key = `${event.channel}:${event.value}`
        expect(active.has(key)).toBe(false)
        active.add(key); noteOns += 1
      } else {
        const key = `${event.channel}:${event.value}`
        expect(active.has(key)).toBe(true)
        active.delete(key)
      }
    }
    expect(noteOns).toBe(16)
    expect(active.size).toBe(0)
  })
})
