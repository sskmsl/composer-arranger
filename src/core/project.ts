import type { Section } from "./section"
import type { GeneratorProfileRole, MelodyGeneratorProfile, MelodyVariant, SongMotifDNA } from "./melody"
import { normalizeSectionTimeline } from "./sectionTimeline"
import { DEFAULT_SECTION_CONTENT, partRoleFor, type SectionContentSettings } from "./sectionContent"
import { fallbackPlanFor, replaceVariantNotes } from "./sectionLayers"
import {
  createDefaultAccompanimentPatterns,
  type AccompanimentPatternTemplate,
} from "./accompanimentPattern"

export type SongProfileId =
  | "dark-romantic"
  | "cinematic-french-pop"
  | "minimal-tension"
  | "dramatic-synth-pop"
  | "original-custom"

export const SONG_PROFILE_LABELS: Record<SongProfileId, string> = {
  "dark-romantic": "Dark Romantic",
  "cinematic-french-pop": "Cinematic French Pop",
  "minimal-tension": "Minimal Tension",
  "dramatic-synth-pop": "Dramatic Synth Pop",
  "original-custom": "Original Custom",
}

export interface SectionProfileOverride {
  sectionId: string
  songProfile: SongProfileId
}

export interface ChordEvent {
  id: string
  sectionId: string
  /** セクション先頭からの相対拍位置 */
  startBeat: number
  durationBeats: number
  symbol: string
  bass: string | null
}

export type StereoWidthIntent = "narrow" | "growing" | "wide"

export interface ArrangementSettings {
  maximumParts: number
  spacePriority: number
  rhythmActivity: number
  stereoWidthIntent: StereoWidthIntent
  acousticSyntheticBalance: number
  asymmetryIntent: number
}

export const DEFAULT_ARRANGEMENT_SETTINGS: ArrangementSettings = {
  maximumParts: 5,
  spacePriority: 0.5,
  rhythmActivity: 0.5,
  stereoWidthIntent: "growing",
  acousticSyntheticBalance: 0.5,
  asymmetryIntent: 0.5,
}

/**
 * startBeat/durationBeats等の時間値が「四分音符=1拍」で保存されていることを示すマーカー。
 * schemaVersion 1.1のまま拍子分母4以外のデータ(6/8等)の時間単位が新旧2種類存在するように
 * なってしまった問題(Issue #16)への対応として、この値が"quarter"であるプロジェクトだけが
 * 現行の時間単位で保存済みだと判定できる。
 */
export type TimeBase = "quarter"
export const TIME_BASE: TimeBase = "quarter"

export interface ComposerProject {
  schemaVersion: string
  projectId: string
  title: string
  song: {
    key: string
    tempo: number
    timeSignature: string
    songProfile: SongProfileId
    sectionProfileOverrides: SectionProfileOverride[]
  }
  arrangementSettings: ArrangementSettings
  sections: Section[]
  chords: ChordEvent[]
  melodyVariants: MelodyVariant[]
  arrangementVariants: unknown[]
  audioReferences: unknown[]
  activeMelodyId: string | null
  /** 曲全体を組み立てるための、セクションごとの採用Variant。 */
  sectionMelodyAssignments: Record<string, string>
  /** Issue #45: コード進行・Melody Variantから独立した度数＋リズムの伴奏テンプレート。 */
  accompanimentPatterns: AccompanimentPatternTemplate[]
  /** Issue #45: セクションごとに適用するAccompaniment Pattern Template。 */
  sectionAccompanimentPatternAssignments: Record<string, string>
  activeArrangementId: string | null
  notes: string
  /** Melody Candidate Diversity v1.2: Profileごとの役割づけ(任意・強制なし) */
  generatorProfileRoles?: Partial<Record<MelodyGeneratorProfile, GeneratorProfileRole>>
  /** セクションをまたいだ旋律の同一性を保つための共有データ(将来拡張の土台) */
  songMotifDNA?: SongMotifDNA
  /** Issue #16: 時間値の単位マーカー。付与済みプロジェクトは再変換の判定対象から除外する */
  timeBase?: TimeBase
}

/** 1.5: Issue #45 で独立Accompaniment Pattern Templateとセクション割り当てを追加 */
export const CURRENT_SCHEMA_VERSION = "1.5"

export function createEmptyProject(title = "Untitled"): ComposerProject {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectId: crypto.randomUUID(),
    title,
    song: {
      key: "Am",
      tempo: 96,
      timeSignature: "4/4",
      songProfile: "original-custom",
      sectionProfileOverrides: [],
    },
    arrangementSettings: { ...DEFAULT_ARRANGEMENT_SETTINGS },
    sections: [],
    chords: [],
    melodyVariants: [],
    arrangementVariants: [],
    audioReferences: [],
    activeMelodyId: null,
    sectionMelodyAssignments: {},
    accompanimentPatterns: createDefaultAccompanimentPatterns(),
    sectionAccompanimentPatternAssignments: {},
    activeArrangementId: null,
    notes: "",
    timeBase: TIME_BASE,
  }
}

