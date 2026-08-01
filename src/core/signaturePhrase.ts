import type { MelodyNote, PhraseContour } from "./melody"

export type SignaturePhraseRole =
  | "intro"
  | "interlude"
  | "outro"
  | "transition"
  | "instrumental-hook"

export type SignaturePhraseLengthBars = 1 | 2 | 4

/** 固有曲を参照せず、曲の入口を作る方法だけを抽象化した上位設計。 */
export type SignaturePhraseArchetype =
  | "atmospheric-gateway"
  | "obsessive-motor"
  | "kinetic-hook"

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
  archetype: SignaturePhraseArchetype
  rhythmIdentity: SignatureRhythmIdentity
  contour: PhraseContour
  variationStrategy: SignatureVariationStrategy
  motifSize: number
  motifVariant: 0 | 1 | 2 | 3
  pickupBeats: number
  /** 0: 基本形、1: 余白／アクセント変形、2: 回帰位置変形。 */
  rhythmVariant: 0 | 1 | 2
  /** 1に近いほど核Motifを保ち、局所変異だけで推進する。 */
  repetitionStrength: number
  /** 無音を欠落ではなく、Signatureの構成要素として計画する。 */
  targetSilenceRatio: number
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
  worldBuilding: number
  motifMemorability: number
  motifIntegrity: number
  repetitionDrive: number
  silenceUse: number
  arpeggioPenalty: number
  mechanicalPenalty: number
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
