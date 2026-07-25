import { describe, expect, it } from "vitest"
import { exportMelodyMidi, exportSongMidi } from "./exportMelody"
import { TICKS_PER_QUARTER } from "./smf"
import type { ChordEvent, ComposerProject } from "@/core/project"
import { createEmptyProject, normalizeProject } from "@/core/project"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { ResolvedLeadContent, SectionLayer } from "@/core/sectionContent"
import { partRoleFor } from "@/core/sectionContent"
import { fallbackPlanFor, layersOf, notesByPartRole } from "@/core/sectionLayers"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

const CHORDS: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 8, symbol: "Am", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 8, durationBeats: 8, symbol: "F", bass: null },
]

function note(startBeat: number, durationBeats: number, pitch: number): MelodyNote {
  return { id: `n${startBeat}-${pitch}`, startBeat, durationBeats, pitch, velocity: 80, locks: [] }
}

function layer(content: ResolvedLeadContent, notes: MelodyNote[], kind: "primary" | "pickup" = "primary"): SectionLayer {
  return {
    id: `l-${content}-${kind}`,
    partRole: kind === "pickup" ? "lead" : partRoleFor(content),
    content,
    plan: fallbackPlanFor(content, notes),
    notes,
    kind,
  }
}

function variant(patch: Partial<MelodyVariant> = {}): MelodyVariant {
  return {
    id: "v1",
    name: "test",
    sectionId: "s1",
    sourceMode: "generate",
    notes: [],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "2.1",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "b1",
    createdAt: new Date().toISOString(),
    ...patch,
  }
}

interface ParsedNoteEvent {
  tick: number
  pitch: number
  velocity: number
  channel: number
  on: boolean
}

interface ParsedTrack {
  name: string
  events: ParsedNoteEvent[]
}

/**
 * 生成したSMFを実際にパースして検証する。
 * バイト列を素朴に走査すると、デルタタイムやメタイベントのペイロードが
 * 偶然 0x9n に一致して誤検出するため、チャンクとイベントを正しく辿る。
 */
function parseSmf(bytes: Uint8Array): { trackCount: number; tracks: ParsedTrack[] } {
  const text = (from: number, length: number) => new TextDecoder().decode(bytes.slice(from, from + length))
  expect(text(0, 4)).toBe("MThd")
  const declaredTrackCount = (bytes[10] << 8) | bytes[11]

  const tracks: ParsedTrack[] = []
  let cursor = 14 // header: "MThd" + length(4) + 6 bytes
  while (cursor < bytes.length) {
    expect(text(cursor, 4)).toBe("MTrk")
    const length = (bytes[cursor + 4] << 24) | (bytes[cursor + 5] << 16) | (bytes[cursor + 6] << 8) | bytes[cursor + 7]
    const bodyStart = cursor + 8
    const bodyEnd = bodyStart + length
    tracks.push(parseTrackBody(bytes, bodyStart, bodyEnd))
    cursor = bodyEnd
  }
  return { trackCount: declaredTrackCount, tracks }
}

