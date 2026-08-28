import type {
  ContentStructureFeatures,
  ContentQualityBreakdown,
  ContentSelectionDiagnostics,
  ResolvedLeadContent,
  SectionContentPlan,
  SectionLayer,
} from "./sectionContent"
import type { ArrangementNecessity } from "./arrangementSurprise"

export type LockKind = "pitch" | "rhythm" | "startPosition" | "ending"

export interface MelodyNote {
  id: string
  /** セクション先頭からの相対拍位置 */
  startBeat: number
  durationBeats: number
  pitch: number
  velocity: number
  locks: LockKind[]
  /** 第1段階多様性改修: 配置前にこの音へ与えられた音楽的役割。再生/MIDIには影響しない内部情報。 */
  plannedToneRole?: PlannedToneRole
  /** 非和声音を保持できる根拠となる解決計画。 */
  plannedResolution?: PlannedResolution
}

export type PlannedToneRole =
  | "chord-tone"
  | "common-tone"
  | "approach-tone"
  | "passing-tone"
  | "neighbor-tone"
  | "appoggiatura"
  | "suspension"
  | "anticipation"
  | "tension-hold"
  | "unresolved-conflict"

export interface PlannedResolution {
  targetPitchClass: number
  targetBeat: number
  maximumDelayBeats: number
}

export type PitchCorrectionReason =
  | "range-octave-adjustment"
  | "midi-range-clamp"
  | "unresolved-strong-beat-conflict"
  | "unresolved-harmonic-conflict"

export interface PitchCorrectionDiagnostic {
  beat: number
  rawPitch: number
  placedPitch: number
  role: PlannedToneRole
  reason: PitchCorrectionReason
}

export interface PlannedToneDiagnostic {
  beat: number
  durationBeats: number
  rawPitch: number
  placedPitch: number
  role: PlannedToneRole
  resolution?: PlannedResolution
}

export interface MelodySimilarityBreakdown {
  openingSimilarity: number
  intervalSimilarity: number
  rhythmSimilarity: number
  contourSimilarity: number
  phraseSimilarity: number
  climaxSimilarity: number
  cadenceSimilarity: number
  harmonicResponseSimilarity: number
  registerSimilarity: number
  densitySimilarity: number
  overallSimilarity: number
}

export type CandidateSelectionReason =
  | "highest-quality"
  | "quality-diversity-balance"
  | "diversity-threshold-relaxed"
  | "insufficient-diversity-fallback"
  | "below-quality-floor"
  | "not-selected"

export interface CandidateGenerationDiagnostics {
  batchBaseSeed: number
  candidateSeed: number
  candidatePoolIndex: number
  openingRegenerationAttempts: number
  qualityScore: number
  profileFitScore: number
  /** 解決済みTechnique Ruleと候補DNAの適合度(0..1)。Ruleがない場合は未定義。 */
  techniqueFitScore?: number
  selectionScore: number | null
  selected: boolean
  reason: CandidateSelectionReason
  similarityToSelected: MelodySimilarityBreakdown[]
  plannedTones: PlannedToneDiagnostic[]
  changedPitchCount: number
  corrections: PitchCorrectionDiagnostic[]
  rawNotesHash: string
  placedNotesHash: string
  finalNotesHash: string
  candidateMelodyDNA?: CandidateMelodyDNA
}

export type PhraseContour = "ascending" | "descending" | "arch" | "inverted-arch" | "wave"

export interface PhrasePlan {
  phraseStartBeat: number
  phraseLengthBeats: number
  climaxBeat: number
  contour: PhraseContour
  restBeats: number[]
  /** 0=完全解決 / 1=強い緊張を残す(フレーズ末尾の緊張度) */
  endTension: number
}

export interface MelodyFeatures {
  rangeLow: number
  rangeHigh: number
  maxLeap: number
  avgLeap: number
  restRatio: number
  repeatedNoteRatio: number
  tensionUsageRatio: number
  chordToneUsageRatio: number
  syncopationRatio: number
  motifRepeatRatio: number
  /** フレーズ最高音の位置(0=先頭 〜 1=末尾) */
  peakPosition: number
  /** Issue #64: 5半音以上の跳躍のうち、直後に反行かつ3半音以内の順次進行で回収された割合(跳躍が無ければ1) */
  leapRecoveryRatio: number
}

