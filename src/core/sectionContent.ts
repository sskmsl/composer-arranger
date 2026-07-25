import type { MelodyNote } from "./melody"
import type { SectionRole } from "./section"

/**
 * Issue #41: セクションで鳴らす内容をSection Roleとは独立した軸として持つ。
 *
 * 「リードが鳴る内容」と「伴奏の有無」は直交する軸なので、旧設計の
 * 単一 SectionContentMode ("chords-only" / "silence" を Mode として並べる形)ではなく
 * 2軸へ分解している。旧 Mode との対応は以下。
 *
 * | 旧 Mode      | lead   | accompaniment |
 * | Chords Only  | none   | chords        |
 * | Silence      | none   | none          |
 *
 * これにより「Droneのみ・伴奏なし」「Motif + 伴奏あり」も表現できる。
 */
export type LeadContent = "auto" | "melody" | "motif" | "ostinato" | "drone" | "none"

/** リードの下で鳴る伴奏。将来 pad / arpeggio 等を追加する余地を残す */
export type Accompaniment = "none" | "chords"

/** 生成結果(Layer)の役割。MIDIのトラック/チャンネル分割はこの値から決まる */
export type PartRole = "lead" | "accompaniment"

/** "auto" は生成前に必ず具体的な content へ解決されるため、計画・生成物側では現れない */
export type ResolvedLeadContent = Exclude<LeadContent, "auto">

export const LEAD_CONTENTS: LeadContent[] = ["auto", "melody", "motif", "ostinato", "drone", "none"]

export const RESOLVED_LEAD_CONTENTS: ResolvedLeadContent[] = ["melody", "motif", "ostinato", "drone", "none"]

export const LEAD_CONTENT_LABELS: Record<LeadContent, string> = {
  auto: "Auto",
  melody: "Melody",
  motif: "Motif",
  ostinato: "Ostinato",
  drone: "Drone",
  none: "None",
}

/**
 * Ostinato / Drone は本質的に伴奏パート(第3段階でArrangement Engineへ渡す想定)なので、
 * Melody トラックへ混ぜずに最初からトラックを分ける。
 */
export const CONTENT_PART_ROLE: Record<ResolvedLeadContent, PartRole> = {
  melody: "lead",
  motif: "lead",
  ostinato: "accompaniment",
  drone: "accompaniment",
  none: "lead",
}

/** セクション単位の内容設定。Section Role とは独立した軸として保存する */
export interface SectionContentSettings {
  lead: LeadContent
  accompaniment: Accompaniment
  /**
   * リードが鳴り始めるまでの拍数。旧設計の "Silence" Mode はこの値で表現する
   * (完全無音は entryOffsetBeats = セクション長)。Mode として持つと
   * 「前半2小節が無音、後半にMotif」が表現できないため軸へ移した。
   */
  entryOffsetBeats: number
  /** 次セクション直前の弱起を生成するか */
  pickup: boolean
}

export const DEFAULT_SECTION_CONTENT: SectionContentSettings = {
  lead: "melody",
  accompaniment: "chords",
  entryOffsetBeats: 0,
  pickup: false,
}

/**
 * UIは従来案どおり7プリセットとして提示する(内部モデルだけ2軸)。
 * entryOffsetBeats / pickup はプリセットとは独立に調整できるため、ここでは持たない。
 */
export interface ContentPreset {
  id: string
  label: string
  lead: LeadContent
  accompaniment: Accompaniment
}

export const CONTENT_PRESETS: ContentPreset[] = [
  { id: "auto", label: "Auto", lead: "auto", accompaniment: "chords" },
  { id: "melody", label: "Melody", lead: "melody", accompaniment: "chords" },
  { id: "motif", label: "Motif", lead: "motif", accompaniment: "chords" },
  { id: "ostinato", label: "Ostinato", lead: "ostinato", accompaniment: "chords" },
  { id: "drone", label: "Drone", lead: "drone", accompaniment: "chords" },
  { id: "chords-only", label: "Chords Only", lead: "none", accompaniment: "chords" },
  { id: "silence", label: "Silence", lead: "none", accompaniment: "none" },
]

/** 現在の設定に一致するプリセットID(一致しない組み合わせはnull) */
export function presetIdFor(content: SectionContentSettings): string | null {
  return CONTENT_PRESETS.find((p) => p.lead === content.lead && p.accompaniment === content.accompaniment)?.id ?? null
}

export function presetById(id: string): ContentPreset | undefined {
  return CONTENT_PRESETS.find((p) => p.id === id)
}

// ---------------------------------------------------------------------------
// Content Plan(実音の前に決める構造計画)
// ---------------------------------------------------------------------------

export type ContentRegister = "low" | "middle" | "high"

/** そのcontentが「また出てくる」仕組み */
export type RecurrenceStrategy = "phrase" | "sparse-return" | "periodic-cycle" | "sustain" | "none"

/** そのcontentが「変化していく」仕組み */
export type ContentDevelopmentStrategy = "develop" | "fragment" | "mutate-cycle" | "hold" | "none"

