import type { MelodyNote } from "./melody"

/**
 * Issue #42: Active Melodyを変更せず、その周囲へ置く独立Arrangementレイヤー。
 * CounterとDecorationは生成意図が異なるが、保存・衝突評価・Preview/MIDIは同じ基盤を使う。
 */
export type ReactiveLayerKind = "counter" | "decoration"

export type CounterGeneratorStyle =
  | "bell-response"
  | "piano-echo"
  | "string-answer"
  | "guitar-fill"
  | "synth-whisper"

export type ReactiveLayerRole =
  | "answer-phrase"
  | "gap-fill"
  | "counterline"
  | "transition"
  | "cadential-fill"
  | "suspension-layer"
  | "motif-echo"
  | "doubling"

export interface ReactiveLayerQualityBreakdown {
  melodyRespect: number
  harmonicFit: number
  gapUsage: number
  registerSeparation: number
  motifRelationship: number
  sectionFit: number
  transitionValue: number
  overallQuality: number
}

export interface ReactiveLayerCollisionSummary {
  samePitchOverlapBeats: number
  minorSecondOverlapBeats: number
  protectedMomentOverlapBeats: number
  voiceCrossingCount: number
  simultaneousAttackCount: number
  hasBlockingCollision: boolean
}

export interface ReactiveLayerCandidate {
  id: string
  batchId: string
  sectionId: string
  /** 生成・評価時に参照したActive Melody。変更された候補はstaleとして扱う。 */
  targetMelodyVariantId: string
  kind: ReactiveLayerKind
  role: ReactiveLayerRole
  /** Counter Generatorの音楽的キャラクター。Decorationでは未指定。 */
  generatorStyle?: CounterGeneratorStyle
  name: string
  notes: MelodyNote[]
  seed: number
  quality: ReactiveLayerQualityBreakdown
  collisions: ReactiveLayerCollisionSummary
  selectionReason?: "highest-quality" | "quality-diversity-balance" | "regenerated"
  reviewState?: "favorite" | "rejected" | null
  createdAt: string
}
