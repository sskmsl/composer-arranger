import { describe, expect, it } from "vitest"
import { createEmptyProject, normalizeProject } from "@/core/project"
import type { FullSongArrangement, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { DEFAULT_PART_PROGRAMS, GM_INSTRUMENT_CHOICES, arrangementInstrument, gmFileForProgram } from "@/core/gmInstruments"
import { gmPreviewRequests } from "@/audio/previewPlayer"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { arrangementSoundedTracks } from "./exportArrangement"
import { withGmSounds } from "./gmExport"
import { logicSoundRows } from "./logicProductionPackage"

// Issue #200 / PR #201 の独立レビュー用テスト(Claude Code、実装ブランチとは別ブランチ)。
// - 前半: #201 の土台(トラックごとの楽器)が、試聴・GM書き出し・制作ガイド・保存再読込へ同じ判断を届けるか。
// - 後半: 演奏生成を足す前に分かっている、土台の外側の不足(it.fails で記録。直ると失敗に変わるので、外して通常のテストにする)。
// - 末尾: 演奏生成の前後を同じ物差しで比べる測定関数(固定seedの最終MIDI相当のトラックから測る)。

const NON_DRUM = (track: GeneratedArrangementTrack) => arrangementInstrument(track) !== "drums"
/** 役割の違う、実在しうる楽器番号(ピアノ・ギター・弦・鉄琴・管・コーラス・パッド・ベース)。 */
const POOL = [0, 24, 25, 27, 40, 41, 42, 46, 48, 49, 11, 12, 73, 71, 68, 56, 60, 65, 52, 53, 89, 91, 33, 32]

function arranged(which: "A" | "B" = "A", seed = 19) {
  const project = arrangementReviewSong(which)
  return { project, arrangement: generateFullSongArrangement(project, { seed }) }
}

/** 音のあるすべての非打楽器トラックへ、別々の楽器を割り当てた版。 */
function withDistinctInstruments(arrangement: FullSongArrangement, limit = Infinity): FullSongArrangement {
  let index = 0
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) =>
      NON_DRUM(track) && track.notes.length > 0 && index < limit
        ? { ...track, instrument: { program: POOL[index++ % POOL.length], reason: "独立レビュー" } }
        : track),
  }
}

describe("PR #201: 保存した楽器の判断が、すべての出口へ同じ形で届く", () => {
  it("試聴の読み込み・GM書き出し・制作ガイド・保存再読込が、トラックごとに同じ楽器番号を使う(10トラックまで)", () => {
    const { project, arrangement } = arranged()
    const varied = withDistinctInstruments(arrangement, 10)
    const expected = new Map(varied.tracks.filter((t) => t.instrument && t.notes.length > 0).map((t) => [t.id, t.instrument!.program]))
    expect(expected.size).toBe(10)

    const reloaded = normalizeProject(JSON.parse(JSON.stringify({ ...project, fullSongArrangement: varied })))
    const loaded = reloaded.fullSongArrangement!
    for (const [id, program] of expected) {
      expect(loaded.tracks.find((t) => t.id === id)?.instrument?.program, `${id}: 保存再読込で失われた`).toBe(program)
    }

    for (const source of [varied, loaded]) {
      const sounded = arrangementSoundedTracks(source)
      const gm = withGmSounds(sounded, DEFAULT_PART_PROGRAMS)
      source.tracks.filter((t) => t.notes.length > 0 && !t.muted).forEach((track, i) => {
        const want = expected.get(track.id)
        if (want === undefined) return
        expect(sounded[i].sound, `${track.id}: 書き出しの楽器が違う`).toBe(want)
        expect(gm[i].program, `${track.id}: GMのプログラムチェンジが違う`).toBe(want)
      })
      const files = new Set(gmPreviewRequests({ bpm: 100, mode: "melody-only", chords: [], melody: [], arrangementTracks: source.tracks }, DEFAULT_PART_PROGRAMS).keys())
      for (const program of expected.values()) expect(files.has(gmFileForProgram(program)), `GM ${program}: 試聴で読み込まれない`).toBe(true)
    }

    const rows = logicSoundRows(reloaded)
    for (const track of loaded.tracks.filter((t) => t.instrument && t.notes.length > 0 && !t.muted)) {
      const row = rows.find((r) => r.trackName === track.name)
      const label = GM_INSTRUMENT_CHOICES.find((c) => c.program === track.instrument!.program)?.label ?? `GM ${track.instrument!.program}`
      expect(row?.preset, `${track.id}: 制作ガイドの音色名が違う`).toBe(label)
    }
  }, 120_000)

  it("楽器の指定が無い旧データと、打楽器への指定は、従来どおりに扱う", () => {
    const { arrangement } = arranged()
    for (const track of arrangement.tracks) expect(arrangementInstrument(track)).toBe(arrangementInstrument({ id: track.id }))
    const drum = arrangement.tracks.find((t) => t.id === "dr-kick")!
    expect(arrangementInstrument({ ...drum, instrument: { program: 24, reason: "無視される" } })).toBe("drums")
    for (const program of [-1, 128, 1.5, Number.NaN, "24" as unknown as number, null as unknown as number]) {
      expect(arrangementInstrument({ id: "syn-pulse", instrument: { program, reason: "不正" } })).toBe(arrangementInstrument({ id: "syn-pulse" }))
    }
  })
})

