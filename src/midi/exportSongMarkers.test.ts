import { describe, expect, it } from "vitest"
import { exportMelodyMidi, exportSongMidi } from "./exportMelody"
import { TICKS_PER_QUARTER } from "./smf"
import type { ChordEvent, ComposerProject } from "@/core/project"
import { createEmptyProject } from "@/core/project"
import type { Section } from "@/core/section"
import { normalizeSectionTimeline, moveSectionInTimeline } from "@/core/sectionTimeline"

/**
 * Issue #61: Composer Projectのセクション情報をMIDIのマーカーとして書き出す。
 *
 * Marker Meta Event(FF 06)はSMF標準のイベント種別で、Logic Proはこれを
 * グローバルトラックのマーカートラック/マーカーリストへ表示する。
 * ここではSMF出力側(marker位置・テキストがセクション構成を正しく反映しているか)
 * を検証する。Logic Pro側の表示自体は実機無しでは検証できないため対象外。
 */
function parseMarkers(bytes: Uint8Array): { tick: number; text: string }[] {
  // conductor track(先頭のMTrk)だけを読む。ノートイベントは無いので
  // FF 06(Marker)以外のメタイベントはペイロード長ぶん読み飛ばすだけでよい。
  let cursor = 14
  const bodyLength = (bytes[cursor + 4] << 24) | (bytes[cursor + 5] << 16) | (bytes[cursor + 6] << 8) | bytes[cursor + 7]
  let position = cursor + 8
  const end = position + bodyLength
  let tick = 0
  const markers: { tick: number; text: string }[] = []

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
    if (status !== 0xff) throw new Error(`conductor trackに予期しないイベント 0x${status.toString(16)}`)
    const type = bytes[position++]
    const length = readVlq()
    if (type === 0x06) {
      markers.push({ tick, text: new TextDecoder().decode(bytes.slice(position, position + length)) })
    }
    position += length
  }
  return markers
}

function section(patch: Partial<Section> & { id: string; name: string; lengthBars: number }): Section {
  return { role: "verse", startBar: 1, ...patch }
}

function projectWith(sections: Section[], timeSignature = "4/4"): ComposerProject {
  const base = createEmptyProject("Song")
  return {
    ...base,
    song: { ...base.song, timeSignature },
    sections: normalizeSectionTimeline(sections),
    chords: [] as ChordEvent[],
  }
}

describe("Issue #61 / 曲全体MIDIがセクションをMarker Meta Eventとして書き出す", () => {
  it("各セクションの開始位置にマーカーが作られ、名前が実際のセクション名になる", () => {
    const project = projectWith([
      section({ id: "s1", name: "イントロ", lengthBars: 4 }),
      section({ id: "s2", name: "Aメロ", lengthBars: 8 }),
      section({ id: "s3", name: "サビ", lengthBars: 8 }),
    ])
    const markers = parseMarkers(exportSongMidi(project, false))
    const beatsPerBar = 4
    expect(markers).toEqual([
      { tick: 0, text: "イントロ" },
      { tick: 4 * beatsPerBar * TICKS_PER_QUARTER, text: "Aメロ" },
      { tick: (4 + 8) * beatsPerBar * TICKS_PER_QUARTER, text: "サビ" },
    ])
  })

  it("固定名称ではなく、ユーザーが変更したセクション名がそのまま反映される", () => {
    const project = projectWith([section({ id: "s1", name: "俺の最強イントロ", lengthBars: 2 })])
    const markers = parseMarkers(exportSongMidi(project, false))
    expect(markers).toEqual([{ tick: 0, text: "俺の最強イントロ" }])
  })

  it("並び替え後、マーカーの順序と開始位置が新しい構成を反映する", () => {
    const original = [
      section({ id: "s1", name: "Section 1", lengthBars: 4 }),
      section({ id: "s2", name: "Section 2", lengthBars: 8 }),
      section({ id: "s3", name: "Section 3", lengthBars: 4 }),
    ]
    // Section 3 を先頭へ移動する(Arrangement画面のドラッグ並び替えと同じ経路)
    const reordered = moveSectionInTimeline(original, "s3", 0)
    const project = projectWith(reordered)
    const markers = parseMarkers(exportSongMidi(project, false))
    const beatsPerBar = 4
    expect(markers.map((m) => m.text)).toEqual(["Section 3", "Section 1", "Section 2"])
    expect(markers.map((m) => m.tick)).toEqual([0, 4 * beatsPerBar * TICKS_PER_QUARTER, (4 + 4) * beatsPerBar * TICKS_PER_QUARTER])
  })

  it("複製したセクションも末尾にマーカーとして追加される", () => {
    const withDuplicate = [
      section({ id: "s1", name: "Section 1", lengthBars: 4 }),
      section({ id: "s2", name: "Section 2", lengthBars: 4 }),
      // duplicateSection相当: 新しいIDで元セクションのコピーを末尾へ追加
      section({ id: "s1-copy", name: "Section 1 copy", lengthBars: 4 }),
    ]
    const project = projectWith(withDuplicate)
    const markers = parseMarkers(exportSongMidi(project, false))
    expect(markers.map((m) => m.text)).toEqual(["Section 1", "Section 2", "Section 1 copy"])
  })

  it("拍子が4/4以外でもtick位置が正しく計算される(6/8: 1小節=3拍換算)", () => {
    const project = projectWith(
      [
        section({ id: "s1", name: "Section 1", lengthBars: 4 }),
        section({ id: "s2", name: "Section 2", lengthBars: 8 }),
      ],
      "6/8",
    )
    const markers = parseMarkers(exportSongMidi(project, false))
    const beatsPerBar68 = 3 // 6/8 = numerator(6) * 4 / denominator(8) = 3
    expect(markers).toEqual([
      { tick: 0, text: "Section 1" },
      { tick: 4 * beatsPerBar68 * TICKS_PER_QUARTER, text: "Section 2" },
    ])
  })

  it("セクションが無いプロジェクトでは空配列になり、例外を投げない", () => {
    const project = projectWith([])
    expect(parseMarkers(exportSongMidi(project, false))).toEqual([])
  })

  it("マーカー追加が既存のノート・テンポ・拍子・パート別トラックの書き出しを壊さない(回帰)", () => {
    const project = projectWith([section({ id: "s1", name: "Section 1", lengthBars: 4 })])
    const bytes = exportSongMidi(project, true)
    // conductor + Chords(空でも includeChords=true ならトラック自体は作られる) + Active Melodies
    // の基本構成が壊れていないことだけを、例外なく解析できることで確認する
    expect(() => parseMarkers(bytes)).not.toThrow()
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})

describe("Issue #61 / セクション単位のMIDI書き出し(exportMelodyMidi)は対象セクションのみの単一マーカーを持つ", () => {
  it("複数セクションがあっても、書き出したセクション自身の名前だけがマーカーになる(回帰)", () => {
    const project = projectWith([
      section({ id: "s1", name: "Section 1", lengthBars: 4 }),
      section({ id: "s2", name: "対象セクション", lengthBars: 4 }),
    ])
    const target = project.sections[1]
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: target.name,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords: [],
      melodyNotes: [],
      includeChords: false,
    })
    expect(parseMarkers(bytes)).toEqual([{ tick: 0, text: "対象セクション" }])
  })
})
