export type LockKind = "pitch" | "rhythm" | "startPosition" | "ending"

export interface MelodyNote {
  id: string
  /** セクション先頭からの相対拍位置 */
  startBeat: number
  durationBeats: number
  pitch: number
  velocity: number
  locks: LockKind[]
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
}