export type MelodySourceMode =
  | "generate"
  | "develop-seed"
  | "improve"
  | "regenerate-range"
  | "import-midi"

export interface RangeRegenerationLocks {
  pitch: boolean
  rhythm: boolean
  motif: boolean
  opening: boolean
  ending: boolean
}

export interface RangeRegenerationMetadata {
  range: { startBeat: number; endBeat: number }
  locks: RangeRegenerationLocks
  candidatePoolIndex: number
  qualityScore: number
}

/**
 * Melody Candidate Diversity v1.2: 作曲文法そのものを切り替える生成器プロファイル。
 * Song Profile(曲全体の感情方向)やSection Role(セクション別ルール)とは独立した軸。
 * 固有名詞・特定ジャンル名は使わず、旋律語彙として抽象化した名称のみを用いる。
 */
export type MelodyGeneratorProfile =
  | "standard"
  | "minimal"
  | "leaping"
  | "rhythmic"
  | "chromatic"
  | "cinematic"
  | "elegiac-cantabile"
  | "speech-rhythmic"
  | "incantatory"

/** 曲/プロジェクト内でのProfileの位置づけ(将来の推奨表示・警告表示のためのデータ構造。今回は自動制限しない) */
export type GeneratorProfileRole = "primary" | "secondary" | "accent"

/** 各Generator Profile固有の追加メトリクス(3.x/4.x/5.x章の受け入れ条件・スコアリングに対応) */
export interface AdvancedMelodyMetrics {
  stepwiseMotionRatio?: number
  appoggiaturaRatio?: number
  delayedResolutionRatio?: number
  climaxUniqueness?: number
  phraseArcLength?: number

  pickupRatio?: number
  phraseAsymmetry?: number
  speechContourAmount?: number
  finalMelodicLift?: number

  motifMutationRatio?: number
  cyclicPhraseAmount?: number
  mutationPeriodicity?: number
  contourRetention?: number
}

/** Speech-Rhythmic用の仮想Prosody情報(実際の歌詞解析は対象外。生成計画として内部的に保持する) */
export interface ProsodySlot {
  beat: number
  durationBeats: number
  accent: "primary" | "secondary" | "none"
}

export interface ProsodyPlan {
  syllableSlots: ProsodySlot[]
  breathPositions: number[]
}

/**
 * Melody Opening Intent(冒頭設計): 各候補に異なる「曲の始まり方・感情的入口」を与えるための計画。
 * ノートを生成する前にこれを先に決め、Opening Plan → 本体生成へと展開する。
 * (最初に音符を作ってから開始音だけ差し替えるのではなく、入口の意図から生成を分岐させる)
 */
export type OpeningEntryType = "direct" | "pickup" | "delayed" | "suspension" | "repeated-note" | "leap-entry"
export type OpeningEmotionalFunction = "statement" | "question" | "hesitation" | "invocation" | "warning" | "release"
export type OpeningRegister = "low" | "middle" | "high"
export type OpeningInitialDirection = "ascending" | "descending" | "static"
export type OpeningContour = "stepwise" | "leap-then-recover" | "repeated-note" | "pickup-resolution" | "suspension-entry"

export interface MelodyOpeningIntent {
  entryType: OpeningEntryType
  emotionalFunction: OpeningEmotionalFunction
  register: OpeningRegister
  initialDirection: OpeningInitialDirection
}

/** Opening Intentを具体的な音楽情報へ落とし込んだ計画。冒頭フレーズの生成を駆動する */
export interface MelodyOpeningPlan {
  intent: MelodyOpeningIntent
  startPitchClass: number
  startScaleDegree: number
  startBeatOffset: number
  firstNoteDuration: number
  initialDirection: OpeningInitialDirection
  openingContour: OpeningContour
  openingRegister: { lowestMidiNote: number; highestMidiNote: number }
  openingPhraseLengthBeats: number
}

/** 候補全体の物語を、ノート生成前に分岐させるためのPattern固有DNA。 */
export type MotifIdentity =
  | "stepwise-cell"
  | "leap-recovery"
  | "repeated-cell"
  | "turn-cell"
  | "chromatic-cell"
