import type { Density, Drama } from "@/melody-engine/generationParams"
import type { MelodyFeatures } from "@/core/melody"

export type AiArrangementGenerator =
  | "melody"
  | "phrase"
  | "signature"
  | "counter"
  | "decoration"
  | "accompaniment"
  | "rhythm"
  | "none"

export type AiAccompanimentPatternId =
  | "pulse-root-fifth"
  | "arpeggio-up"
  | "chord-entry"
  | "arpeggio-five"
  | "arpeggio-six"
  | "broken-ninth"
  | "syncopated"
  | "none"

export type AiRegister = "low" | "middle" | "high"
export type AiMotion = "ascending" | "descending" | "wave" | "static"
export type AiRhythmCharacter =
  | "spacious"
  | "flowing"
  | "syncopated"
  | "pulsed"
  | "fragmented"
export type AiSilenceStrategy = "minimal" | "breathing" | "structural"
export type AiCreativeRisk = "focused" | "bold" | "radical"

export interface AiSoundSourceSuggestion {
  library: "Native Instruments Komplete 15 Ultimate" | "u-he Repro"
  product: string
  family: string
  character: string
  searchTerms: string[]
  reason: string
}

export type AiRhythmInstrument =
  | "kick"
  | "snare"
  | "closed-hat"
  | "open-hat"
  | "clap"
  | "rim"
  | "low-percussion"
  | "high-percussion"

export interface AiRhythmStepEvent {
  instrument: AiRhythmInstrument
  /** ループ先頭を0とする四分音符単位の位置。 */
  onsetBeat: number
  durationBeats: number
  velocity: number
}

export interface AiRhythmPatternProposal {
  enabled: boolean
  subdivision: "eighth" | "sixteenth" | "triplet" | "mixed"
  feel: "straight" | "swing" | "laid-back" | "driving" | "broken"
  kickPattern: string
  snarePattern: string
  hatPattern: string
  percussionPattern: string
  variation: string
  /** 構造化イベントを繰り返す基本単位。 */
  bars: 1 | 2
  events: AiRhythmStepEvent[]
}

export interface AiArrangementIntent {
  id: string
  title: string
  generator: AiArrangementGenerator
  emotionalFunction: string
  density: Density
  register: AiRegister
  drama: Drama
  motion: AiMotion
  rhythmCharacter: AiRhythmCharacter
  silenceStrategy: AiSilenceStrategy
  creativeRisk: AiCreativeRisk
  lengthBars: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  techniques: string[]
  soundPalette: string
  performanceDirection: string
  why: string
  generationBrief: string
  soundSourceSuggestions: AiSoundSourceSuggestion[]
  accompanimentPatternId: AiAccompanimentPatternId
  rhythmPlan: AiRhythmPatternProposal
}

export interface AiArrangementDiagnosis {
  currentStrength: string
  primaryOpportunity: string
  protect: string[]
  avoid: string[]
  noAdditionRecommended: boolean
  audioEvidence: string[]
  audioConfidenceNote: string
}

export interface AiAudioLocalFeatures {
  durationSeconds: number
  sampleRate: number
  channelCount: number
  energyCurve: number[]
  silenceRatio: number
  dynamicRange: number
  transientDensity: number
  peakPosition: number
}

export interface AiAudioPayload {
  fileName: string
  mimeType: string
  format: "mp3" | "wav"
  sizeBytes: number
  dataBase64: string
  localFeatures: AiAudioLocalFeatures
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  estimatedCostUsd: number
}

export interface AiArrangementResponse {
  requestId: string
  createdAt: string
  model: string
  /** 最新の相談へ直接答える、会話表示用の短い返答。 */
  partnerReply: string
  /** 後続ターンでも維持する、現在有効な制約の完全な一覧。 */
  confirmedConstraints: string[]
  diagnosis: AiArrangementDiagnosis
  intents: [AiArrangementIntent, AiArrangementIntent, AiArrangementIntent]
  usage: AiUsage
  cached?: boolean
}

export interface AiPartnerConversationTurn {
  id: string
  createdAt: string
  userMessage: string
  partnerReply: string
  confirmedConstraints: string[]
  directions: AiConversationContextTurn["directions"]
}

