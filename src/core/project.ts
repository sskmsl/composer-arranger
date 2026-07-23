import type { Section } from "./section"
import type { MelodyVariant } from "./melody"

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
  activeArrangementId: string | null
  notes: string
}

export const CURRENT_SCHEMA_VERSION = "1.1"

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
    activeArrangementId: null,
    notes: "",
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
    sections: r.sections ?? [],
    chords: r.chords ?? [],
    melodyVariants: r.melodyVariants ?? [],
    arrangementVariants: r.arrangementVariants ?? [],
    audioReferences: r.audioReferences ?? [],
    activeMelodyId: r.activeMelodyId ?? null,
    activeArrangementId: r.activeArrangementId ?? null,
    notes: r.notes ?? "",
  }
}

/** セクションに適用中のSong Profile(セクション別上書きを考慮) */
export function effectiveSongProfile(project: ComposerProject, sectionId: string): SongProfileId {
  const override = project.song.sectionProfileOverrides.find((o) => o.sectionId === sectionId)
  return override?.songProfile ?? project.song.songProfile
}
