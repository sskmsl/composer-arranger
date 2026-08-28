import type { MelodyNote, MelodySimilarityBreakdown, PhraseContour } from "./melody"
import type { ArrangementNecessity } from "./arrangementSurprise"

export type PhraseRhythmCharacter = "flowing" | "syncopated" | "breathing" | "sustained"
export type PhraseHarmonicApproach = "chord-anchored" | "common-tone" | "tension-release" | "anticipatory"
export type PhraseCadence = "resolved" | "open" | "suspended" | "carry-forward"
export type PhraseLengthBars = 2 | 3 | 4 | 5 | 6 | 7 | 8
export type PhraseMotifDevelopment =
  | "fragmentation"
  | "delayed-return"
  | "inversion"
  | "augmentation"

/**
 * 短いフレーズを単なるMelodyの切り詰めにしないため、実音より先に確定する作曲上の解釈。
 * UI入力ではなく、コード進行・Section Role・Song Profileから候補ごとに計画する。
 */
export interface PhraseIntent {
  lengthBars: PhraseLengthBars
  contour: PhraseContour
  rhythmCharacter: PhraseRhythmCharacter
  harmonicApproach: PhraseHarmonicApproach
  cadence: PhraseCadence
  density: number
  restRatio: number
  leapAmount: number
  climaxPosition: number
  pickupBeats: number
  motifIntervals: number[]
  motifDurations: number[]
  /** 短い素材でも単純反復へ収束させないためのMotif展開方法。 */
  developmentStrategy?: PhraseMotifDevelopment
}

export interface PhraseCandidate {
  id: string
  sectionId: string
  batchId: string
  name: string
  seed: number
  createdAt: string
  notes: MelodyNote[]
  intent: PhraseIntent
  phraseLengthBeats: number
  qualityScore: number
  /** Technique実験が指定された場合のIntent適合度(0–1)。 */
  techniqueFitScore?: number
  selectionScore: number
  similarityToSelected: MelodySimilarityBreakdown[]
  arrangementNecessity?: ArrangementNecessity
  /** Draft Techniqueを昇格せず同一seedで比較した一時A/B候補。 */
  techniqueExperiment?: {
    presetId: string
    presetLabel: string
    mode: "baseline" | "treatment"
    techniqueNames: string[]
  }
}
