import type { MelodyNote } from "./melody"

export type ArrangementTrackId =
  | "dr-kick"
  | "dr-snare"
  | "dr-closed-hat"
  | "dr-open-hat"
  | "dr-low-tom"
  | "dr-high-tom"
  | "dr-field-drum"
  | "dr-gran-cassa"
  | "dr-crash"
  | "syn-bass"
  | "syn-pulse"
  | "syn-stabs"
  | "syn-dark-pad"
  | "syn-high-glass"
  | "syn-transition-phrase"
  | "syn-final-lift"
  | "str-cello"
  | "str-viola"
  | "str-violin-2"
  | "str-violin-1"
  | "str-upper"

export type ArrangementCandidateCharacter = "safe" | "edge" | "surprise"

export interface ArrangementAnalysisSection {
  sectionId: string
  sectionName: string
  sectionRole: string
  order: number
  occurrence: number
  /** 同じ音楽的役割が連続して分割された場合の、連続区間内の位置。 */
  semanticSegmentIndex?: number
  energy: number
  energyDelta: number
  melodyRange: { low: number; high: number } | null
  melodyRestRatio: number
  chordRepetition: number
  melodyRepetition: number
  availableRegisters: Array<"low" | "middle" | "high">
  semanticRole?: ArrangementSemanticRole
}

export type ArrangementSemanticRole =
  | "intro"
  | "verse"
  | "pre"
  | "chorus"
  | "breakdown"
  | "bridge"
  | "build"
  | "final"
  | "reprise"
  | "outro"
  | "other"

export type ArrangementGrooveFamily =
  | "suspended"
  | "restrained"
  | "driving"
  | "broken"
  | "building"
  | "release"

export type ArrangementBassStrategy =
  | "sustain"
  | "melodic-pulse"
  | "syncopated"
  | "octave-drive"
  | "approach-led"

export type ArrangementHarmonyStrategy =
  | "pedal-space"
  | "slow-voice-leading"
  | "sparse-stabs"
  | "register-expansion"

export interface ArrangementAnalysis {
  version: "1.0.0"
  bpm: number
  key: string
  timeSignature: string
  totalBeats: number
  peakSectionId: string | null
  sections: ArrangementAnalysisSection[]
}

export interface ArrangementTransitionCandidate {
  id: string
  sectionId: string
  character: ArrangementCandidateCharacter
  kind:
    | "ascending"
    | "descending"
    | "motif-variation"
    | "reverse-motif"
    | "chromatic-approach"
    | "bell-hit"
    | "string-swell"
    | "synth-fill"
    | "rhythmic-fill"
    | "silence"
  reason: string
  notes: MelodyNote[]
}

export interface ArrangementSectionPlan {
  sectionId: string
  sectionName: string
  sectionRole: string
  energy: number
  density: "sparse" | "medium" | "medium-high" | "high"
  register: { low: "open" | "medium" | "strong"; mid: "open" | "medium" | "strong"; high: "open" | "medium" | "strong" }
  intention: string
  activeRoles: ArrangementTrackId[]
  transitionCandidates: ArrangementTransitionCandidate[]
  selectedTransitionCharacter: ArrangementCandidateCharacter | "silence"
  decorationCandidates: ArrangementTransitionCandidate[]
  selectedDecorationCharacter: ArrangementCandidateCharacter | "silence"
  /** Sectionの名前・配置から解釈した、生成時の音楽的な役割。 */
  semanticRole?: ArrangementSemanticRole
  /** 同じ役割が再登場した際の発展段階。0=提示、1=発展、2=解放。 */
  developmentStage?: 0 | 1 | 2
  /** 1小節ループを避けるために共有するフレーズ周期。 */
  phraseCycleBars?: 4 | 8
  grooveFamily?: ArrangementGrooveFamily
  bassStrategy?: ArrangementBassStrategy
  harmonyStrategy?: ArrangementHarmonyStrategy
  /** Section先頭から何拍待って役割を登場させるか。 */
  roleEntryBeats?: Partial<Record<ArrangementTrackId, number>>
}

export interface ArrangementPlan {
  version: "1.0.0"
  brief: string
  seed: number
  directive?: ArrangementGenerationDirective
  sections: ArrangementSectionPlan[]
}

export interface ArrangementGenerationDirective {
  sectionId?: string
  intention: string
  character?: "minimal" | "cinematic" | "rhythmic" | "dark-experimental" | "balanced"
  energyDelta?: number
  add?: ArrangementTrackId[]
  preserve?: ArrangementTrackId[]
  surpriseLevel?: number
}

export interface GeneratedArrangementNote extends MelodyNote {
  sectionId: string
  character: ArrangementCandidateCharacter
  reason: string
}

export interface GeneratedArrangementTrack {
  id: ArrangementTrackId
  name: string
  family: "drums" | "bass" | "synth" | "strings" | "transition"
  muted: boolean
  notes: GeneratedArrangementNote[]
  generationRevision: number
  purpose: string
}

export interface FullSongArrangement {
  version: "1.0.0"
  id: string
  createdAt: string
  analysis: ArrangementAnalysis
  plan: ArrangementPlan
  tracks: GeneratedArrangementTrack[]
  quality?: ArrangementQualityReport
}

export interface ArrangementQualityReport {
  score: number
  passed: boolean
  summary: string
  metrics: {
    distinctSectionTextures: number
    stagedEntryCount: number
    peakSectionId: string | null
    peakIsLate: boolean
    overfilledSectionCount: number
    silentRoleCount: number
    /** 同じ音程・リズムを小節ごとに機械的に反復している音色Section数。 */
    mechanicalLoopCount: number
    /** 最も疎なSectionと最も密なSectionの音数差。 */
    densityContrastRatio: number
  }
  recommendations: string[]
}

export interface ArrangementRegenerationTarget {
  trackId: ArrangementTrackId
  sectionId?: string
  energyDelta?: number
  character?: ArrangementCandidateCharacter
}

export const ARRANGEMENT_TRACK_NAMES: Record<ArrangementTrackId, string> = {
  "dr-kick": "DR_Kick",
  "dr-snare": "DR_Snare",
  "dr-closed-hat": "DR_ClosedHat",
  "dr-open-hat": "DR_OpenHat",
  "dr-low-tom": "DR_LowTom",
  "dr-high-tom": "DR_HighTom",
  "dr-field-drum": "DR_FieldDrum",
  "dr-gran-cassa": "DR_GranCassa",
  "dr-crash": "DR_Crash",
  "syn-bass": "SYN_Bass",
  "syn-pulse": "SYN_Pulse",
  "syn-stabs": "SYN_Stabs",
  "syn-dark-pad": "SYN_DarkPad",
  "syn-high-glass": "SYN_HighGlass",
  "syn-transition-phrase": "SYN_TransitionPhrase",
  "syn-final-lift": "SYN_FinalLift",
  "str-cello": "STR_Cello",
  "str-viola": "STR_Viola",
  "str-violin-2": "STR_Violin2",
  "str-violin-1": "STR_Violin1",
  "str-upper": "STR_Upper",
}