/**
 * Issue #41: 旧セクション(content未保存)へ2軸モデルの既定値を補完する。
 * 既定は lead="melody" / accompaniment="chords" / entryOffsetBeats=0 なので、
 * 既存プロジェクトの生成・再生・書き出しの挙動は変わらない。
 */
export function normalizeSectionContent(section: Section): Section {
  const raw = section.content as Partial<SectionContentSettings> | undefined
  const entryOffsetRaw = Number(raw?.entryOffsetBeats)
  return {
    ...section,
    content: {
      lead: raw?.lead ?? DEFAULT_SECTION_CONTENT.lead,
      accompaniment: raw?.accompaniment ?? DEFAULT_SECTION_CONTENT.accompaniment,
      // 破損値・負値は既定へ落とす(entryOffsetは生成範囲の下限として使うため)
      entryOffsetBeats: Number.isFinite(entryOffsetRaw) && entryOffsetRaw > 0 ? entryOffsetRaw : 0,
      pickup: raw?.pickup ?? DEFAULT_SECTION_CONTENT.pickup,
    },
  }
}

/**
 * Issue #41: 旧候補(layers未保存)へ、notesを単一leadレイヤーとみなしたlayersを補完する。
 * partRoleの正をLayer側へ寄せたうえで、notesは従来どおり平坦な派生値として残す。
 */
export function normalizeVariantLayers(variant: MelodyVariant): MelodyVariant {
  if (variant.layers && variant.layers.length > 0) return replaceVariantNotes(variant, variant.notes)
  const content = variant.leadContent ?? "melody"
  return {
    ...variant,
    leadContent: content,
    layers: [
      {
        id: `${variant.id}:lead`,
        partRole: partRoleFor(content),
        content,
        plan: variant.contentPlan ?? fallbackPlanFor(content, variant.notes),
        notes: variant.notes,
      },
    ],
  }
}

/**
 * schemaVersion 1.0 (songProfile/sectionProfileOverrides/arrangementSettingsを
 * 持たない旧形式)を読み込んだ場合のデフォルト値方針(16.0)を適用して正規化する。
 */
export function normalizeProject(raw: unknown): ComposerProject {
  const r = raw as Partial<ComposerProject> & { song?: Partial<ComposerProject["song"]> }
  const base = createEmptyProject(r.title ?? "Untitled")
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectId: r.projectId ?? base.projectId,
    title: r.title ?? base.title,
    song: {
      key: r.song?.key ?? base.song.key,
      tempo: r.song?.tempo ?? base.song.tempo,
      timeSignature: r.song?.timeSignature ?? base.song.timeSignature,
      songProfile: r.song?.songProfile ?? "original-custom",
      sectionProfileOverrides: r.song?.sectionProfileOverrides ?? [],
    },
    arrangementSettings: { ...DEFAULT_ARRANGEMENT_SETTINGS, ...r.arrangementSettings },
    sections: normalizeSectionTimeline(r.sections ?? []).map(normalizeSectionContent),
    chords: r.chords ?? [],
    melodyVariants: (r.melodyVariants ?? []).map(normalizeVariantLayers),
    arrangementVariants: r.arrangementVariants ?? [],
    audioReferences: r.audioReferences ?? [],
    activeMelodyId: r.activeMelodyId ?? null,
    sectionMelodyAssignments: r.sectionMelodyAssignments ?? {},
    accompanimentPatterns: (() => {
      const saved = r.accompanimentPatterns ?? []
      const savedIds = new Set(saved.map((pattern) => pattern.id))
      return [
        ...saved,
        ...createDefaultAccompanimentPatterns().filter((pattern) => !savedIds.has(pattern.id)),
      ]
    })(),
    sectionAccompanimentPatternAssignments: r.sectionAccompanimentPatternAssignments ?? {},
    activeArrangementId: r.activeArrangementId ?? null,
    notes: r.notes ?? "",
    generatorProfileRoles: r.generatorProfileRoles,
    songMotifDNA: r.songMotifDNA,
    timeBase: r.timeBase,
  }
}

/** セクションに適用中のSong Profile(セクション別上書きを考慮) */
export function effectiveSongProfile(project: ComposerProject, sectionId: string): SongProfileId {
  const override = project.song.sectionProfileOverrides.find((o) => o.sectionId === sectionId)
  return override?.songProfile ?? project.song.songProfile
}
