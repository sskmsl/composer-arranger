export type SectionRole =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "grand-chorus"
  | "bridge"
  | "outro"
  | "instrumental"

export const SECTION_ROLE_LABELS: Record<SectionRole, string> = {
  intro: "イントロ",
  verse: "Aメロ",
  "pre-chorus": "Bメロ",
  chorus: "サビ",
  "grand-chorus": "大サビ",
  bridge: "ブリッジ",
  outro: "アウトロ",
  instrumental: "間奏",
}

export interface Section {
  id: string
  name: string
  role: SectionRole
  startBar: number
  lengthBars: number
}

export interface TimeSignature {
  beatsPerBar: number
  beatUnit: number
}

export function parseTimeSignature(sig: string): TimeSignature {
  const m = /^(\d+)\/(\d+)$/.exec(sig.trim())
  if (!m) return { beatsPerBar: 4, beatUnit: 4 }
  return { beatsPerBar: parseInt(m[1], 10), beatUnit: parseInt(m[2], 10) }
}

export function sectionLengthBeats(section: Section, ts: TimeSignature): number {
  return section.lengthBars * ts.beatsPerBar
}