function parseTrackBody(bytes: Uint8Array, start: number, end: number): ParsedTrack {
  let position = start
  let tick = 0
  let name = ""
  const events: ParsedNoteEvent[] = []

  const readVlq = () => {
    let value = 0
    for (;;) {
      const byte = bytes[position++]
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
  }

  while (position < end) {
    tick += readVlq()
    const status = bytes[position++]
    if (status === 0xff) {
      const type = bytes[position++]
      const length = readVlq()
      if (type === 0x03) name = new TextDecoder().decode(bytes.slice(position, position + length))
      position += length
      continue
    }
    const kind = status & 0xf0
    if (kind === 0x90 || kind === 0x80) {
      const pitch = bytes[position++]
      const velocity = bytes[position++]
      events.push({ tick, pitch, velocity, channel: status & 0x0f, on: kind === 0x90 && velocity > 0 })
      continue
    }
    throw new Error(`unexpected status byte 0x${status.toString(16)} at ${position - 1}`)
  }
  return { name, events }
}

function trackCount(bytes: Uint8Array): number {
  return parseSmf(bytes).trackCount
}

function trackNames(bytes: Uint8Array): string[] {
  return parseSmf(bytes).tracks.map((track) => track.name)
}

/** Note On のチャンネル集合 */
function noteOnChannels(bytes: Uint8Array): Set<number> {
  const channels = new Set<number>()
  for (const track of parseSmf(bytes).tracks) {
    for (const event of track.events) if (event.on) channels.add(event.channel)
  }
  return channels
}

/** 指定トラックのNote On/Offから、音の開始tickと長さを復元する */
function notesOfTrack(bytes: Uint8Array, trackName: string): { start: number; duration: number; pitch: number }[] {
  const track = parseSmf(bytes).tracks.find((t) => t.name === trackName)
  if (!track) return []
  const notes: { start: number; duration: number; pitch: number }[] = []
  const pending = new Map<number, number>()
  for (const event of track.events) {
    if (event.on) pending.set(event.pitch, event.tick)
    else {
      const start = pending.get(event.pitch)
      if (start === undefined) continue
      pending.delete(event.pitch)
      notes.push({ start, duration: event.tick - start, pitch: event.pitch })
    }
  }
  return notes.sort((a, b) => a.start - b.start)
}

describe("Issue #41 / partRoleがMIDIのトラックへ反映される", () => {
  it("Drone(伴奏パート)は Melody とは別トラック・別チャンネルへ書き出される", () => {
    const droneNotes = [note(0, 8, 57), note(8, 8, 57)]
    const bytes = exportMelodyMidi({
      title: "t",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      chords: CHORDS,
      melody: variant({ leadContent: "drone", notes: droneNotes, layers: [layer("drone", droneNotes)] }),
      includeChords: false,
    })

    expect(trackNames(bytes)).toContain("Accompaniment")
    // 伴奏はチャンネル2、リードのチャンネル0は使われない
    expect(noteOnChannels(bytes)).toEqual(new Set([2]))
  })

  it("Motif(リードパート)は Melody トラックのみへ書き出される", () => {
    const motifNotes = [note(0, 1, 69), note(1, 1, 72)]
    const bytes = exportMelodyMidi({
      title: "t",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      chords: CHORDS,
      melody: variant({ leadContent: "motif", notes: motifNotes, layers: [layer("motif", motifNotes)] }),
      includeChords: false,
    })

    expect(trackNames(bytes)).not.toContain("Accompaniment")
    expect(noteOnChannels(bytes)).toEqual(new Set([0]))
  })

  it("Chords Only(リード0音)でもエラーにならず、コードだけが書き出される", () => {
    const bytes = exportMelodyMidi({
      title: "t",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      chords: CHORDS,
      melody: variant({ leadContent: "none", notes: [], layers: [layer("none", [])] }),
      includeChords: true,
    })

    expect(bytes.byteLength).toBeGreaterThan(0)
    // コードトラックのチャンネル1のみが鳴る
    expect(noteOnChannels(bytes)).toEqual(new Set([1]))
  })

  it("Silence(リード0音・伴奏なし)でも空のMIDIを書き出せる", () => {
    const bytes = exportMelodyMidi({
      title: "t",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      chords: CHORDS,
      melody: variant({ leadContent: "none", notes: [], layers: [layer("none", [])] }),
      includeChords: false,
    })

    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(noteOnChannels(bytes).size).toBe(0)
    // conductor + melody の2トラック(Accompanimentは0音なので作らない)
    expect(trackCount(bytes)).toBe(2)
  })

  it("開始拍・持続音・無音区間がMIDIのtickへそのまま保たれる", () => {
    // 前半8拍は無音(entryOffset相当) → 8拍の保持音1つ → コード境界(8拍)をまたぐ
    const droneNotes = [note(8, 8, 57)]
    const bytes = exportMelodyMidi({
      title: "t",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      chords: CHORDS,
      melody: variant({ leadContent: "drone", notes: droneNotes, layers: [layer("drone", droneNotes)] }),
      includeChords: false,
    })

    const exported = notesOfTrack(bytes, "Accompaniment")
    expect(exported).toEqual([{ start: 8 * TICKS_PER_QUARTER, duration: 8 * TICKS_PER_QUARTER, pitch: 57 }])
    // 8拍ぶんの無音が保たれている(最初の音が0tickではない)
    expect(exported[0].start).toBe(3840)
  })

  it("Droneの保持音がコード境界で分割されずに1音として書き出される", () => {
    // 16拍の保持音1つ。コード境界は8拍にあるが、2音に割られてはいけない
    const droneNotes = [note(0, 16, 57)]
    const bytes = exportMelodyMidi({
      title: "t",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      chords: CHORDS,
      melody: variant({ leadContent: "drone", notes: droneNotes, layers: [layer("drone", droneNotes)] }),
      includeChords: false,
    })

    const exported = notesOfTrack(bytes, "Accompaniment")
    expect(exported).toHaveLength(1)
    expect(exported[0].duration).toBe(16 * TICKS_PER_QUARTER)
  })

  it("pickup Layerはリードとして Melody トラックへ入る", () => {
    const pickupNotes = [note(15, 1, 71)]
    const bytes = exportMelodyMidi({
      title: "t",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      chords: CHORDS,
      melody: variant({
        leadContent: "none",
        notes: pickupNotes,
        layers: [layer("none", []), layer("none", pickupNotes, "pickup")],
      }),
      includeChords: false,
    })

    expect(notesOfTrack(bytes, "Active Melody")).toEqual([
      { start: 15 * TICKS_PER_QUARTER, duration: TICKS_PER_QUARTER, pitch: 71 },
    ])
    expect(trackNames(bytes)).not.toContain("Accompaniment")
  })

  it("曲全体の書き出しでも lead / accompaniment がトラック分割される", () => {
    const leadNotes = [note(0, 1, 69)]
    const accompanimentNotes = [note(0, 4, 45)]
    const project: ComposerProject = {
      ...createEmptyProject("song"),
      sections: [
        { id: "s1", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
        { id: "s2", name: "A", role: "verse", startBar: 5, lengthBars: 4 },
      ],
      chords: CHORDS,
      melodyVariants: [
        variant({
          id: "v-drone",
          sectionId: "s1",
          leadContent: "drone",
          notes: accompanimentNotes,
          layers: [layer("drone", accompanimentNotes)],
        }),
        variant({
          id: "v-melody",
          sectionId: "s2",
          leadContent: "melody",
          notes: leadNotes,
          layers: [layer("melody", leadNotes)],
        }),
      ],
      sectionMelodyAssignments: { s1: "v-drone", s2: "v-melody" },
    }

    const material = buildSongPlaybackMaterial(project)
    expect(material.accompaniment).toHaveLength(1)
    expect(material.lead).toHaveLength(1)
    // 再生用の melody は両方を含む
    expect(material.melody).toHaveLength(2)
    // s2 は5小節目開始なので16拍オフセット
    expect(material.lead[0].startBeat).toBe(16)

    const bytes = exportSongMidi(project, false)
    expect(trackNames(bytes)).toContain("Accompaniment")
    expect(noteOnChannels(bytes)).toEqual(new Set([0, 2]))
  })
})

describe("Issue #41 / 旧Projectの移行と既定値補完", () => {
  it("content未保存のセクションへ lead/accompaniment/entryOffset/pickup が補完される", () => {
    const migrated = normalizeProject({
      schemaVersion: "1.3",
      sections: [{ id: "s1", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 }],
    })
    expect(migrated.sections[0].content).toEqual({
      lead: "melody",
      accompaniment: "chords",
      entryOffsetBeats: 0,
      pickup: false,
    })
    // 既定が従来の挙動と同じなので、既存プロジェクトの生成結果は変わらない
    expect(migrated.schemaVersion).toBe("1.4")
  })

  it("layers未保存の旧候補へ、notesを単一leadレイヤーとしたlayersが補完される", () => {
    const legacyNotes = [note(0, 1, 60), note(1, 1, 62)]
    const migrated = normalizeProject({
      schemaVersion: "1.3",
      sections: [],
      melodyVariants: [variant({ notes: legacyNotes })],
    })
    const [restored] = migrated.melodyVariants
    expect(restored.leadContent).toBe("melody")
    expect(restored.layers).toHaveLength(1)
    expect(restored.layers![0].partRole).toBe("lead")
    expect(restored.layers![0].notes).toEqual(legacyNotes)
    // 旧候補もLayer経路で読める
    expect(notesByPartRole(restored, "lead")).toHaveLength(2)
    expect(notesByPartRole(restored, "accompaniment")).toHaveLength(0)
  })

  it("破損したentryOffset(負値・非数値)は0へ落とす", () => {
    const migrated = normalizeProject({
      schemaVersion: "1.3",
      sections: [
        { id: "a", name: "A", role: "intro", startBar: 1, lengthBars: 4, content: { entryOffsetBeats: -5 } },
        { id: "b", name: "B", role: "intro", startBar: 5, lengthBars: 4, content: { entryOffsetBeats: "x" } },
      ],
    } as unknown)
    expect(migrated.sections[0].content!.entryOffsetBeats).toBe(0)
    expect(migrated.sections[1].content!.entryOffsetBeats).toBe(0)
  })

  it("2軸の組み合わせが保存・復元される", () => {
    const combinations = [
      { lead: "drone", accompaniment: "none" },
      { lead: "none", accompaniment: "chords" },
      { lead: "motif", accompaniment: "chords" },
      { lead: "auto", accompaniment: "chords" },
    ] as const

    for (const combination of combinations) {
      const migrated = normalizeProject({
        schemaVersion: "1.4",
        sections: [
          {
            id: "s1",
            name: "Intro",
            role: "intro",
            startBar: 1,
            lengthBars: 4,
            content: { ...combination, entryOffsetBeats: 4, pickup: true },
          },
        ],
      })
      expect(migrated.sections[0].content).toEqual({ ...combination, entryOffsetBeats: 4, pickup: true })
    }
  })

  it("layersを持つ候補は再正規化で書き換えられない", () => {
    const droneNotes = [note(0, 8, 57)]
    const original = variant({ leadContent: "drone", notes: droneNotes, layers: [layer("drone", droneNotes)] })
    const migrated = normalizeProject({ schemaVersion: "1.4", sections: [], melodyVariants: [original] })
    expect(migrated.melodyVariants[0].layers).toEqual(original.layers)
    expect(layersOf(migrated.melodyVariants[0])[0].partRole).toBe("accompaniment")
  })
})