export type RhythmGrammar = "sustained" | "balanced" | "syncopated" | "speech-like" | "cyclic"
export type PhraseArchitecture = "balanced" | "call-response" | "long-arc" | "asymmetric" | "cyclic"
export type HarmonicResponse = "chord-following" | "common-tone" | "anticipatory" | "delayed-resolution" | "tension-hold"
export type RegisterTrajectory = "rising" | "falling" | "arch" | "terraced" | "contained"
export type MotifDevelopmentStrategy =
  | "literal-return"
  | "sequence"
  | "fragmentation"
  | "augmentation"
  | "delayed-return"
export type ClimaxType = "pitch-peak" | "rhythmic-peak" | "tension-peak"
export type ClimaxPosition = "early" | "middle" | "late"
export type MelodyEndingStrategy = "resolved" | "open" | "suspended" | "carry-forward"

/** Issue #30: 前後セクションの境界で採る、旋律上の接続方針。 */
export type SectionTransitionStrategy =
  | "resolved"
  | "suspended"
  | "open"
  | "carry-over"
  | "pickup-to-next"
  | "motif-call-response"

/**
 * 次セクションの候補へ保存する接続計画。
 * contextFingerprint は、生成時に参照した前セクションのActive Melodyが
 * 現在も同じかを判定するためのスナップショットで、古い候補の自動書き換えには使わない。
 */
export interface MelodyTransitionPlan {
  strategy: SectionTransitionStrategy
  sourceSectionId: string
  sourceVariantId: string
  contextFingerprint: string
  transitionFitScore: number
  pitchContinuityScore: number
  rhythmContinuityScore: number
  tensionResolutionScore: number
  motifRelationScore: number
  registerTrajectoryScore: number
  /** 境界を越えて前セクション終音を保持する長さ。曲全体Preview/MIDIで同一に実音化する。 */
  sustainAcrossBoundaryBeats: number
  /** pickup-to-next の場合に、境界直前へ追加する弱起音。 */
  pickup?: {
    pitch: number
    durationBeats: number
    velocity: number
  }
}

export interface CandidateMelodyDNA {
  motifIdentity: MotifIdentity
  rhythmGrammar: RhythmGrammar
  phraseArchitecture: PhraseArchitecture
  harmonicResponse: HarmonicResponse
  registerTrajectory: RegisterTrajectory
  developmentStrategy: MotifDevelopmentStrategy
  climaxPlan: {
    type: ClimaxType
    position: ClimaxPosition
    /** セクション全長に対する頂点位置(0..1)。 */
    targetFraction: number
  }
  endingStrategy: MelodyEndingStrategy
}

export type ElegiacClimaxType = "longest-note" | "leap" | "tension" | "silence" | "low-return"
export type ElegiacEndingStrategy = "resolved" | "suspended" | "open" | "carry-over"
export type ElegiacDevelopmentOperation = "repeat" | "fragmentation" | "expansion" | "delayed-return"
export type ElegiacTensionArc = "inward-resolution" | "yearning-delay" | "suspended-ache" | "anticipatory-pull"

/** Elegiac Cantabile専用生成器が、実音を作る前に確定する旋律設計。 */
export interface ElegiacGenerationPlan {
  motifSeed: {
    intervals: number[]
    durations: number[]
  }
  phraseLengths: number[]
  breathBeats: number[]
  climaxType: ElegiacClimaxType
  climaxBeat: number
  endingStrategy: ElegiacEndingStrategy
  tensionArc: ElegiacTensionArc
  targetTones: {
    beat: number
    pitchClass: number
  }[]
  development: ElegiacDevelopmentOperation[]
}

export type ProfileExpressionArc =
  | "chromatic-neighbor"
  | "chromatic-suspension"
  | "chromatic-anticipation"
  | "chromatic-tension-pedal"
  | "cinematic-slow-bloom"
  | "cinematic-midpoint-surge"
  | "cinematic-breath-before-peak"
  | "cinematic-low-reprise"
  | "leaping-early-call"
  | "leaping-delayed-call"
  | "leaping-downward-release"
  | "leaping-echo"

/** Chromatic / Cinematic / Leaping専用の候補別表現計画。 */
export interface ProfileExpressionPlan {
  profile: "chromatic" | "cinematic" | "leaping"
  arc: ProfileExpressionArc
  focusBeat: number
}

