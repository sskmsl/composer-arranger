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

export type DecorationType = "decorative-fill" | "transition-fill" | "ending-fill"
export type DecorationCharacter = "strings" | "bell" | "piano" | "generic"
export type DecorationShape =
  | "rising"
  | "falling"
  | "sequence"
  | "repeated-sequence"
  | "turn"
  | "neighbor-motion"
  | "arpeggiated-fill"
  | "suspense"
  | "sparse-accent"
export type DecorationRhythmStyle =
  | "eighth"
  | "sixteenth"
  | "triplet"
  | "syncopation"
  | "dotted"
  | "legato"
  | "staccato"

export type DecorationGestureRole =
  | "response"
  | "transition"
  | "ending"
  | "swell"
  | "pedal"
  | "pickup"

export type DecorationNeedLevel = "recommended" | "optional" | "silence"

export interface DecorationPlan {
  type: DecorationType
  character: DecorationCharacter
  shape: DecorationShape
  rhythmStyle: DecorationRhythmStyle
  direction: "rising" | "falling" | "mixed"
  density: "sparse" | "normal" | "rich"
  lengthBeats: number
  register: "low" | "middle" | "high"
  placementBeat: number
  targetPitchClass: number
  intention: string
  /** 旧保存データでは未定義。Typeより具体的な音楽上の役割。 */
  gestureRole?: DecorationGestureRole
  /** Phrase解析で選んだ配置基準点。 */
  phraseBoundaryBeat?: number
  /** Arrangement密度を含む装飾必要度。 */
  needLevel?: DecorationNeedLevel
  /** Favorite / Reject履歴との一致度(0–100)。 */
  preferenceMatch?: number
}

export interface DecorationStructureContext {
  sectionId: string
  sectionRole: string
  chords: Pick<
    import("./project").ChordEvent,
    "startBeat" | "durationBeats" | "symbol" | "bass"
  >[]
  totalBeats: number
  previousSectionRole?: string
  nextSectionRole?: string
  nextSectionFirstChord?: string
  isLastSection: boolean
}

/** 保存候補と現在のSection構造を比較するための決定論的fingerprint。 */
export function decorationStructureFingerprint(
  context: DecorationStructureContext,
): string {
  const text = JSON.stringify({
    sectionId: context.sectionId,
    sectionRole: context.sectionRole,
    chords: context.chords.map((chord) => [
      chord.startBeat,
      chord.durationBeats,
      chord.symbol,
      chord.bass,
    ]),
    totalBeats: context.totalBeats,
    previousSectionRole: context.previousSectionRole,
    nextSectionRole: context.nextSectionRole,
    nextSectionFirstChord: context.nextSectionFirstChord,
    isLastSection: context.isLastSection,
  })
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

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
  parallelLargeLeapCount?: number
  hasBlockingCollision: boolean
}

export interface ReactiveLayerCompatibility {
  combinedNoteCount: number
  maximumNoteCount: number
  samePitchOverlapBeats: number
  minorSecondOverlapBeats: number
  unresolvedToneNoteIds: string[]
  hasBlockingConflict: boolean
  reasons: string[]
}

export interface ReactiveLayerCandidate {
  id: string
  batchId: string
  sectionId: string
  /** Counter生成時に参照したActive Melody。Structure DrivenのDecorationではnull。 */
  targetMelodyVariantId: string | null
  kind: ReactiveLayerKind
  role: ReactiveLayerRole
  /** Counter Generatorの音楽的キャラクター。Decorationでは未指定。 */
  generatorStyle?: CounterGeneratorStyle
  decorationPlan?: DecorationPlan
  /** Decoration生成時に参照したSection構造。構成変更時のstale判定に使う。 */
  structureFingerprint?: string
  name: string
  notes: MelodyNote[]
  seed: number
  quality: ReactiveLayerQualityBreakdown
  collisions: ReactiveLayerCollisionSummary
  selectionReason?: "highest-quality" | "quality-diversity-balance" | "regenerated"
  /** Technique実験が指定された場合の生成意図適合度(0–1)。 */
  techniqueFitScore?: number
  /** Draft Techniqueを昇格せず同一seedで比較した一時A/B候補。 */
  techniqueExperiment?: {
    presetId: string
    presetLabel: string
    mode: "baseline" | "treatment"
    techniqueNames: string[]
  }
  reviewState?: "favorite" | "rejected" | null
  createdAt: string
}
