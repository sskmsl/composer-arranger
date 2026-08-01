import type { MelodyNote, PhraseContour } from "./melody"

export type SignaturePhraseRole =
  | "intro"
  | "interlude"
  | "outro"
  | "transition"
  | "instrumental-hook"

export type SignaturePhraseLengthBars = 1 | 2 | 4

export type SignatureRhythmIdentity =
  | "opening-stamp"
  | "pickup-hook"
  | "syncopated-cell"
  | "call-gap-answer"
  | "long-short-signal"
  | "broken-pulse"

export type SignatureVariationStrategy =
  | "displacement"
  | "fragmentation"
  | "augmentation"
  | "answer"
  | "delayed-return"

/** 実音生成より先に確定する、短いSignature Phrase専用の設計。 */
export interface SignaturePhrasePlan {
  role: SignaturePhraseRole
  lengthBars: SignaturePhraseLengthBars
  rhythmIdentity: SignatureRhythmIdentity
  contour: PhraseContour
  variationStrategy: SignatureVariationStrategy
  motifSize: number
  pickupBeats: number
  /** コードごとの着地を避け、構造点だけ和声へ接続する。 */
  harmonicAnchorPolicy: "structural-only" | "opening-and-ending" | "tension-led"
}

export interface SignaturePhraseScore {
  identity: number
  openingImpact: number
  rhythmicIdentity: number
  contourIdentity: number
  developmentPotential: number
  standaloneStrength: number
  arpeggioPenalty: number
  overall: number
}

export interface SignaturePhraseSimilarity {
  rhythmSimilarity: number
  intervalSimilarity: number
  contourSimilarity: number
  durationSimilarity: number
  planSimilarity: number
  overallSimilarity: number
}

export interface SignaturePhraseCandidate {
  id: string
  sectionId: string
  batchId: string
  name: string
  seed: number
  createdAt: string
  notes: MelodyNote[]
  plan: SignaturePhrasePlan
  phraseLengthBeats: number
  score: SignaturePhraseScore
  selectionScore: number
  similarityToSelected: SignaturePhraseSimilarity[]
}
