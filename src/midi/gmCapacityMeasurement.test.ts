import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { afterEach, expect, it, vi } from "vitest"
import { arrangementInstrument, DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"
import type { ComposerProject } from "@/core/project"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { exportSongMidi } from "./exportMelody"

type MidiEvent = {
  tick: number
  trackIndex: number
  index: number
  kind: "program" | "on" | "off"
  channel: number
  value: number
}

function readMidi(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names: string[] = []
  const events: MidiEvent[] = []
  let offset = 14, trackIndex = -1
  while (offset < bytes.length) {
    const end = offset + 8 + view.getUint32(offset + 4)
    let position = offset + 8, tick = 0, runningStatus = 0, index = 0, name = ""
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
        if (command === 0xc0) events.push({ tick, trackIndex, index: index++, kind: "program", channel, value: first })
        else if (command === 0xd0) index += 1
        else {
          const second = bytes[position++]
          if (command === 0x90 && second > 0) events.push({ tick, trackIndex, index: index++, kind: "on", channel, value: first })
          else if (command === 0x80 || command === 0x90) events.push({ tick, trackIndex, index: index++, kind: "off", channel, value: first })
          else index += 1
        }
      }
    }
    if (trackIndex >= 0) names[trackIndex] = name
    trackIndex += 1
    offset = end
  }
  events.sort((a, b) => a.tick - b.tick || a.trackIndex - b.trackIndex || a.index - b.index)
  return { names, events }
}

function addSyntheticLead(project: ComposerProject) {
  for (const section of project.sections) {
    const id = `lead:${section.id}`
    project.melodyVariants.push({
      id, name: "Synthetic lead", sectionId: section.id, sourceMode: "generate",
      notes: Array.from({ length: section.lengthBars }, (_, bar) => [0, .5, 1].map((beat, index) => ({
        id: `${id}:${bar}:${index}`, pitch: [72, 74, 76][index], startBeat: bar * 4 + beat,
        durationBeats: .4, velocity: 80, locks: [],
      }))).flat(),
      phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "fixture",
      seed: 1, songProfile: "original-custom", parentMelodyId: null, batchId: "fixture", createdAt: "2026-10-21T00:00:00Z",
    })
    project.sectionMelodyAssignments[section.id] = id
  }
}

function expectedPrograms(project: ComposerProject) {
  const result = new Map<string, number>([
    ["Chords", DEFAULT_PART_PROGRAMS.chords],
    ["Active Melodies", DEFAULT_PART_PROGRAMS.melody],
    ["Accompaniment", DEFAULT_PART_PROGRAMS.accompaniment],
    ["Accompaniment Pattern", DEFAULT_PART_PROGRAMS.accompaniment],
    ["Selected Counter Melody", DEFAULT_PART_PROGRAMS.counter],
    ["Selected Decoration", DEFAULT_PART_PROGRAMS.decoration],
    ["Selected Phrases", DEFAULT_PART_PROGRAMS.phrase],
    ["Selected Intro Phrases", DEFAULT_PART_PROGRAMS.signature],
  ])
  for (const track of project.fullSongArrangement?.tracks ?? []) {
    const sound = arrangementInstrument(track)
    if (sound !== "drums") result.set(track.name, sound)
  }
  return result
}

function inspectFinalMidi(project: ComposerProject, bytes: Uint8Array) {
  const { names, events } = readMidi(bytes)
  const expected = expectedPrograms(project)
  const programs = new Map<number, number>()
  const active = new Map<string, { channel: number; program: number }>()
  const distinct = new Set<number>()
  let peakChannels = 0, peakPrograms = 0, peakTick = 0, noteOns = 0
  for (const event of events) {
    if (event.channel === 9) continue
    if (event.kind === "program") {
      const activeOnChannel = [...active.values()].filter((note) => note.channel === event.channel)
      if (activeOnChannel.length) expect(activeOnChannel.every((note) => note.program === event.value)).toBe(true)
      programs.set(event.channel, event.value)
      continue
    }
    const key = `${event.channel}:${event.value}`
    if (event.kind === "on") {
      const program = programs.get(event.channel)
      const expectedProgram = expected.get(names[event.trackIndex])
      expect(expectedProgram, `missing expected program for ${names[event.trackIndex]}`).toBeDefined()
      expect(program, `${names[event.trackIndex]} at tick ${event.tick}`).toBe(expectedProgram)
      expect(active.has(key), `overlapping NoteOn ${key} at tick ${event.tick}`).toBe(false)
      active.set(key, { channel: event.channel, program: program! })
      distinct.add(program!); noteOns += 1
      const channelCount = new Set([...active.values()].map((note) => note.channel)).size
      const programCount = new Set([...active.values()].map((note) => note.program)).size
      if (channelCount > peakChannels) { peakChannels = channelCount; peakTick = event.tick }
      peakPrograms = Math.max(peakPrograms, programCount)
    } else {
      expect(active.has(key), `unmatched NoteOff ${key} at tick ${event.tick}`).toBe(true)
      active.delete(key)
    }
  }
  expect(active.size).toBe(0)
  return { distinctPrograms: distinct.size, peakChannels, peakPrograms, peakBeat: peakTick / 480, noteOns }
}

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

afterEach(() => vi.restoreAllMocks())

it("reproduces full-song GM capacity with fixed IDs and validates the sounding program of every note", () => {
  const outputPath = process.env.GM_CAPACITY_PATH
  // 24生成相当の測定は通常CIと並列に走らせず、明示したレビュー実行で記録する。
  if (!outputPath) {
    expect(outputPath).toBeUndefined()
    return
  }
  let uuidIndex = 0
  vi.spyOn(crypto, "randomUUID").mockImplementation(() =>
    `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, "0")}`)
  const measurements = []
  for (const style of ["neoclassical", "electronica"] as const) for (const withLead of [false, true]) for (const seed of [19, 41, 73]) {
    uuidIndex = 0
    const project = arrangementReviewSong(style === "neoclassical" ? "A" : "B")
    project.song.genreBlend = [{ id: style, weight: 1 }]
    project.song.tempo = style === "neoclassical" ? 84 : 132
    if (withLead) addSyntheticLead(project)
    const inputJson = JSON.stringify(project)
    const unchanged = structuredClone(project)
    const arrangement = generateFullSongArrangement(project, { seed })
    expect(project).toEqual(unchanged)
    expect(arrangement.quality?.passed).toBe(true)
    expect(arrangement.audition?.passed).toBe(true)
    project.fullSongArrangement = arrangement
    const bytes = exportSongMidi(project, true, true, DEFAULT_PART_PROGRAMS)
    measurements.push({
      style, withLead, seed, inputSha256: hash(inputJson), midiSha256: hash(bytes),
      ...inspectFinalMidi(project, bytes),
    })
  }
  expect(measurements).toHaveLength(12)
  expect(measurements.every((result) => result.peakChannels <= 15)).toBe(true)
  writeFileSync(outputPath, JSON.stringify(measurements, null, 2))
}, 120_000)
