import { writeFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComposerProject } from "@/core/project"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import { arrangementInstrument, DEFAULT_PART_PROGRAMS, type SoundSettings } from "@/core/gmInstruments"
import { generateFullSongArrangement, regenerateFullSongArrangementTarget } from "@/melody-engine/arrangementGenerator"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { arrangementSoundedTracks } from "./exportArrangement"
import { exportSongMidi } from "./exportMelody"
import { GmChannelCapacityError, withGmSounds, type SoundedTrack } from "./gmExport"
import { logicSoundRows } from "./logicProductionPackage"
import { buildSmf, type SmfTrack } from "./smf"

// PR #201 (head 4f4b4de6) の独立再レビュー用テスト。Claude Code。実装ブランチとは別ブランチ。
// 実装側の読み取り処理は使わず、SMFを別実装で読み直す。同tickの別トラックの並びは保証されないため、
// トラック昇順・降順の両方で再生を模擬し、どちらでも楽器と持続音が守られることを確かめる。

interface MidiEvent {
  tick: number
  trackIndex: number
  index: number
  kind: "program" | "on" | "off"
  channel: number
  value: number
}

function parseSmf(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names: string[] = []
  const events: MidiEvent[] = []
  let offset = 14, trackIndex = -1
  while (offset < bytes.length) {
    const end = offset + 8 + view.getUint32(offset + 4)
    let position = offset + 8, tick = 0, status = 0, index = 0, name = ""
    const vlq = () => {
      let value = 0, byte = 0
      do { byte = bytes[position++]; value = value * 128 + (byte & 0x7f) } while (byte & 0x80)
      return value
    }
    while (position < end) {
      tick += vlq()
      if (bytes[position] & 0x80) status = bytes[position++]
      if (status === 0xff) {
        const type = bytes[position++], length = vlq()
        if (type === 0x03) name = new TextDecoder().decode(bytes.slice(position, position + length))
        position += length
      } else if (status === 0xf0 || status === 0xf7) {
        position += vlq()
      } else {
        const command = status & 0xf0, channel = status & 0x0f, first = bytes[position++]
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
  return { names, events }
}

interface Violation { order: "asc" | "desc"; tick: number; track: string; message: string }

/** 同tickの別トラックの並びを昇順・降順の両方にして再生を模擬し、楽器の取り違えと持続音の変化・同音の重なりを数える */
function simulate(bytes: Uint8Array, expectedByTrack: ReadonlyMap<string, number>) {
  const { names, events } = parseSmf(bytes)
  const violations: Violation[] = []
  let noteOns = 0
  let peakChannels = 0, peakPrograms = 0
  for (const order of ["asc", "desc"] as const) {
    const sorted = [...events].sort((a, b) =>
      a.tick - b.tick || (order === "asc" ? a.trackIndex - b.trackIndex : b.trackIndex - a.trackIndex) || a.index - b.index)
    const program = new Map<number, number>()
    const sounding = new Map<string, { channel: number; program: number }>()
    for (const event of sorted) {
      if (event.channel === 9) continue
      const track = names[event.trackIndex] ?? `#${event.trackIndex}`
      const key = `${event.channel}:${event.value}`
      if (event.kind === "program") {
        for (const [, note] of sounding) {
          if (note.channel === event.channel && note.program !== event.value) {
            violations.push({ order, tick: event.tick, track, message: `持続音の最中にプログラムが ${note.program} → ${event.value} へ変わる` })
            break
          }
        }
        program.set(event.channel, event.value)
      } else if (event.kind === "on") {
        if (order === "asc") noteOns += 1
        const expected = expectedByTrack.get(track)
        const actual = program.get(event.channel)
        if (expected === undefined) violations.push({ order, tick: event.tick, track, message: "期待する楽器が不明なトラック" })
        else if (actual !== expected) violations.push({ order, tick: event.tick, track, message: `発音時の楽器 ${actual} ≠ 期待 ${expected}` })
        if (sounding.has(key)) violations.push({ order, tick: event.tick, track, message: `同じチャンネル・同じ音高の重なり ${key}` })
        sounding.set(key, { channel: event.channel, program: actual ?? -1 })
        peakChannels = Math.max(peakChannels, new Set([...sounding.values()].map((note) => note.channel)).size)
        peakPrograms = Math.max(peakPrograms, new Set([...sounding.values()].map((note) => note.program)).size)
      } else {
        sounding.delete(key)
      }
    }
  }
  return { violations, noteOns, peakChannels, peakPrograms }
}

const note = (pitch: number, start: number, duration: number) => ({ pitch, start, duration, velocity: 90, channel: 0 })
const entry = (name: string, program: number, notes: SmfTrack["notes"]): SoundedTrack => ({ sound: program, track: { name, notes } })

/** 16トラック以上にして、従来の固定割り当てでは1つのチャンネルを共有する状態にする(動的割り当てを通す)。 */
function fillers(count: number, from = 0): SoundedTrack[] {
  // 先頭ではなく別の時間帯(tick 100000 以降)に置くので、検証したい場面と同時には鳴らない
  return Array.from({ length: count }, (_, i) => entry(`Filler ${from + i}`, 100 + ((from + i) % 20), [note(40 + i, 100_000 + i * 10, 20)]))
}

const asc = (result: ReturnType<typeof simulate>) => result.violations.filter((v) => v.order === "asc")
const desc = (result: ReturnType<typeof simulate>) => result.violations.filter((v) => v.order === "desc")

function render(entries: SoundedTrack[]) {
  const expected = new Map(entries.filter((e) => typeof e.sound === "number").map((e) => [e.track.name!, e.sound as number]))
  const bytes = buildSmf({ name: "t", tempoBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, markers: [], tracks: withGmSounds(entries, DEFAULT_PART_PROGRAMS) })
  return simulate(bytes, expected)
}

describe("GM書き出し: チャンネル共有の独立検証(合成ケース)", () => {
  it("同じ楽器・同じ音高が重なる音は別チャンネルへ分かれ、NoteOffが他の音を切らない", () => {
    const entries = [
      entry("A", 0, [note(60, 0, 960)]),
      entry("B", 0, [note(60, 480, 960)]),
      entry("C", 0, [note(60, 960, 480)]),
      ...fillers(15),
    ]
    const result = render(entries)
    expect(asc(result)).toEqual([])
    expect(desc(result)).toEqual([])
    expect(result.peakChannels).toBeGreaterThanOrEqual(2)
  })

  it("別トラックの同じ楽器・同じ音高が同tickで終わって始まる(単純な形)は、トラック順に依らず安全", () => {
    const entries = [
      entry("Chords", 89, [note(64, 0, 480)]),
      entry("Pad", 89, [note(64, 480, 960)]),
      ...fillers(15),
    ]
    const result = render(entries)
    expect(asc(result)).toEqual([])
    expect(desc(result)).toEqual([])
  })

  // 実在の形(最終exportSongMidiの Chords → SYN_DarkPad で 99件)。先行トラックに「同じtickで始まる次の和音」があると、
  // その音を処理する際に、終了が同tickの別トラックの音(Chordsの旧和音)が active から消える(filter が破壊的)。
  // 後から処理される Pad は、同じチャンネル・同じ音高を取り、トラック降順で解釈するプレーヤーでは NoteOff が新しい音を即座に切る。
  it("同tickに先行トラック自身の次の音がある場合も、別トラックの同音高の終了→開始を同じチャンネルにしない", () => {
    const entries = [
      entry("Chords", 89, [note(64, 0, 480), note(60, 480, 480)]),
      entry("Pad", 89, [note(64, 480, 960)]),
      ...fillers(15),
    ]
    const result = render(entries)
    expect(asc(result)).toEqual([])
    expect(desc(result), JSON.stringify(desc(result))).toEqual([])
  })

  it("別の楽器へ切り替えるのは、そのチャンネルが完全に無音のときだけ", () => {
    const entries = [
      entry("A", 0, [note(60, 0, 480)]),
      entry("B", 5, [note(62, 480, 480)]), // Aが終わると同時にBが始まる。Aのチャンネルを使ってはいけない(別トラックの並びは不定)
      entry("C", 7, [note(64, 2000, 480)]), // 完全に無音の後なら使い回してよい
      ...fillers(15),
    ]
    const result = render(entries)
    expect(asc(result)).toEqual([])
    expect(desc(result)).toEqual([])
  })

  it("持続音の最中に、同じチャンネルへ別の楽器のプログラムチェンジが入らない", () => {
    const entries = [
      entry("Long", 48, [note(48, 0, 9600)]),
      ...Array.from({ length: 14 }, (_, i) => entry(`Short ${i}`, 60 + i, [note(70 + i, 480 * i, 240)])),
      entry("Late", 100, [note(30, 4000, 240)]),
      ...fillers(4),
    ]
    const result = render(entries)
    expect(asc(result)).toEqual([])
    expect(desc(result)).toEqual([])
  })

  it("同時に15の別楽器までは通る", () => {
    const entries = Array.from({ length: 15 }, (_, i) => entry(`P${i}`, 10 + i, [note(50 + i, 0, 960)]))
    expect(render(entries).violations).toEqual([])
  })

  it("16の別楽器が同時に鳴ると、動的割り当てが GmChannelCapacityError を投げる(統合も欠落もしない)", () => {
    const entries = Array.from({ length: 16 }, (_, i) => entry(`P${i}`, 10 + i, [note(50 + i, 0, 960)]))
    // 固定割り当てだと15chで1chが衝突するため動的になる
    try {
      withGmSounds(entries, DEFAULT_PART_PROGRAMS)
      throw new Error("例外が出なかった")
    } catch (error) {
      expect(error).toBeInstanceOf(GmChannelCapacityError)
    }
  })

  it("同じ楽器なら、同時に何トラック鳴っても(音高が違えば)1チャンネルで足りる", () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`S${i}`, 48, [note(40 + i, 0, 960)]))
    const result = render(entries)
    expect(asc(result)).toEqual([])
    expect(result.peakChannels).toBe(1)
  })

  // 新しいチャンネルの最初の使用(曲頭など)で、プログラムチェンジは最初の音を処理したトラックにだけ書かれる。
  // 同じtickに同じチャンネルを共有する別トラックの NoteOn が、トラック降順のプレーヤーではプログラムチェンジより先に来る。
  it("同じtickで同じチャンネルを共有する別トラックの NoteOn の前にも、プログラムチェンジが届く(トラック順に依らない)", () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`S${i}`, 48, [note(40 + i, 0, 960)]))
    expect(desc(render(entries))).toEqual([])
  })
})

