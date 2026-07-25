import type { SectionContentSettings } from "./sectionContent"

export type SectionRole =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "breakdown-chorus"
  | "grand-chorus"
  | "c-melody"
  | "bridge"
  | "instrumental"
  | "outro"

export const SECTION_ROLE_LABELS: Record<SectionRole, string> = {
  intro: "イントロ",
  verse: "Aメロ",
  "pre-chorus": "Bメロ",
  chorus: "サビ",
  "breakdown-chorus": "落ちサビ",
  "grand-chorus": "大サビ",
  "c-melody": "Cメロ",
  bridge: "ブリッジ",
  instrumental: "間奏",
  outro: "アウトロ",
}

export interface Section {
  id: string
  name: string
  role: SectionRole
  startBar: number
  lengthBars: number
  /**
   * Issue #41: このセクションで鳴らす内容(Roleとは独立した軸)。
   * 旧プロジェクトには存在しないため任意とし、normalizeProjectで既定値を補完する。
   */
  content?: SectionContentSettings
}

export interface TimeSignature {
  /** 表記上の分子(例: 6/8なら6)。MIDIの拍子メタイベントの表示に使う */
  numerator: number
  /** 表記上の分母(例: 6/8なら8) */
  denominator: number
  /**
   * 四分音符換算での1小節あたり拍数(= numerator * 4 / denominator)。
   * アプリ内部のstartBeat/durationBeatsは常にこの「四分音符=1拍」の単位に
   * 統一しているため、小節長や生成範囲、MIDIのtick変換はすべてこの値を使う。
   * (以前はnumeratorをそのままbeatsPerBarとして使っていたため、6/8等
   * 分母が4以外の拍子で小節長とMIDI上のtick数が一致しなかった)
   */
  beatsPerBar: number
}

export function parseTimeSignature(sig: string): TimeSignature {
  const m = /^(\d+)\/(\d+)$/.exec(sig.trim())
  if (!m) return { numerator: 4, denominator: 4, beatsPerBar: 4 }
  const numerator = parseInt(m[1], 10)
  const denominator = parseInt(m[2], 10)
  return { numerator, denominator, beatsPerBar: (numerator * 4) / denominator }
}

export function sectionLengthBeats(section: Section, ts: TimeSignature): number {
  return section.lengthBars * ts.beatsPerBar
}