export interface AiPartnerSession {
  sectionId: string
  updatedAt: string
  confirmedConstraints: string[]
  turns: AiPartnerConversationTurn[]
  /** 画面復元に必要な最新案だけを保持し、過去ターンは要約して同期容量を抑える。 */
  latestResponse?: AiArrangementResponse
}

export interface AiConversationContextTurn {
  userMessage: string
  partnerReply: string
  confirmedConstraints: string[]
  directions: Array<{
    title: string
    generator: AiArrangementGenerator
    emotionalFunction: string
    generationBrief: string
  }>
}

export interface AiConversationContext {
  confirmedConstraints: string[]
  turns: AiConversationContextTurn[]
}

export type AiArrangementConstitutionPrincipleId =
  | "melody-sovereignty"
  | "narrative-necessity"
  | "contrast-over-density"
  | "ritual-and-mutation"
  | "meaningful-silence"
  | "delayed-payoff"
  | "integrated-space"
  | "emotional-specificity"

export interface AiArrangementConstitutionContext {
  version: string
  priorityOrder: readonly string[]
  principles: ReadonlyArray<{
    id: AiArrangementConstitutionPrincipleId
    directive: string
  }>
}

export type ArrangementDirectorFunction =
  | "establish"
  | "develop"
  | "lift"
  | "declare"
  | "suspend"
  | "transform"
  | "release"

export type ArrangementDirectorClimaxPolicy =
  | "reserve"
  | "approach"
  | "express"
  | "recover"

export interface ArrangementDirectorSectionPlan {
  sectionId: string
  sectionName: string
  sectionRole: string
  order: number
  narrativeFunction: ArrangementDirectorFunction
  targetEnergy: 1 | 2 | 3 | 4 | 5
  densityCeiling: number
  existingLayerCount: number
  additionBudget: number
  registerFocus: "low" | "low-middle" | "middle" | "middle-high" | "full"
  silenceStrategy: AiSilenceStrategy
  climaxPolicy: ArrangementDirectorClimaxPolicy
  protect: string[]
  introduce: string[]
  withhold: string[]
  transitionIntent: string
}

export interface ArrangementDirectorBlueprint {
  version: string
  arcSummary: string
  climaxSectionId: string | null
  globalProtect: string[]
  reservedForClimax: string[]
  sections: ArrangementDirectorSectionPlan[]
}

export type ArrangementReviewStatus = "pending" | "strong" | "watch" | "revise"
export type ArrangementReviewSeverity = "pass" | "notice" | "warning" | "blocking"

export interface ArrangementReviewFinding {
  id: string
  severity: ArrangementReviewSeverity
  principleId: AiArrangementConstitutionPrincipleId
  title: string
  evidence: string
  recommendation: string
}

export interface ArrangementSectionReview {
  version: string
  sectionId: string
  status: ArrangementReviewStatus
  score: number
  summary: string
  metrics: {
    densityUtilization: number
    silenceRatio: number
    blockingCollisionCount: number
    protectedMomentOverlapBeats: number
    climaxResourceRisk: boolean
  }
  findings: ArrangementReviewFinding[]
  reviewedSourceIds: string[]
}

export interface WholeSongArrangementFinding extends ArrangementReviewFinding {
  sectionIds: string[]
}

export interface WholeSongArrangementReview {
  version: string
  status: ArrangementReviewStatus
  score: number
  summary: string
  metrics: {
    reviewedSectionCount: number
    pendingSectionCount: number
    blockingSectionCount: number
    energyContrastScore: number
    repeatedSupportPatternCount: number
    climaxReservationRiskCount: number
  }
  findings: WholeSongArrangementFinding[]
}

export type OrchestrationRole =
  | "lead-focus"
  | "harmonic-space"
  | "pulse-foundation"
  | "counter-voice"
  | "transition-color"
  | "intentional-silence"

export type OrchestrationFamily =
  | "lead-voice"
  | "piano-keys"
  | "strings"
  | "analog-synth"
  | "atmospheric-pad"
  | "mallet-bell"
  | "percussion"
  | "silence"

export type OrchestrationDistance = "intimate" | "near" | "middle" | "distant"
export type OrchestrationArticulation =
  | "legato"
  | "sustained"
  | "pulsed"
  | "detached"
  | "swelling"
  | "decaying"
