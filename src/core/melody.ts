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
  /** 同時生成された候補群(標準6案)をグルーピングするためのID */
  batchId: string
  createdAt: string
}
