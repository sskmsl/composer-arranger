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
}

export type MelodySourceMode = "generate" | "develop-seed" | "improve"

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
  targetTones: {
    beat: number
    pitchClass: number
  }[]
  development: ElegiacDevelopmentOperation[]
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
  /** UIへ常時表示しない、生成・選抜を追跡するための内部診断情報。 */
  generationDiagnostics?: CandidateGenerationDiagnostics
}