/**
 * Song Motif DNA(将来拡張のための土台。今回は完全実装ではなく、
 * セクション間でモチーフ情報を共有できる構造だけを用意する)
 */
export interface SongMotifDNA {
  /** 頻出する音程差(半音、正負つき)の代表値 */
  intervalCells: number[]
  /** 頻出する音価(拍)の代表値 */
  rhythmCells: number[]
  repeatedNoteTendency: number
  approachNoteTendency: number
  /** -1(下降傾向)〜+1(上昇傾向) */
  contourTendency: number
  /** 0(解決終止傾向)〜1(非解決終止傾向) */
  phraseEndingTendency: number
  characteristicRests: number[]
  climaxDirection: "ascending" | "descending"
}

export interface MelodyVariant {
  id: string
  name: string
  sectionId: string
  sourceMode: MelodySourceMode
  notes: MelodyNote[]
  phrasePlans: PhrasePlan[]
  lockedBars: number[]
  motifLocked: boolean
  features: MelodyFeatures | null
  generatorVersion: string
  seed: number
  songProfile: string
  parentMelodyId: string | null
  /** 同時生成された候補群をグルーピングするためのID */
  batchId: string
  createdAt: string
  /** 候補整理とAuditionで共有するユーザー判定。 */
  reviewState?: "favorite" | "rejected" | null
  /** 部分再生成候補が保持した範囲・要素と選抜情報。 */
  rangeRegeneration?: RangeRegenerationMetadata
  /** Melody Candidate Diversity v1.2: この候補を生成したGenerator Profile */
  generatorProfile?: MelodyGeneratorProfile
  /** 同一Profile内での独立Pattern番号(1〜3)。優先順位や派生関係は持たない */
  patternIndex?: 1 | 2 | 3
  advancedMetrics?: AdvancedMelodyMetrics
  prosodyPlan?: ProsodyPlan
  /** この候補の冒頭設計(3案を冒頭数秒で別案として区別するための入口意図) */
  openingIntent?: MelodyOpeningIntent
  /** 冒頭以降を含む候補全体のPattern固有設計。 */
  candidateMelodyDNA?: CandidateMelodyDNA
  /** Elegiac Cantabile専用のMotif/Phrase/Climax/Ending設計。 */
  elegiacPlan?: ElegiacGenerationPlan
  /** Profile固有の緊張・展開・回収曲線。 */
  profileExpressionPlan?: ProfileExpressionPlan
  /** Issue #30: 前セクションのActive Melodyを参照して生成した接続計画。 */
  transitionPlan?: MelodyTransitionPlan
  /** UIへ常時表示しない、生成・選抜を追跡するための内部診断情報。 */
  generationDiagnostics?: CandidateGenerationDiagnostics
  /** Draft Techniqueを昇格せず同一seedで比較した一時A/B候補。 */
  techniqueExperiment?: {
    presetId: string
    presetLabel: string
    mode: "baseline" | "treatment"
    techniqueNames: string[]
  }

  /**
   * Issue #41: この候補が提示するリード内容(melody以外も取り得る)。
   * 旧候補には無いため任意。読み出しは resolvedLeadContent() を使う。
   */
  leadContent?: ResolvedLeadContent
  /**
   * Issue #41: 実音の前に決めた構造計画。同一content内の3案がここで既に異なる。
   */
  contentPlan?: SectionContentPlan
  /**
   * Issue #41: partRoleの正。MIDIのトラック/チャンネル分割はこの値から決まる。
   * 第1段階では長さ1だが、将来 motif + ostinato の重ね合わせでLayerを追加する。
   * notes は全Layerのノートを平坦化した派生値として保持する(既存UI・再生経路の互換用)。
   */
  layers?: SectionLayer[]
  /** Issue #41: content別の構造特徴量(Structural Validationと候補間比較に使う)。 */
  contentFeatures?: ContentStructureFeatures
  /** Issue #63: AutoがこのContent候補を採用した根拠。 */
  contentQuality?: ContentQualityBreakdown
  contentSelection?: ContentSelectionDiagnostics
  /** Generator横断のSafe / Surprise評価と、その音楽的根拠。 */
  arrangementNecessity?: ArrangementNecessity
}