export type PerformanceTiming = "strict" | "slightly-ahead" | "slightly-behind" | "floating"
export type OrchestrationSourceState = "active" | "recommended"

export interface OrchestrationPartPlan {
  id: string
  role: OrchestrationRole
  family: OrchestrationFamily
  sourceState: OrchestrationSourceState
  register: ArrangementDirectorSectionPlan["registerFocus"]
  distance: OrchestrationDistance
  articulation: OrchestrationArticulation
  dynamic: "pp" | "p" | "mp" | "mf" | "f"
  velocityRange: readonly [number, number]
  timing: PerformanceTiming
  entry: string
  exit: string
  purpose: string
}

export interface SectionOrchestrationPlan {
  sectionId: string
  maxSimultaneousParts: number
  performanceArc: string
  parts: OrchestrationPartPlan[]
  withheldGestures: string[]
}

export interface ArrangementOrchestrationBlueprint {
  version: string
  sections: SectionOrchestrationPlan[]
}

export interface OrchestrationMaskingReview {
  version: string
  sectionId: string
  status: ArrangementReviewStatus
  score: number
  summary: string
  metrics: {
    foregroundCompetitionCount: number
    dynamicMaskingCount: number
    familyDuplicationCount: number
    registerCrowdingCount: number
  }
  findings: Array<{
    id: string
    severity: ArrangementReviewSeverity
    title: string
    evidence: string
    recommendation: string
    partIds: string[]
  }>
}

export interface AudibleLayerCollisionReview {
  version: string
  sectionId: string
  status: ArrangementReviewStatus
  score: number
  summary: string
  metrics: {
    reviewedSupportLayerCount: number
    samePitchOverlapBeats: number
    semitoneOverlapBeats: number
    protectedAttackCount: number
    simultaneousAttackCount: number
    supportCollisionBeats: number
  }
  findings: Array<{
    id: string
    severity: ArrangementReviewSeverity
    title: string
    evidence: string
    recommendation: string
    sources: string[]
  }>
}

export interface AiArrangementContext {
  /** AI・将来のDirector・各Generatorが共有する、固有名を含まない最上位判断原則。 */
  arrangementConstitution: AiArrangementConstitutionContext
  /** 曲全体の役割配分。現在Sectionの局所最適より先に参照する。 */
  arrangementDirector: ArrangementDirectorBlueprint
  /** 現在Set Activeされている実音をConstitutionとDirectorへ照合した結果。 */
  arrangementReview: ArrangementSectionReview
  /** 全Sectionを横断し、局所的に良い案の並置で曲が平坦になる問題を検出する。 */
  wholeSongArrangementReview: WholeSongArrangementReview
  /** Directorの役割・密度を、楽器距離・奏法・強弱・登退場へ変換した実行計画。 */
  orchestration: ArrangementOrchestrationBlueprint
  orchestrationReview: OrchestrationMaskingReview
  /** 実際のPreview/MIDI材料を使い、主旋律と採用済み補助レイヤーの実音衝突を測る。 */
  audibleLayerReview: AudibleLayerCollisionReview
  project: {
    title: string
    key: string
    tempo: number
    timeSignature: string
    songProfile: string
  }
  section: {
    id: string
    name: string
    role: string
    lengthBars: number
    previousRole: string | null
    nextRole: string | null
  }
  chords: Array<{
    startBeat: number
    durationBeats: number
    symbol: string
    bass: string | null
  }>
  activeMelody: {
    present: boolean
    noteCount: number
    notes: Array<{
      startBeat: number
      durationBeats: number
      pitch: number
      velocity: number
    }>
    features: MelodyFeatures | null
  }
  arrangement: {
    settings: Record<string, number | string>
    accompanimentPatternAssigned: boolean
    assignedAccompanimentPatternId: string | null
    availableAccompanimentPatterns: Array<{
      id: string
      name: string
      lengthBeats: number
      onsetBeats: number[]
      degreeSequence: number[]
    }>
    counterAssigned: boolean
    decorationAssigned: boolean
  }
  techniquePreferences: Record<string, string[]>
}

export interface AiArrangementRequest {
  prompt: string
  context: AiArrangementContext
  conversation?: AiConversationContext
  audio?: AiAudioPayload
}
