import type { MelodyNote, PhraseContour } from "./melody"
import type {
  DecorationGestureRole,
  DecorationRhythmStyle,
  DecorationShape,
} from "./reactiveLayer"

export type SignaturePhraseRole =
  | "intro"
  | "interlude"
  | "outro"
  | "transition"
  | "instrumental-hook"

export type SignaturePhraseLengthBars = 1 | 2 | 4 | 8

export type SignaturePhraseArchitecture =
  | "identity-return"
  | "question-answer-return"
  | "slow-burn-return"

export type SignatureDevelopmentStage =
  | "establish"
  | "repeat"
  | "answer"
  | "fragment"
  | "register-lift"
  | "sparse-recall"
  | "decorated-return"
  | "open-tail"

/** 旧Decoration Generatorの語彙を、独立レイヤーではなくPhrase展開へ統合する。 */
export interface SignatureDecorationIntent {
  barIndex: number
  gestureRole: DecorationGestureRole
  shape: DecorationShape
  rhythmStyle: DecorationRhythmStyle
  strength: "subtle" | "clear"
}

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

/** 安全性ではなく、意図した逸脱をどこまで前面に出すか。 */
export type SignatureCreativeRisk = "focused" | "bold" | "radical"

export type SignatureRhythmicDisruption =
  | "none"
  | "metric-displacement"
  | "asymmetric-cycle"
  | "silence-fracture"
  | "cross-bar-attack"

export type SignaturePitchDisruption =
  | "none"
  | "interval-signature"
  | "chromatic-side-step"
  | "register-rupture"
  | "pedal-tension"

export type SignatureStructuralSurprise =
  | "none"
  | "false-start"
  | "interruption"
  | "false-return"
  | "abrupt-open-tail"

export interface SignatureCreativeRiskPlan {
  risk: SignatureCreativeRisk
  rhythmicDevice: SignatureRhythmicDisruption
  pitchDevice: SignaturePitchDisruption
  structuralDevice: SignatureStructuralSurprise
  targetAudacity: number
  /** 逸脱後にMotifまたは和声音へ回収する必要があるか。 */
  recoveryRequired: boolean
}

/**
 * 単音の旋律線だけでなく、和音由来の質感も候補として提案できるようにする軸。
 * single-line: 従来通りの単音Motif。
 * block-chord: 各音へ和声音を1〜2声重ね、同時発音のスタブ／パッドにする。
 * broken-chord: 各音を短いアルペジオへ分解し、和音を分散和音として鳴らす。
 */
export type SignatureVoicingMode = "single-line" | "block-chord" | "broken-chord"

export type SignatureVoicingStyle =
  | "close-position"
  | "open-spread"
  | "drop-2"
  | "pedal-tone"
  | "inner-motion"

export type SignatureVoiceMotion = "smooth" | "contrary" | "oblique"

/** 和音を各拍の独立した塊ではなく、連続する声部として動かすための事前計画。 */
export interface SignatureVoiceLeadingPlan {
  style: SignatureVoicingStyle
  motion: SignatureVoiceMotion
  /** leadを含む目標声部数。実音域が狭い場合は安全に減らす。 */
  voiceCount: 2 | 3 | 4
  /** 各声部に許容する1回の最大移動幅。 */
  maxVoiceLeap: number
  tensionPolicy: "chord-tones-only" | "color-on-lift" | "color-on-return"
  /** 共通音が成立する場合に低声または内声で保持するPitch Class。 */
  pedalPitchClass?: number
}

/** 実音生成より先に確定する、短いSignature Phrase専用の設計。 */
export interface SignaturePhrasePlan {
  role: SignaturePhraseRole
  lengthBars: SignaturePhraseLengthBars
  archetype: SignaturePhraseArchetype
  architecture: SignaturePhraseArchitecture
  developmentStages: SignatureDevelopmentStage[]
  decorationIntents: SignatureDecorationIntent[]
  rhythmIdentity: SignatureRhythmIdentity
  contour: PhraseContour
  variationStrategy: SignatureVariationStrategy
  creativeRisk: SignatureCreativeRiskPlan
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
  /** 単音Motifか、和音のスタブ／分散和音として鳴らすか。 */
  voicingMode: SignatureVoicingMode
  /** 転回・開離配置・内声移動と、声部間の運動方針。 */
  voiceLeading: SignatureVoiceLeadingPlan
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
  longRangeCoherence: number
  variationBalance: number
  silenceUse: number
  arpeggioPenalty: number
  mechanicalPenalty: number
  /** block-chord/broken-chordで追加した声部の音間隔・重複を評価する(single-lineは常に1)。 */
  voicingQuality: number
  /** 声部交差、急な跳躍、平行移動、共通音保持を総合評価する。 */
  voiceLeadingQuality: number
  /** 計画された逸脱が、実音・実リズムへ現れた強さ。 */
  audacity: number
  /** 大跳躍・非和声音・休止が回収され、単なるズレになっていない度合い。 */
  controlledRisk: number
  /** 驚きの後にMotifの因果関係が戻る度合い。 */
  surpriseCoherence: number
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
