import type { MelodyNote } from "./melody"
import type { PerformanceExecutionDiagnostics, PerformanceExecutionPlan } from "./performanceExecution"
import type { ArrangementSoundInstruction } from "./arrangementIntent"

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

/** 同じ制作意図を、異なる作曲判断で実音化する候補内の解釈軸。 */
export type ArrangementCandidateApproach =
  | "space-led"
  | "rhythm-led"
  | "counterpoint-led"
  | "dynamic-contrast"
  | "motif-led"

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
  /**
   * 和声を漂わせる度合い(0〜1、0.5 が中立)。音像の奥行き・余韻とジャンルの持続から決める。
   * 高いほど、背景の和音に付加音を残し、半音で動く声部と共通音の保持を選び、低音を保続させやすい(Delius 的な空間)。
   * 音を足すのではなく、今ある音の置き方・持続・和声の色だけを変える。
   */
  harmonicHaze?: number
  /**
   * 主旋律の休みで、既にあるパートが核のリズムを一度だけ受け継ぐか(Schumann / Brahms 的な受け渡し)。
   * 1セクションに1回まで。新しいパートは足さない。
   */
  motifEcho?: "inner" | "bass"
}

export interface ArrangementPlan {
  version: "1.0.0"
  brief: string
  /** ユーザー入力に対する再現可能な生成バッチのseed。 */
  seed: number
  /** 候補プール内で実際に採用された候補のseed。 */
  candidateSeed?: number
  candidateApproach?: ArrangementCandidateApproach
  directive?: ArrangementGenerationDirective
  sections: ArrangementSectionPlan[]
}

export interface ArrangementBarRange {
  /** 1始まり・両端を含む小節範囲。 */
  startBar: number
  endBar: number
}

/**
 * AI相談で確定した曲中位置の制約。
 * 主旋律そのものを書き換えず、再生・生成・書き出しの最終段で適用する。
 */
export interface ArrangementTimelineConstraints {
  preserveMelody: boolean
  fullSilenceRanges: ArrangementBarRange[]
  melodySilenceRanges: ArrangementBarRange[]
  melodyStartBar?: number
}

export type ArrangementStructureChange =
  | {
      kind: "resize-section"
      sectionId: string
      sectionName: string
      lengthBars: number
    }
  | {
      kind: "remove-section"
      sectionId: string
      sectionName: string
    }
  | {
      kind: "duplicate-section"
      sectionId: string
      sectionName: string
      copies: number
    }
  | {
      kind: "move-section"
      sectionId: string
      sectionName: string
      anchorSectionId: string
      anchorSectionName: string
      position: "before" | "after"
    }

export interface ArrangementGenerationDirective {
  sectionId?: string
  intention: string
  character?: "minimal" | "cinematic" | "rhythmic" | "dark-experimental" | "balanced"
  energyDelta?: number
  add?: ArrangementTrackId[]
  preserve?: ArrangementTrackId[]
  surpriseLevel?: number
  timelineConstraints?: ArrangementTimelineConstraints
  /** AI相談から実際のSection編集へ変換した、曲固有ID付きの構成変更。 */
  structureChanges?: ArrangementStructureChange[]
  /** 自然文の音像指定を実音へ渡す、Generator共通の構造化指示。 */
  soundInstruction?: ArrangementSoundInstruction
}

export interface GeneratedArrangementNote extends MelodyNote {
  sectionId: string
  character: ArrangementCandidateCharacter
  reason: string
  /** 既存音の距離と輪郭。音色やパートの追加とは独立したSound Image。 */
  soundImage?: { depth: number; decay: number; transientSoftness: number; stereoDiffusion: number }
}

export interface GeneratedArrangementTrack {
  id: ArrangementTrackId
  name: string
  family: "drums" | "bass" | "synth" | "strings" | "transition"
  muted: boolean
  notes: GeneratedArrangementNote[]
  generationRevision: number
  purpose: string
  performance?: ArrangementTrackPerformance
}

export type ArrangementPerformanceArc =
  | "restrained"
  | "breathe"
  | "build"
  | "release"
  | "withdraw"

export interface ArrangementSectionPerformancePlan extends PerformanceExecutionPlan {
  sectionId: string
  arc: ArrangementPerformanceArc
  diagnostics: PerformanceExecutionDiagnostics
}

export interface ArrangementTrackPerformance {
  version: "1.0.0"
  applied: boolean
  changedVelocityCount: number
  changedDurationCount: number
  changedOnsetCount: number
  sectionPlans: ArrangementSectionPerformancePlan[]
}

export interface FullSongArrangement {
  version: "1.0.0"
  id: string
  createdAt: string
  analysis: ArrangementAnalysis
  plan: ArrangementPlan
  tracks: GeneratedArrangementTrack[]
  quality?: ArrangementQualityReport
  selection?: ArrangementSelectionDiagnostics
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
    /** 背景パッド／ストリングスが同一声部で不要に大きく跳ぶ回数。 */
    largeSupportLeapCount: number
    /** 最も疎なSectionと最も密なSectionの音数差。 */
    densityContrastRatio: number
    harmonicViolationCount: number
    melodyCollisionCount: number
    /** 主旋律のアタックを覆う、必須ではないKick/Fillの回数。 */
    rhythmLeadAttackConflictCount: number
    energyDensityCorrelation: number
    averageActiveRoleCount: number
    generatedNotesPerBeat: number
  }
  recommendations: string[]
}

export interface ArrangementCandidateSummary {
  seed: number
  approach: ArrangementCandidateApproach
  qualityScore: number
  originalityScore: number
  intentionFitScore: number
  selectionScore: number
  selected: boolean
  reason: string
}

export interface ArrangementSelectionDiagnostics {
  poolSize: number
  qualityFloor: number
  eligibleCount: number
  selectedSeed: number
  candidates: ArrangementCandidateSummary[]
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