afterEach(() => vi.restoreAllMocks())

function addLead(project: ComposerProject) {
  for (const section of project.sections) {
    const id = `lead:${section.id}`
    project.melodyVariants.push({
      id, name: "Lead", sectionId: section.id, sourceMode: "generate",
      notes: Array.from({ length: section.lengthBars }, (_, bar) => [0, .5, 1].map((beat, index) => ({
        id: `${id}:${bar}:${index}`, pitch: [72, 74, 76][index], startBeat: bar * 4 + beat,
        durationBeats: .4, velocity: 80, locks: [],
      }))).flat(),
      phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "fixture",
      seed: 1, songProfile: "original-custom", parentMelodyId: null, batchId: "fixture", createdAt: "2026-10-21T00:00:00Z",
    } as ComposerProject["melodyVariants"][number])
    project.sectionMelodyAssignments[section.id] = id
  }
}

function expectedByTrack(arrangement: FullSongArrangement, programs: SoundSettings["programs"]) {
  const result = new Map<string, number>([
    ["Chords", programs.chords], ["Active Melodies", programs.melody],
  ])
  for (const track of arrangement.tracks) {
    const sound = arrangementInstrument(track)
    if (sound !== "drums") result.set(track.name, sound)
  }
  return result
}

function seedUuids() {
  let n = 0
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`)
  return () => { n = 0 }
}

const CUSTOM_PROGRAMS: SoundSettings["programs"] = {
  melody: 105, chords: 106, accompaniment: 107, counter: 108, decoration: 109, phrase: 110, signature: 111,
}

describe("最終 exportSongMidi: 実際の全曲アレンジで、発音時の楽器を別実装で確認する", () => {
  const rows: unknown[] = []
  for (const which of ["A", "B"] as const) for (const withLead of [false, true]) for (const seed of [19, 41, 73]) {
    for (const [label, programs] of [["既定のパート楽器", DEFAULT_PART_PROGRAMS], ["パート楽器をすべて別に変更", CUSTOM_PROGRAMS]] as const) {
      it(`${which} lead=${withLead} seed=${seed} ${label}`, () => {
        const reset = seedUuids()
        reset()
        const project = arrangementReviewSong(which)
        project.song.genreBlend = [{ id: which === "A" ? "neoclassical" : "electronica", weight: 1 }]
        project.song.tempo = which === "A" ? 84 : 132
        if (withLead) addLead(project)
        const arrangement = generateFullSongArrangement(project, { seed })
        project.fullSongArrangement = arrangement
        const bytes = exportSongMidi(project, true, true, programs)
        const result = simulate(bytes, expectedByTrack(arrangement, programs))
        rows.push({ which, withLead, seed, label, noteOns: result.noteOns, peakChannels: result.peakChannels, peakPrograms: result.peakPrograms, ascViolations: asc(result).length, descViolations: desc(result).length })
        expect(asc(result).slice(0, 5)).toEqual([])
        expect(desc(result).slice(0, 5)).toEqual([])
        expect(result.peakChannels).toBeLessThanOrEqual(15)
        if (process.env.GM_REVIEW_PATH) writeFileSync(process.env.GM_REVIEW_PATH, JSON.stringify(rows, null, 2))
      }, 120_000)
    }
  }
})

describe("GmChannelCapacityError の到達可能性(利用者の操作で届くか)", () => {
  // 利用者が足せる、アレンジ以外のパート(伴奏・対旋律・装飾・フレーズ・導入フレーズ)を、最悪「曲全体で同時に鳴る」ものとして足していく。
  // 旋律とコードは常に含める。足す個数ごとに、既定のパート楽器と、全パートを別の楽器にした設定で、例外が出るかを記録する。
  const EXTRA: Array<[string, "accompaniment" | "counter" | "decoration" | "phrase" | "signature"]> = [
    ["Accompaniment", "accompaniment"], ["Selected Counter Melody", "counter"], ["Selected Decoration", "decoration"],
    ["Selected Phrases", "phrase"], ["Selected Intro Phrases", "signature"],
  ]
  it("追加レイヤー数ごとの結果を記録する(記録用。例外の型以外で落ちないことだけ確かめる)", () => {
    seedUuids()
    const table: Record<string, Record<string, string>> = {}
    for (const which of ["A", "B"] as const) {
      const project = arrangementReviewSong(which)
      project.song.genreBlend = [{ id: which === "A" ? "neoclassical" : "electronica", weight: 1 }]
      project.song.tempo = which === "A" ? 84 : 132
      const arrangement = generateFullSongArrangement(project, { seed: 19 })
      const bars = Math.max(...project.sections.map((s) => s.startBar + s.lengthBars - 1))
      const ticksPerBar = 480 * 4
      const whole = (name: string, sound: SoundedTrack["sound"], pitch: number): SoundedTrack => ({
        sound,
        track: { name, notes: Array.from({ length: bars }, (_, bar) => note(pitch, bar * ticksPerBar, ticksPerBar)) },
      })
      for (const [label, programs] of [["既定", DEFAULT_PART_PROGRAMS], ["全パート別", CUSTOM_PROGRAMS]] as const) {
        for (let extra = 0; extra <= EXTRA.length; extra++) {
          const entries = [
            whole("Chords", "chords", 84), whole("Active Melodies", "melody", 85),
            ...EXTRA.slice(0, extra).map(([name, sound], i) => whole(name, sound, 86 + i)),
            ...arrangementSoundedTracks(arrangement),
          ]
          let outcome = "ok"
          try { withGmSounds(entries, programs) } catch (error) {
            outcome = error instanceof GmChannelCapacityError ? "GmChannelCapacityError" : `other: ${String(error)}`
          }
          ;(table[`${which}/${label}`] ??= {})[`+${extra}`] = outcome
          expect(outcome === "ok" || outcome === "GmChannelCapacityError").toBe(true)
        }
      }
    }
    if (process.env.GM_REVIEW_PATH) writeFileSync(`${process.env.GM_REVIEW_PATH}.reach.json`, JSON.stringify(table, null, 2))
  })
})

describe("前回の指摘(A/C/D)が最新ヘッドで直っていること", () => {
  it("トラック全体を再生成しても、保存した楽器が消えない(A)", () => {
    const project = arrangementReviewSong("A")
    project.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
    const arrangement = generateFullSongArrangement(project, { seed: 19 })
    const withInstrument: FullSongArrangement = {
      ...arrangement,
      tracks: arrangement.tracks.map((t) => t.id === "syn-pulse" ? { ...t, instrument: { program: 24, reason: "独立レビュー" } } : t),
    }
    const whole = regenerateFullSongArrangementTarget(project, withInstrument, { trackId: "syn-pulse" })
    expect(whole.tracks.find((t) => t.id === "syn-pulse")?.instrument?.program).toBe(24)
  })

  it("楽器を持つトラックの制作ガイドの行が、所有音源の一覧に収まる(C/D)", () => {
    const allowed = /Battery 4|Repro-[15]|Analog Lab Play|Pigments Play|Session Strings Pro 2|LUX Orchestral Strings Elements|Emotive Strings|Symphony Essentials (?:String Ensemble|Percussion)|Session Guitarist - |Session Bassist - |Noire|Una Corda|Piano Colors|Schema - (?:Dark|Light)|Straylight|Ethereal Earth|Playbox|Analog Dreams|Studio Drummer|Butch Vig Drums|Session Percussionist|Damage/
    for (const which of ["A", "B"] as const) for (const seed of [19, 41, 73]) {
      const project = arrangementReviewSong(which)
      project.song.genreBlend = [{ id: which === "A" ? "neoclassical" : "electronica", weight: 1 }]
      project.fullSongArrangement = generateFullSongArrangement(project, { seed })
      const named = new Set(project.fullSongArrangement.tracks.filter((t) => t.instrument && t.notes.length > 0).map((t) => t.name))
      for (const row of logicSoundRows(project).filter((r) => named.has(r.trackName))) {
        expect(`${row.product} ${row.preset}`, `${which}/${seed} ${row.trackName}`).toMatch(allowed)
      }
    }
  })
})
