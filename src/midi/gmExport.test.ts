import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import { DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"
import { exportMelodyMidi } from "./exportMelody"

/** 最小限の SMF 読み取り: トラックごとの名前・プログラムチェンジ・ノートオンのチャンネル */
function readTracks(bytes: Uint8Array) {
  const tracks: Array<{ name: string; programs: Array<[number, number]>; noteChannels: Set<number> }> = []
  let offset = 14
  while (offset < bytes.length) {
    const length = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7]
    let index = offset + 8
    const end = index + length
    const track = { name: "", programs: [] as Array<[number, number]>, noteChannels: new Set<number>() }
    let status = 0
    while (index < end) {
      while (bytes[index] & 0x80) index += 1
      index += 1
      if (bytes[index] & 0x80) status = bytes[index++]
      if (status === 0xff) {
        const type = bytes[index++]
        const size = bytes[index++]
        if (type === 0x03) track.name = new TextDecoder().decode(bytes.slice(index, index + size))
        index += size
      } else if ((status & 0xf0) === 0xc0) {
        track.programs.push([status & 0x0f, bytes[index++]])
      } else {
        if ((status & 0xf0) === 0x90) track.noteChannels.add(status & 0x0f)
        index += 2
      }
    }
    tracks.push(track)
    offset = end
  }
  return tracks.slice(1)
}

const base = {
  title: "t",
  sectionName: "A",
  tempo: 96,
  timeSignature: "4/4",
  chords: parseChordInputText("C | G", "s", 4, "c"),
  melodyNotes: [{ id: "m", startBeat: 0, durationBeats: 1, pitch: 72, velocity: 90, locks: [] }],
  reactiveNotes: [{ id: "r", startBeat: 1, durationBeats: 1, pitch: 64, velocity: 80, locks: [] }],
  includeChords: true,
}

describe("MIDI書き出しの形式", () => {
  it("Logic向け(既定)は、全トラックをチャンネル1で書き、楽器を指定しない", () => {
    const tracks = readTracks(exportMelodyMidi(base))
    expect(tracks.map((track) => track.name)).toEqual(["Chords", "Active Melody", "Counter Melody"])
    for (const track of tracks) {
      expect(track.programs).toEqual([])
      expect([...track.noteChannels]).toEqual([0])
    }
  })

  it("GM向けは、パートごとにチャンネルと楽器番号を入れる", () => {
    const programs = { ...DEFAULT_PART_PROGRAMS, melody: 73, decoration: 12 }
    const tracks = readTracks(exportMelodyMidi({ ...base, gmPrograms: programs, leadPart: "phrase", reactivePart: "decoration" }))
    expect(tracks.map((track) => track.programs)).toEqual([
      [[0, programs.chords]],
      [[1, programs.phrase]],
      [[2, 12]],
    ])
    expect(tracks.map((track) => [...track.noteChannels])).toEqual([[0], [1], [2]])
  })
})