/** コード境界での振る舞い。Droneが境界で分割・再スナップされないようにするための軸 */
export type ChordBoundaryResponse = "follow" | "hold-through" | "anticipate"

/**
 * content ごとの生成前構造計画。
 *
 * 通常Melodyを生成してから音価・音数だけ変更する実装を避けるため、
 * 「Section Role / Song Profile / Chords → LeadContent → SectionContentPlan →
 * 専用Generator → Structural Validation → Notes」の順で必ずこの計画を先に作る。
 */
export interface SectionContentPlan {
  content: ResolvedLeadContent
  entryOffsetBeats: number
  pickupBeats: number
  register: ContentRegister
  /** 使用を許すピッチクラス(0-11)。Droneは1〜2種類に絞る */
  pitchVocabulary: number[]
  rhythmGrammar: string
  recurrenceStrategy: RecurrenceStrategy
  developmentStrategy: ContentDevelopmentStrategy
  chordBoundaryResponse: ChordBoundaryResponse
  /** 反復単位の長さ(拍)。Ostinatoの周期、Motifの核の長さ */
  cellLengthBeats: number
  /** 核を何回登場させる計画か */
  repetitionCount: number
  /** 全長に対する持続音の割合の目標(Droneは高い) */
  sustainRatioTarget: number
  /** 核の音程列(半音、正負つき)。Motif/Ostinatoの実音程を候補間で変える軸 */
  motifIntervals: number[]
  /** 核の音価列(拍) */
  cellDurations: number[]
  /** 反復と反復の間に置く余白(拍) */
  restBeats: number[]
}

/**
 * 生成物の単位。partRole の正はこのLayerであり、Note側には保存しない
 * (同一Layer内でNoteごとにRoleが不整合になる状態を防ぐ / Project JSONの肥大化を避ける)。
 * 第1段階では layers.length <= 1 だが、将来 motif + ostinato の重ね合わせでLayerを追加する。
 */
export interface SectionLayer {
  id: string
  partRole: PartRole
  content: ResolvedLeadContent
  plan: SectionContentPlan
  notes: MelodyNote[]
  /**
   * primary はそのcontentの本体。pickup は次セクションへの弱起だけを持つ別Layer。
   * content="none" では primary のノート数が0のまま pickup だけが鳴る形になるため、
   * 両者を同じLayerへ混ぜず分けて保持する。
   */
  kind?: "primary" | "pickup"
}

// ---------------------------------------------------------------------------
// 構造特徴量(Structural Validation用)
// ---------------------------------------------------------------------------

/**
 * content別の構造特徴量。第2段階の本格的な品質スコアの前に、
 * 「ラベルだけ違い実音が似る」候補を第1段階で検出するために使う。
 */
export interface ContentStructureFeatures {
  content: ResolvedLeadContent
  entryOffsetBeats: number
  /** 使用ピッチクラスの種類数。Droneは1〜2 */
  pitchClassCardinality: number
  intervalSequence: number[]
  onsetPattern: number[]
  durationPattern: number[]
  sustainRatio: number
  restRatio: number
  recurrencePeriodBeats?: number
  /** 0..1。周期位置に同じ形が再出現する強さ */
  recurrenceStrength: number
  registerCenter: number
  contour: number[]
}

/** そのcontentが伴奏側パートか */
export function partRoleFor(content: ResolvedLeadContent): PartRole {
  return CONTENT_PART_ROLE[content]
}

/**
 * Section Roleごとに、Autoが選ぶ候補として音楽的に妥当なcontent。
 * 第1段階はイントロを主対象とするが、他Roleでも破綻しないよう既定を持たせる。
 */
export const AUTO_CONTENT_CANDIDATES: Record<SectionRole, ResolvedLeadContent[]> = {
  intro: ["motif", "drone", "none", "ostinato", "melody"],
  verse: ["melody", "motif"],
  "pre-chorus": ["melody", "motif"],
  chorus: ["melody"],
  "breakdown-chorus": ["melody", "motif", "drone"],
  "grand-chorus": ["melody"],
  "c-melody": ["melody", "motif"],
  bridge: ["melody", "motif", "ostinato"],
  instrumental: ["ostinato", "motif", "melody", "drone"],
  outro: ["drone", "motif", "none", "ostinato"],
}

/** entryOffset / セクション長から、リードを鳴らして良い区間を返す */
export function leadWindow(plan: SectionContentPlan, totalBeats: number): { startBeat: number; endBeat: number } {
  const startBeat = Math.max(0, Math.min(totalBeats, plan.entryOffsetBeats))
  return { startBeat, endBeat: totalBeats }
}

/** entryOffsetより前にリードノートが無いことを検証する(受け入れ条件の直接確認用) */
export function notesBeforeEntryOffset(notes: MelodyNote[], entryOffsetBeats: number): MelodyNote[] {
  const EPS = 1e-6
  return notes.filter((note) => note.startBeat < entryOffsetBeats - EPS)
}