describe("演奏生成の前に分かっている、土台の外側の不足(it.fails: 直ると失敗に変わる)", () => {
  // GMは旋律チャンネルが15。実際の全曲は音のある非打楽器トラックが約20あり、チャンネルを使い回す。
  // 使い回したチャンネルに別のプログラムが載ると、後から来たプログラムチェンジで、先のトラックが別の楽器で鳴る。
  // 従来の固定割り当てでも、15チャンネル中5つで別のプログラムが同居する(A/B × seed 19 で同じ)。
  it.fails("GM書き出しで、同じチャンネルに別の楽器が同居しない", () => {
    const { arrangement } = arranged()
    for (const source of [arrangement, withDistinctInstruments(arrangement)]) {
      const tracks = withGmSounds(arrangementSoundedTracks(source), DEFAULT_PART_PROGRAMS).filter((t) => t.program != null)
      const byChannel = new Map<number, Set<number>>()
      for (const t of tracks) byChannel.set(t.channel ?? -1, (byChannel.get(t.channel ?? -1) ?? new Set()).add(t.program!))
      const shared = [...byChannel.entries()].filter(([, programs]) => programs.size > 1)
      expect(shared, `別の楽器が同居したチャンネル: ${JSON.stringify(shared.map(([c, p]) => [c, [...p]]))}`).toEqual([])
    }
  })

  // 制作ガイドは「所有音源だけ」を提案する方針(exportSongFull.test.ts の「提案する音源は所有一覧だけに限定する」)。
  // #201 は、楽器を持つトラックの行を product "General MIDI" で返すので、その期待に当たらない。
  it.fails("楽器を持つトラックの制作ガイドの行も、所有音源の一覧に収まる", () => {
    const allowed = /Battery 4|Repro-[15]|Analog Lab Play|Pigments Play|Session Strings Pro 2|LUX Orchestral Strings Elements|Emotive Strings|Symphony Essentials (?:String Ensemble|Percussion)|Session Guitarist - |Session Bassist - |Noire|Una Corda|Piano Colors|Schema - (?:Dark|Light)|Straylight|Ethereal Earth|Playbox|Analog Dreams|Studio Drummer|Butch Vig Drums|Session Percussionist|Damage/
    const { project, arrangement } = arranged()
    const target = { ...project, fullSongArrangement: withDistinctInstruments(arrangement, 6) }
    const named = new Set(target.fullSongArrangement.tracks.filter((t) => t.instrument && t.notes.length > 0).map((t) => t.name))
    for (const row of logicSoundRows(target).filter((r) => named.has(r.trackName))) {
      expect(`${row.product} ${row.preset}`, `${row.trackName}: 所有音源の外`).toMatch(allowed)
    }
  })
})

// ---------------------------------------------------------------------------
// 演奏生成の前後を同じ物差しで比べる測定。音数比率は聴感の保証にしない(Issue の方針どおり、役割・重なり・主旋律の保護を見る)。
// ---------------------------------------------------------------------------
export function measureEnsemble(project: ReturnType<typeof arrangementReviewSong>, arrangement: FullSongArrangement) {
  const bpb = 4
  const tracks = arrangement.tracks.filter((t) => !t.muted && t.notes.length > 0)
  const bars = Math.max(...project.sections.map((s) => s.startBar + s.lengthBars - 1))
  const families: Record<string, { tracks: number; events: number }> = {}
  for (const t of tracks) {
    families[t.family] ??= { tracks: 0, events: 0 }
    families[t.family].tracks++
    families[t.family].events += t.notes.length
  }
  const events = Object.values(families).reduce((s, f) => s + f.events, 0)
  let peakNonDrum = 0
  for (let bar = 0; bar < bars; bar++) {
    const sounding = tracks.filter((t) => NON_DRUM(t) && t.notes.some((n) => n.startBeat < (bar + 1) * bpb && n.startBeat + n.durationBeats > bar * bpb + .01)).length
    peakNonDrum = Math.max(peakNonDrum, sounding)
  }
  const programs = new Set(tracks.map((t) => arrangementInstrument(t)).filter((p) => p !== "drums"))
  const m = arrangement.quality!.metrics
  return {
    families,
    drumEventRatio: (families.drums?.events ?? 0) / Math.max(1, events),
    peakNonDrumLayersInOneBar: peakNonDrum,
    distinctNonDrumPrograms: programs.size,
    distinctSectionTextures: m.distinctSectionTextures,
    melodyCollisionCount: m.melodyCollisionCount,
    harmonicViolationCount: m.harmonicViolationCount,
  }
}

describe("測定の基準(演奏生成の前。#201 の土台だけでは何も変わらないことの確認)", () => {
  it("固定seed 19/41/73 × A/B で、測定値が決定的で、土台の追加だけでは動かない", () => {
    for (const which of ["A", "B"] as const) for (const seed of [19, 41, 73]) {
      const { project, arrangement } = arranged(which, seed)
      const first = measureEnsemble(project, arrangement)
      const again = measureEnsemble(project, generateFullSongArrangement(project, { seed }))
      expect(again, `${which} ${seed}: 同seedで測定値が変わる`).toEqual(first)
      expect(first.distinctNonDrumPrograms, `${which} ${seed}`).toBeGreaterThan(0)
      expect(first.harmonicViolationCount).toBe(0)
      expect(first.melodyCollisionCount).toBe(0)
      // Issue の確認値(打楽器トラック16・イベント比率62〜65%)を、独立に再現する
      expect(first.families.drums.tracks).toBe(16)
      expect(first.drumEventRatio).toBeGreaterThan(.62)
      expect(first.drumEventRatio).toBeLessThan(.65)
      void createEmptyProject
    }
  }, 300_000)
})
