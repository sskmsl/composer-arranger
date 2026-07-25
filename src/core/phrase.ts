import type { MelodyNote, MelodySimilarityBreakdown, PhraseContour } from "./melody"

export type PhraseRhythmCharacter = "flowing" | "syncopated" | "breathing" | "sustained"
export type PhraseHarmonicApproach = "chord-anchored" | "common-tone" | "tension-release" | "anticipatory"
export type PhraseCadence = "resolved" | "open" | "suspended" | "carry-forward"

/**
 * 短いフレーズを単なるMelodyの切り詰めにしないため、実音より先に確定する作曲上の解釈。
 * UI入力ではなく、コード進行・Section Role・Song Profileから候補ごとに計画する。
 */
export interface PhraseIntent {
  lengthBars: 2 | 3 | 4
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
  selectionScore: number
  similarityToSelected: MelodySimilarityBreakdown[]
}
