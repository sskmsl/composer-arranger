import {
  allUsablePitchClasses,
  chordTonePitchClasses,
  isChordTone,
  isTensionTone,
  type ParsedChord,
} from "@/core/chord"
import type { MelodyNote, PhraseContour } from "@/core/melody"
import { pitchClass } from "@/core/note"
import type { ChordEvent, SongProfileId } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import { keyScalePitchClasses } from "@/core/scale"
import type {
  SignaturePhraseCandidate,
  SignaturePhraseArchetype,
  SignaturePhraseArchitecture,
  SignatureCreativeRisk,
  SignatureCreativeRiskPlan,
  SignaturePhraseLengthBars,
  SignatureDevelopmentStage,
  SignatureDecorationIntent,
  SignaturePhrasePlan,
  SignaturePhraseScore,
  SignaturePhraseSimilarity,
  SignatureOpportunityKind,
  SignatureRhythmIdentity,
  SignatureVariationStrategy,
  SignatureVoiceLeadingPlan,
  SignatureVoiceMotion,
  SignatureVoicingMode,
  SignatureVoicingStyle,
  SignatureGenerationDirection,
} from "@/core/signaturePhrase"
import type { SectionRole } from "@/core/section"
import type { Density, Drama, RangeSetting } from "@/melody-engine/generationParams"
import {
  buildHarmonicMap,
  chordAtBeat,
  type HarmonicMapEntry,
} from "@/melody-engine/harmonicMap"
import { nearestAllowedPitch } from "@/melody-engine/pitchUtils"
import { enforceHarmonicIntegrity } from "@/melody-engine/harmonicIntegrity"
import {
  analyzeSignaturePhraseContext,
  signatureCompositionContextFor,
  type SignaturePhraseContextAnalysis,
} from "./signaturePhraseAnalysis"

export interface GenerateSignaturePhrasesInput {
  chords: ChordEvent[]
  /** 曲中でSignatureが担う役割を判断するためのActive Melody。未設定時はコードのみで生成する。 */
  referenceMelody?: MelodyNote[]
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  density: Density
  drama: Drama
  range: RangeSetting
  key: string
  beatsPerBar: number
  totalBeats: number
  seed: number
  lengthBars?: SignaturePhraseLengthBars
  finalCandidateCount?: number
  candidatePoolSize?: number
  /** 上位のArrangement Intent。候補を固定せず、プール内の分布だけを寄せる。 */
  direction?: SignatureGenerationDirection
}

interface RhythmEvent {
  start: number
  duration: number
  accent: number
  integratedDecoration?: SignatureDecorationIntent
  decorationIndex?: number
}

interface BuiltSignaturePhrase {
  notes: MelodyNote[]
  /** 和音展開前の単音Motif。identity/rhythm/contour系スコアの基準として使う。 */
  leadNotes: MelodyNote[]
  plan: SignaturePhrasePlan
  phraseLengthBeats: number
  seed: number
  score: SignaturePhraseScore
}

const DEFAULT_FINAL_COUNT = 12
const DEFAULT_POOL_SIZE = 72
const QUALITY_FLOOR = 58

const CREATIVE_RISK_CYCLE: readonly SignatureCreativeRisk[] = [
  "focused", "focused", "focused",
  "bold", "bold", "bold", "bold", "bold",
  "radical", "radical", "radical", "radical",
]

function creativeRiskPlanFor(
  poolIndex: number,
  rng: SeededRandom,
): SignatureCreativeRiskPlan {
  const risk = CREATIVE_RISK_CYCLE[poolIndex % CREATIVE_RISK_CYCLE.length]
  if (risk === "focused") {
    return {
      risk,
      rhythmicDevice: "none",
      pitchDevice: "none",
      structuralDevice: "none",
      targetAudacity: 0.28,
      recoveryRequired: false,
    }
  }
  const rhythmicDevices = [
    "metric-displacement",
    "asymmetric-cycle",
    "silence-fracture",
    "cross-bar-attack",
  ] as const
  const pitchDevices = [
    "interval-signature",
    "chromatic-side-step",
    "register-rupture",
    "pedal-tension",
  ] as const
  const structuralDevices = [
    "false-start",
    "interruption",
    "false-return",
    "abrupt-open-tail",
  ] as const
  const deviceIndex = (poolIndex + rng.intBetween(0, 3)) % 4
  return {
    risk,
    rhythmicDevice: rhythmicDevices[deviceIndex],
    pitchDevice: pitchDevices[(deviceIndex + poolIndex) % 4],
    structuralDevice: structuralDevices[(deviceIndex + poolIndex * 2) % 4],
    targetAudacity: risk === "radical" ? 0.82 : 0.6,
    recoveryRequired: true,
  }
}

const VOICING_MODES: SignatureVoicingMode[] = [
  "single-line",
  "block-chord",
  "broken-chord",
]

/**
 * Archetypeごとの質感に合わせた分布。single-lineを最大配分に保ち、
 * 「短音だけでなく和音のフレーズも提案する」を既存の単音候補への追加として扱う。
 * obsessive-motorは反復スタブによる駆動感と相性が良いためblock-chordを厚めに、
 * atmospheric-gatewayは分散和音の質感も
 * 活かせるためbroken-chordを厚めにする。
 */
const VOICING_MODE_WEIGHTS: Record<
  SignaturePhraseArchetype,
  readonly [number, number, number]
> = {
  "atmospheric-gateway": [0.4, 0.28, 0.32],
  "obsessive-motor": [0.35, 0.45, 0.2],
  "kinetic-hook": [0.5, 0.25, 0.25],
}

const VOICING_STYLES: SignatureVoicingStyle[] = [
  "close-position",
  "open-spread",
  "drop-2",
  "pedal-tone",
  "inner-motion",
]

const VOICE_MOTIONS: SignatureVoiceMotion[] = [
  "smooth",
  "contrary",
  "oblique",
]

const ARCHETYPES: SignaturePhraseArchetype[] = [
  "atmospheric-gateway",
  "obsessive-motor",
  "kinetic-hook",
]

const OPPORTUNITY_ARCHETYPES: Record<
  SignatureOpportunityKind,
  readonly SignaturePhraseArchetype[]
> = {
  "motif-foreshadowing": [
    "obsessive-motor",
    "kinetic-hook",
    "atmospheric-gateway",
  ],
  "rhythmic-counter-identity": [
    "kinetic-hook",
    "atmospheric-gateway",
    "obsessive-motor",
  ],
  "harmonic-identity": [
    "atmospheric-gateway",
    "obsessive-motor",
    "kinetic-hook",
  ],
  "tension-premonition": [
    "atmospheric-gateway",
    "kinetic-hook",
    "obsessive-motor",
  ],
  "register-contrast": [
    "atmospheric-gateway",
    "kinetic-hook",
    "obsessive-motor",
  ],
  "section-threshold": [
    "kinetic-hook",
    "atmospheric-gateway",
    "obsessive-motor",
  ],
}

const OPPORTUNITY_RHYTHMS: Record<
  SignatureOpportunityKind,
  readonly SignatureRhythmIdentity[]
> = {
  "motif-foreshadowing": [
    "call-gap-answer",
    "long-short-signal",
    "opening-stamp",
  ],
  "rhythmic-counter-identity": [
    "syncopated-cell",
    "broken-pulse",
    "pickup-hook",
  ],
  "harmonic-identity": [
    "opening-stamp",
    "long-short-signal",
    "call-gap-answer",
  ],
  "tension-premonition": [
    "long-short-signal",
    "call-gap-answer",
    "pickup-hook",
  ],
  "register-contrast": [
    "pickup-hook",
    "call-gap-answer",
    "syncopated-cell",
  ],
  "section-threshold": [
    "opening-stamp",
    "pickup-hook",
    "broken-pulse",
  ],
}

const ARCHETYPE_RHYTHMS: Record<
  SignaturePhraseArchetype,
  readonly SignatureRhythmIdentity[]
> = {
  "atmospheric-gateway": ["call-gap-answer", "long-short-signal"],
  "obsessive-motor": ["opening-stamp", "broken-pulse"],
  "kinetic-hook": ["pickup-hook", "syncopated-cell"],
}

const RHYTHM_BLUEPRINTS: Record<
  SignatureRhythmIdentity,
  readonly RhythmEvent[]
> = {
  "opening-stamp": [
    { start: 0, duration: 0.75, accent: 1 },
    { start: 1, duration: 0.5, accent: 0.72 },
    { start: 1.75, duration: 0.25, accent: 0.62 },
    { start: 2.5, duration: 1, accent: 0.86 },
  ],
  "pickup-hook": [
    { start: 0.5, duration: 0.25, accent: 0.55 },
    { start: 0.75, duration: 0.25, accent: 0.68 },
    { start: 1, duration: 1, accent: 1 },
    { start: 2.5, duration: 0.5, accent: 0.72 },
    { start: 3.25, duration: 0.5, accent: 0.82 },
  ],
  "syncopated-cell": [
    { start: 0, duration: 0.5, accent: 0.84 },
    { start: 0.75, duration: 0.75, accent: 1 },
    { start: 2, duration: 0.25, accent: 0.58 },
    { start: 2.75, duration: 0.75, accent: 0.9 },
  ],
  "call-gap-answer": [
    { start: 0, duration: 0.5, accent: 0.9 },
    { start: 0.5, duration: 0.5, accent: 0.72 },
    { start: 2.25, duration: 0.5, accent: 0.82 },
    { start: 3, duration: 0.75, accent: 1 },
  ],
  "long-short-signal": [
    { start: 0, duration: 1.5, accent: 1 },
    { start: 1.75, duration: 0.25, accent: 0.62 },
    { start: 2, duration: 0.5, accent: 0.76 },
    { start: 3, duration: 0.5, accent: 0.88 },
  ],
  "broken-pulse": [
    { start: 0.25, duration: 0.5, accent: 0.68 },
    { start: 1, duration: 0.25, accent: 0.9 },
    { start: 1.5, duration: 0.5, accent: 0.7 },
    { start: 2.5, duration: 0.25, accent: 1 },
    { start: 3, duration: 0.5, accent: 0.8 },
  ],
}

const CONTOURS: PhraseContour[] = [
  "ascending",
  "descending",
  "arch",
  "inverted-arch",
  "wave",
]

/**
 * 音程そのものではなく、隣接音間の動き。狭い反復・空間的な呼応・
 * 身体的な折り返しを別語彙にし、全候補が同じ階段運動へ寄らないようにする。
 */
const MOTIF_PATHS: Record<SignaturePhraseArchetype, readonly number[][]> = {
  "atmospheric-gateway": [
    [0, 2, -1],
    [0, -1, 3],
    [0, 3, -2, 0],
    [0, -2, 1, 0],
  ],
  "obsessive-motor": [
    [0, 0, -1, 0],
    [0, -1, 0, 2],
    [0, 3, -3, 1],
    [0, 0, 3, -1, 0],
  ],
  "kinetic-hook": [
    [0, 4, -2, -3],
    [0, -5, 2, 4],
    [0, 2, 3, -4, 1],
    [0, -3, 5, -2],
  ],
}

const ARCHITECTURE_STAGES: Record<
  SignaturePhraseArchitecture,
  readonly SignatureDevelopmentStage[]
> = {
  "identity-return": [
    "establish",
    "repeat",
    "answer",
    "fragment",
    "register-lift",
    "sparse-recall",
    "decorated-return",
    "open-tail",
  ],
  "question-answer-return": [
    "establish",
    "answer",
    "repeat",
    "register-lift",
    "fragment",
    "answer",
    "decorated-return",
    "open-tail",
  ],
  "slow-burn-return": [
    "establish",
    "sparse-recall",
    "repeat",
    "answer",
    "register-lift",
    "fragment",
    "decorated-return",
    "open-tail",
  ],
}

const ARCHITECTURES = Object.keys(
  ARCHITECTURE_STAGES,
) as SignaturePhraseArchitecture[]

function developmentStagesFor(
  architecture: SignaturePhraseArchitecture,
  lengthBars: SignaturePhraseLengthBars,
): SignatureDevelopmentStage[] {
  const full = ARCHITECTURE_STAGES[architecture]
  if (lengthBars === 1) return ["establish"]
  if (lengthBars === 2) return ["establish", "decorated-return"]
  if (lengthBars === 4) {
    return [full[0], full[1], full[3], "decorated-return"]
  }
  return [...full]
}

function decorationIntentsFor(
  archetype: SignaturePhraseArchetype,
  lengthBars: SignaturePhraseLengthBars,
  poolIndex: number,
): SignatureDecorationIntent[] {
  if (lengthBars === 1) return []
  const vocabulary: Record<
    SignaturePhraseArchetype,
    readonly Omit<SignatureDecorationIntent, "barIndex">[]
  > = {
    "atmospheric-gateway": [
      {
        gestureRole: "swell",
        shape: "suspense",
        rhythmStyle: "legato",
        strength: "subtle",
      },
      {
        gestureRole: "response",
        shape: "neighbor-motion",
        rhythmStyle: "dotted",
        strength: "subtle",
      },
      {
        gestureRole: "ending",
        shape: "falling",
        rhythmStyle: "legato",
        strength: "clear",
      },
    ],
    "obsessive-motor": [
      {
        gestureRole: "pedal",
        shape: "sparse-accent",
        rhythmStyle: "staccato",
        strength: "subtle",
      },
      {
        gestureRole: "transition",
        shape: "repeated-sequence",
        rhythmStyle: "syncopation",
        strength: "clear",
      },
      {
        gestureRole: "pickup",
        shape: "rising",
        rhythmStyle: "eighth",
        strength: "clear",
      },
    ],
    "kinetic-hook": [
      {
        gestureRole: "pickup",
        shape: "rising",
        rhythmStyle: "syncopation",
        strength: "clear",
      },
      {
        gestureRole: "response",
        shape: "turn",
        rhythmStyle: "dotted",
        strength: "subtle",
      },
      {
        gestureRole: "transition",
        shape: "sequence",
        rhythmStyle: "eighth",
        strength: "clear",
      },
    ],
  }
  const count = lengthBars >= 8 ? 3 : lengthBars >= 4 ? 2 : 1
  const targetBars =
    lengthBars >= 8
      ? [2, 5, 7]
      : lengthBars >= 4
        ? [1, 3]
        : [1]
  const options = vocabulary[archetype]
  return targetBars.slice(0, count).map((barIndex, index) => ({
    ...options[(poolIndex + index) % options.length],
    barIndex,
  }))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mean(values: readonly number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function creativeRiskOf(plan: SignaturePhrasePlan): SignatureCreativeRiskPlan {
  return plan.creativeRisk ?? {
    risk: "focused",
    rhythmicDevice: "none",
    pitchDevice: "none",
    structuralDevice: "none",
    targetAudacity: 0.28,
    recoveryRequired: false,
  }
}

function roundQuarter(value: number): number {
  return Math.round(value * 4) / 4
}

function safeVoicingColorPitchClasses(chord: ParsedChord): number[] {
  const explicit = chord.tensions.map((tone) => tone.pitchClass)
  const implicit = chord.isDiminished
    ? []
    : chord.isDominant
      ? [(chord.rootPc + 2) % 12, (chord.rootPc + 9) % 12]
      : chord.isSus
        ? [(chord.rootPc + 2) % 12]
        : chord.isMinor
          ? [(chord.rootPc + 2) % 12, (chord.rootPc + 5) % 12]
          : [(chord.rootPc + 2) % 12, (chord.rootPc + 9) % 12]
  return [...new Set([...explicit, ...implicit])]
}

function commonPedalPitchClass(
  input: GenerateSignaturePhrasesInput,
): number | undefined {
  const entries = buildHarmonicMap(input.chords).slice(0, 8)
  if (entries.length < 2) return undefined
  const first = chordTonePitchClasses(entries[0].parsed)
  return first.find((pc) =>
    entries.every((entry) =>
      chordTonePitchClasses(entry.parsed).includes(pc),
    ),
  )
}

function voiceLeadingPlanFor(
  input: GenerateSignaturePhrasesInput,
  archetype: SignaturePhraseArchetype,
  architecture: SignaturePhraseArchitecture,
  poolIndex: number,
  rng: SeededRandom,
): SignatureVoiceLeadingPlan {
  const preferredStyles: Record<
    SignaturePhraseArchetype,
    readonly SignatureVoicingStyle[]
  > = {
    "atmospheric-gateway": ["open-spread", "pedal-tone", "inner-motion"],
    "obsessive-motor": ["close-position", "inner-motion", "pedal-tone"],
    "kinetic-hook": ["drop-2", "open-spread", "close-position"],
  }
  let style =
    poolIndex < VOICING_STYLES.length
      ? VOICING_STYLES[poolIndex]
      : rng.pick(preferredStyles[archetype])
  const pedalPitchClass = commonPedalPitchClass(input)
  if (style === "pedal-tone" && pedalPitchClass === undefined) {
    style = "inner-motion"
  }
  const motion =
    architecture === "slow-burn-return"
      ? rng.pick<SignatureVoiceMotion>(["oblique", "smooth"])
      : architecture === "question-answer-return"
        ? rng.pick<SignatureVoiceMotion>(["contrary", "smooth"])
        : VOICE_MOTIONS[(poolIndex + rng.intBetween(0, 2)) % VOICE_MOTIONS.length]
  const voiceCount: 2 | 3 | 4 =
    style === "drop-2"
      ? 4
      : style === "pedal-tone"
        ? 2
        : style === "open-spread" && rng.chance(0.35)
          ? 4
          : 3
  return {
    style,
    motion,
    voiceCount,
    maxVoiceLeap: motion === "smooth" ? 5 : motion === "oblique" ? 4 : 7,
    tensionPolicy:
      archetype === "atmospheric-gateway"
        ? "color-on-return"
        : archetype === "kinetic-hook"
          ? "color-on-lift"
          : "chord-tones-only",
    pedalPitchClass: style === "pedal-tone" ? pedalPitchClass : undefined,
  }
}

function planSignaturePhrase(
  input: GenerateSignaturePhrasesInput,
  seed: number,
  poolIndex: number,
  analysis: SignaturePhraseContextAnalysis,
): SignaturePhrasePlan {
  const rng = new SeededRandom(seed ^ 0x6a09e667)
  const compositionContext = signatureCompositionContextFor(
    analysis,
    poolIndex,
    seed,
  )
  const lengthBars = (input.lengthBars ?? (poolIndex % 3 === 0 ? 1 : 2)) as
    SignaturePhraseLengthBars
  const profileWeights: Record<SongProfileId, readonly number[]> = {
    "dark-romantic": [1.25, 1.45, 0.8],
    "cinematic-french-pop": [1.55, 0.75, 1],
    "minimal-tension": [1.6, 1.05, 0.55],
    "dramatic-synth-pop": [0.75, 1.4, 1.55],
    "original-custom": [1, 1, 1],
  }
  const opportunityArchetypes =
    OPPORTUNITY_ARCHETYPES[compositionContext.opportunity]
  const profileChoice = rng.weightedPick(
    ARCHETYPES,
    profileWeights[input.songProfile],
  )
  // 曲中の必要性を主判断にしつつ、Song Profileは候補内の色として残す。
  const contextualArchetype =
    poolIndex % 4 === 3 && opportunityArchetypes.includes(profileChoice)
      ? profileChoice
      : opportunityArchetypes[poolIndex % opportunityArchetypes.length]
  const archetype =
    input.direction && poolIndex % 4 !== 3
      ? input.direction.archetype
      : contextualArchetype
  const opportunityRhythms =
    OPPORTUNITY_RHYTHMS[compositionContext.opportunity]
  const archetypeRhythms = ARCHETYPE_RHYTHMS[archetype]
  const contextualRhythm =
    poolIndex % 4 === 0
      ? archetypeRhythms[(poolIndex + rng.intBetween(0, 1)) % archetypeRhythms.length]
      : opportunityRhythms[
          (poolIndex + rng.intBetween(0, 2)) % opportunityRhythms.length
        ]
  const rhythmIdentity =
    input.direction && poolIndex % 3 !== 2
      ? input.direction.rhythmIdentity
      : contextualRhythm
  const contextualContour =
    CONTOURS[(poolIndex * 3 + rng.intBetween(0, 2)) % CONTOURS.length]
  const contour =
    input.direction && poolIndex % 3 !== 2
      ? input.direction.contour
      : contextualContour
  const preferredVariations: Record<
    SignaturePhraseArchetype,
    readonly SignatureVariationStrategy[]
  > = {
    "atmospheric-gateway": ["augmentation", "answer", "delayed-return"],
    "obsessive-motor": ["displacement", "fragmentation", "delayed-return"],
    "kinetic-hook": ["answer", "displacement", "fragmentation"],
  }
  const variationOptions = preferredVariations[archetype]
  const variationStrategy =
    variationOptions[(poolIndex * 2 + rng.intBetween(0, 2)) % variationOptions.length]
  const harmonicPolicies = [
    "structural-only",
    "opening-and-ending",
    "tension-led",
  ] as const
  const archetypePolicy: Record<
    SignaturePhraseArchetype,
    (typeof harmonicPolicies)[number]
  > = {
    "atmospheric-gateway": "tension-led",
    "obsessive-motor": "structural-only",
    "kinetic-hook": "opening-and-ending",
  }
  const motifOptions = MOTIF_PATHS[archetype]
  const motifVariant = ((poolIndex * 5 + seed) % motifOptions.length) as
    | 0
    | 1
    | 2
    | 3
  const architecture =
    ARCHITECTURES[(poolIndex + rng.intBetween(0, 2)) % ARCHITECTURES.length]
  const voicingMode = rng.weightedPick(
    VOICING_MODES,
    VOICING_MODE_WEIGHTS[archetype],
  )
  const creativeRisk = creativeRiskPlanFor(poolIndex, rng)
  if (input.direction && poolIndex % 3 !== 2) {
    creativeRisk.risk = input.direction.creativeRisk
    creativeRisk.targetAudacity =
      input.direction.creativeRisk === "radical"
        ? 0.82
        : input.direction.creativeRisk === "bold"
          ? 0.6
          : 0.28
    creativeRisk.recoveryRequired = input.direction.creativeRisk !== "focused"
    if (input.direction.creativeRisk === "focused") {
      creativeRisk.rhythmicDevice = "none"
      creativeRisk.pitchDevice = "none"
      creativeRisk.structuralDevice = "none"
    } else {
      const deviceIndex = poolIndex % 4
      creativeRisk.rhythmicDevice = [
        "metric-displacement",
        "asymmetric-cycle",
        "silence-fracture",
        "cross-bar-attack",
      ][deviceIndex] as SignatureCreativeRiskPlan["rhythmicDevice"]
      creativeRisk.pitchDevice = [
        "interval-signature",
        "chromatic-side-step",
        "register-rupture",
        "pedal-tension",
      ][deviceIndex] as SignatureCreativeRiskPlan["pitchDevice"]
      creativeRisk.structuralDevice = [
        "false-start",
        "interruption",
        "false-return",
        "abrupt-open-tail",
      ][deviceIndex] as SignatureCreativeRiskPlan["structuralDevice"]
    }
  }
  return {
    role: "intro",
    lengthBars,
    archetype,
    architecture,
    developmentStages: developmentStagesFor(architecture, lengthBars),
    decorationIntents: decorationIntentsFor(
      archetype,
      lengthBars,
      poolIndex,
    ),
    rhythmIdentity,
    contour,
    variationStrategy,
    creativeRisk,
    motifSize: motifOptions[motifVariant].length,
    motifVariant,
    pickupBeats: RHYTHM_BLUEPRINTS[rhythmIdentity][0]?.start ?? 0,
    rhythmVariant: (poolIndex % 3) as 0 | 1 | 2,
    repetitionStrength:
      archetype === "obsessive-motor"
        ? 0.88
        : archetype === "kinetic-hook"
          ? 0.7
          : 0.52,
    targetSilenceRatio:
      input.direction && poolIndex % 3 !== 2
        ? input.direction.targetSilenceRatio
        : archetype === "atmospheric-gateway"
          ? 0.5
          : archetype === "kinetic-hook"
            ? 0.3
            : 0.22,
    harmonicAnchorPolicy:
      rng.next() < 0.72
        ? archetypePolicy[archetype]
        : harmonicPolicies[(poolIndex + rng.intBetween(0, 2)) % harmonicPolicies.length],
    voicingMode,
    voiceLeading: voiceLeadingPlanFor(
      input,
      archetype,
      architecture,
      poolIndex,
      rng,
    ),
    compositionContext,
  }
}

function transformStatement(
  source: readonly RhythmEvent[],
  strategy: SignatureVariationStrategy,
  statementIndex: number,
  stage: SignatureDevelopmentStage,
): RhythmEvent[] {
  if (statementIndex === 0 || stage === "establish") {
    return source.map((event) => ({ ...event }))
  }
  if (stage === "repeat" || stage === "register-lift") {
    return source.map((event, index) => ({
      ...event,
      accent: Math.max(0.5, Math.min(1, event.accent + (index % 2 === 0 ? 0.04 : -0.06))),
    }))
  }
  if (stage === "answer") {
    return transformStatement(source, "answer", statementIndex, "decorated-return")
  }
  if (stage === "fragment") {
    return transformStatement(source, "fragmentation", statementIndex, "decorated-return")
  }
  if (stage === "sparse-recall") {
    return source
      .filter((_, index) => index === 0 || index === source.length - 1)
      .map((event, index) => ({
        ...event,
        duration: index === 0 ? Math.min(1.75, event.duration * 1.4) : event.duration,
        accent: Math.max(0.48, event.accent - 0.12),
      }))
  }
  if (stage === "open-tail") {
    return source
      .filter((_, index) => index === 0 || index >= source.length - 2)
      .map((event, index, events) => ({
        ...event,
        start: Math.min(3.5, event.start + (index === 0 ? 0.25 : 0)),
        duration:
          index === events.length - 1
            ? Math.max(1, event.duration)
            : event.duration,
        accent: Math.max(0.5, event.accent - index * 0.05),
      }))
  }
  switch (strategy) {
    case "displacement":
      return source
        .map((event) => ({
          ...event,
          start: Math.min(3.75, event.start + 0.25),
        }))
        .filter((event, index) => index !== source.length - 1 || event.start < 3.5)
    case "fragmentation":
      return source
        .slice(0, Math.max(3, source.length - 1))
        .map((event, index) => ({
          ...event,
          duration: index === 0 ? Math.min(event.duration, 0.5) : event.duration,
        }))
    case "augmentation":
      return source
        .filter((_, index) => index % 2 === 0 || index === source.length - 1)
        .map((event) => ({
          ...event,
          duration: Math.min(1.5, event.duration * 1.5),
        }))
    case "answer":
      return [...source].reverse().map((event, index, reversed) => ({
        ...event,
        start: roundQuarter(
          index === 0
            ? 0.5
            : Math.min(3.5, reversed[index - 1].start + 0.75),
        ),
        accent: Math.max(0.55, 1 - index * 0.1),
      }))
    case "delayed-return":
      return source.map((event, index) => ({
        ...event,
        start: Math.min(3.75, event.start + (index < 2 ? 0.5 : 0)),
      }))
  }
}

function integratedDecorationEvents(
  intent: SignatureDecorationIntent,
  barStart: number,
  beatsPerBar: number,
  statement: readonly RhythmEvent[],
): RhythmEvent[] {
  const barEnd = barStart + beatsPerBar
  const firstStart = statement[0]?.start ?? barStart + 0.5
  const lastEnd = statement.reduce(
    (latest, event) => Math.max(latest, event.start + event.duration),
    barStart,
  )
  const event = (
    start: number,
    duration: number,
    accent: number,
    decorationIndex: number,
  ): RhythmEvent => ({
    start: roundQuarter(Math.max(barStart, Math.min(barEnd - 0.25, start))),
    duration: roundQuarter(
      Math.max(0.25, Math.min(duration, barEnd - start)),
    ),
    accent,
    integratedDecoration: intent,
    decorationIndex,
  })

  if (intent.gestureRole === "pickup") {
    return [
      event(firstStart - 0.5, 0.25, 0.58, 0),
      event(firstStart - 0.25, 0.25, 0.7, 1),
    ].filter((item, index, all) =>
      item.start >= barStart &&
      all.findIndex((other) => other.start === item.start) === index,
    )
  }
  if (intent.gestureRole === "transition") {
    return [
      event(barEnd - 1, 0.25, 0.62, 0),
      event(barEnd - 0.5, 0.5, 0.78, 1),
    ]
  }
  if (intent.gestureRole === "response") {
    return lastEnd <= barEnd - 0.5
      ? [event(lastEnd + 0.25, 0.5, 0.6, 0)]
      : []
  }
  if (intent.gestureRole === "swell") {
    return [event(barEnd - 1.5, 1.5, 0.54, 0)]
  }
  if (intent.gestureRole === "pedal") {
    return [event(barStart + beatsPerBar * 0.5, 0.75, 0.52, 0)]
  }
  return [event(barEnd - 0.75, 0.75, 0.64, 0)]
}

function fitDecorationsIntoGaps(
  baseEvents: readonly RhythmEvent[],
  decorations: readonly RhythmEvent[],
): RhythmEvent[] {
  const accepted: RhythmEvent[] = []
  for (const decoration of decorations) {
    const occupied = [...baseEvents, ...accepted].sort(
      (left, right) => left.start - right.start,
    )
    const startsInsideSound = occupied.some(
      (event) =>
        decoration.start >= event.start &&
        decoration.start < event.start + event.duration,
    )
    if (startsInsideSound) continue
    const nextStart = occupied
      .map((event) => event.start)
      .filter((start) => start > decoration.start)
      .sort((left, right) => left - right)[0]
    const duration = roundQuarter(
      Math.min(
        decoration.duration,
        nextStart === undefined
          ? decoration.duration
          : nextStart - decoration.start,
      ),
    )
    if (duration < 0.25) continue
    accepted.push({ ...decoration, duration })
  }
  return accepted
}

function normalizeMonophonicRhythm(
  events: readonly RhythmEvent[],
): RhythmEvent[] {
  const ordered = [...events].sort((left, right) => left.start - right.start)
  return ordered
    .map((event, index) => {
      const next = ordered[index + 1]
      if (!next) return event
      return {
        ...event,
        duration: roundQuarter(
          Math.min(event.duration, Math.max(0, next.start - event.start)),
        ),
      }
    })
    .filter((event) => event.duration >= 0.25)
}

function shapeStatementForArchetype(
  source: readonly RhythmEvent[],
  plan: SignaturePhrasePlan,
  statementIndex: number,
): RhythmEvent[] {
  if (plan.archetype === "atmospheric-gateway") {
    return source
      .filter((_, index) => {
        if (plan.rhythmVariant === 1) return index === 0 || index === source.length - 1
        if (plan.rhythmVariant === 2) return index !== 1
        return index % 2 === 0 || index === source.length - 1
      })
      .map((event, index) => ({
        ...event,
        start: Math.min(3.75, event.start + (statementIndex > 0 && index === 0 ? 0.5 : 0)),
        duration: Math.min(2.25, event.duration * (index === 0 ? 1.6 : 1.25)),
        accent: Math.max(0.48, event.accent - index * 0.08),
      }))
  }

  if (plan.archetype === "obsessive-motor") {
    return source
      .filter((_, index) => plan.rhythmVariant !== 2 || index !== source.length - 2)
      .map((event, index) => ({
        ...event,
        start: Math.min(
          3.75,
          event.start +
            (plan.rhythmVariant === 1 && index % 2 === 1 ? 0.25 : 0),
        ),
        duration: Math.min(event.duration, index % 3 === 0 ? 0.5 : 0.35),
        accent:
          index === 0 || index === source.length - 1
            ? 1
            : Math.max(0.5, event.accent - 0.12),
      }))
  }

  return source.map((event, index) => ({
    ...event,
    start: Math.min(
      3.75,
      event.start +
        (plan.rhythmVariant === 1 && index === 1 ? 0.25 : 0) +
        (plan.rhythmVariant === 2 && statementIndex > 0 && index === 0 ? 0.25 : 0),
    ),
    duration: Math.min(event.duration, index % 2 === 0 ? 0.5 : 0.75),
    accent: index % 3 === 0 ? 1 : Math.max(0.58, event.accent),
  }))
}

/**
 * Creative Risk Planを実リズムへ変換する。すべてをランダムに崩すのではなく、
 * 一箇所の異物感と、その後のMotif回帰が両立する範囲に限定する。
 */
function applyCreativeRhythm(
  source: readonly RhythmEvent[],
  plan: SignaturePhrasePlan,
  barIndex: number,
): RhythmEvent[] {
  if (plan.creativeRisk.risk === "focused") return [...source]
  let events = source.map((event) => ({ ...event }))
  const focalBar = plan.lengthBars === 1 ? 0 : Math.min(1, plan.lengthBars - 1)

  if (barIndex === focalBar) {
    switch (plan.creativeRisk.rhythmicDevice) {
      case "metric-displacement":
        events = events
          .map((event, index) => ({
            ...event,
            start: Math.min(3.75, event.start + (index % 2 === 0 ? 0.5 : 0.25)),
          }))
          .filter((event) => event.start < 3.75)
        break
      case "asymmetric-cycle":
        events = events.map((event, index) => ({
          ...event,
          start: Math.min(3.75, event.start + [0, 0.25, -0.25, 0.5][index % 4]),
          duration: index % 3 === 1 ? Math.min(0.5, event.duration) : event.duration,
        }))
        break
      case "silence-fracture":
        events = events.filter((_, index) => index < 2 || index === events.length - 1)
        if (events.at(-1)) events[events.length - 1].start = Math.max(3, events.at(-1)!.start)
        break
      case "cross-bar-attack":
        if (events.at(-1)) {
          events[events.length - 1] = {
            ...events.at(-1)!,
            start: 3.5,
            duration: 0.5,
            accent: 1,
          }
        }
        break
      case "none":
        break
    }
  }

  switch (plan.creativeRisk.structuralDevice) {
    case "false-start":
      if (barIndex === 0) {
        events = events.slice(0, Math.min(2, events.length)).map((event, index) => ({
          ...event,
          duration: Math.min(event.duration, index === 0 ? 0.5 : 0.25),
        }))
      }
      break
    case "interruption":
      if (barIndex === Math.floor(plan.lengthBars / 2)) {
        events = events.filter((_, index) => index === 0 || index === events.length - 1)
      }
      break
    case "false-return":
      if (barIndex === plan.lengthBars - 1) {
        events = events.map((event, index) => ({
          ...event,
          start: Math.min(3.75, event.start + (index < 2 ? 0.5 : 0)),
        }))
      }
      break
    case "abrupt-open-tail":
      if (barIndex === plan.lengthBars - 1) {
        events = events.filter((event) => event.start < 2.75)
      }
      break
    case "none":
      break
  }
  return events.sort((left, right) => left.start - right.start)
}

/** Pitchより先に、休符を含むRhythm Skeletonを完成させる。 */
export function buildSignatureRhythmSkeleton(
  plan: SignaturePhrasePlan,
  beatsPerBar: number,
): RhythmEvent[] {
  const source = RHYTHM_BLUEPRINTS[plan.rhythmIdentity]
  const events: RhythmEvent[] = []
  for (let bar = 0; bar < plan.lengthBars; bar++) {
    const stage = plan.developmentStages[bar] ?? "repeat"
    const transformed = transformStatement(
      source,
      plan.variationStrategy,
      bar,
      stage,
    )
    const statement = applyCreativeRhythm(
      shapeStatementForArchetype(transformed, plan, bar),
      plan,
      bar,
    )
    const barEvents: RhythmEvent[] = []
    for (const event of statement) {
      const scale = beatsPerBar / 4
      const start = roundQuarter(bar * beatsPerBar + event.start * scale)
      const maxDuration = plan.lengthBars * beatsPerBar - start
      if (maxDuration <= 0) continue
      barEvents.push({
        start,
        duration: Math.max(0.25, Math.min(roundQuarter(event.duration * scale), maxDuration)),
        accent: event.accent,
      })
    }
    const decorationIntent = plan.decorationIntents.find(
      (intent) => intent.barIndex === bar,
    )
    const decorated = decorationIntent
      ? integratedDecorationEvents(
          decorationIntent,
          bar * beatsPerBar,
          beatsPerBar,
          barEvents,
        )
      : []
    events.push(
      ...barEvents,
      ...fitDecorationsIntoGaps(barEvents, decorated),
    )
  }
  const context = plan.compositionContext
  if (context && context.referenceRhythmGaps.length > 0) {
    const opening = events
      .filter(
        (event) =>
          !event.integratedDecoration && event.start < beatsPerBar,
      )
      .sort((left, right) => left.start - right.start)
    if (context.opportunity === "motif-foreshadowing") {
      let cursor = opening[0]?.start ?? 0
      opening.slice(1).forEach((event, index) => {
        const sourceGap =
          context.referenceRhythmGaps[
            index % context.referenceRhythmGaps.length
          ]
        // 原型を引用せず、伸縮と局所変位で「同じ曲の別の顔」にする。
        const factor = (index + plan.rhythmVariant) % 2 === 0 ? 0.75 : 1.25
        cursor += Math.max(0.25, roundQuarter(sourceGap * factor))
        event.start = Math.min(beatsPerBar - 0.25, roundQuarter(cursor))
      })
    } else if (context.opportunity === "rhythmic-counter-identity") {
      opening.slice(1).forEach((event, index) => {
        const previous = opening[index]
        const candidateGap = event.start - previous.start
        const sourceGap =
          context.referenceRhythmGaps[
            index % context.referenceRhythmGaps.length
          ]
        if (Math.abs(candidateGap - sourceGap) <= 0.25) {
          event.start = Math.min(
            beatsPerBar - 0.25,
            roundQuarter(event.start + (index % 2 === 0 ? 0.25 : -0.25)),
          )
        }
      })
    }
  }
  return normalizeMonophonicRhythm(events)
}

function phraseChords(
  input: GenerateSignaturePhrasesInput,
  phraseLengthBeats: number,
): ChordEvent[] {
  return input.chords
    .filter(
      (chord) =>
        chord.startBeat < phraseLengthBeats &&
        chord.startBeat + chord.durationBeats > 0,
    )
    .map((chord) => ({
      ...chord,
      startBeat: Math.max(0, chord.startBeat),
      durationBeats:
        Math.min(
          phraseLengthBeats,
          chord.startBeat + chord.durationBeats,
        ) - Math.max(0, chord.startBeat),
    }))
}

function startPitch(
  plan: SignaturePhrasePlan,
  entry: HarmonicMapEntry,
  keyScale: number[],
  range: RangeSetting,
  rng: SeededRandom,
): number {
  const chordTones = chordTonePitchClasses(entry.parsed)
  const tensions = allUsablePitchClasses(entry.parsed).filter(
    (value) => !chordTones.includes(value),
  )
  const pool =
    (plan.harmonicAnchorPolicy === "tension-led" ||
      plan.archetype === "atmospheric-gateway") &&
    tensions.length > 0
      ? tensions
      : [...new Set([...chordTones, ...keyScale])]
  const registerPosition =
    plan.archetype === "obsessive-motor"
      ? 0.38
      : plan.archetype === "kinetic-hook"
        ? 0.5
        : 0.58
  let center =
    range.low +
    (range.high - range.low) *
      (plan.contour === "descending"
        ? Math.min(0.72, registerPosition + 0.12)
        : registerPosition)
  const referenceCenter = plan.compositionContext?.referenceRegisterCenter
  if (referenceCenter !== undefined) {
    const relation = plan.compositionContext?.preferredRegisterRelation
    if (relation === "below") center = referenceCenter - 9
    if (relation === "above") center = referenceCenter + 9
  }
  const firstTarget = plan.compositionContext?.targetTonePath[0]
  const contextualPool = firstTarget?.pitchClasses.length
    ? firstTarget.pitchClasses
    : pool
  return nearestAllowedPitch(
    Math.round(center) + rng.pick([-4, -2, 0, 2, 5]),
    contextualPool,
    range,
  )
}

function contourDirection(
  contour: PhraseContour,
  progress: number,
): number {
  if (contour === "ascending") return 1
  if (contour === "descending") return -1
  if (contour === "arch") return progress < 0.55 ? 1 : -1
  if (contour === "inverted-arch") return progress < 0.5 ? -1 : 1
  return Math.floor(progress * 4) % 2 === 0 ? 1 : -1
}

function transformedStep(
  baseStep: number,
  strategy: SignatureVariationStrategy,
  statement: number,
  indexInMotif: number,
): number {
  if (statement === 0) return baseStep
  switch (strategy) {
    case "displacement":
      return indexInMotif === 0 ? 0 : baseStep
    case "fragmentation":
      return Math.sign(baseStep) * Math.max(1, Math.abs(baseStep) - 1)
    case "augmentation":
      return Math.sign(baseStep) * Math.max(1, Math.round(Math.abs(baseStep) * 1.5))
    case "answer":
      return -baseStep
    case "delayed-return":
      return indexInMotif < 2 ? 0 : baseStep
  }
}

function singleStatementVariation(
  step: number,
  strategy: SignatureVariationStrategy,
  indexInMotif: number,
  motifLength: number,
): number {
  if (indexInMotif < Math.ceil(motifLength / 2)) return step
  switch (strategy) {
    case "displacement":
      return indexInMotif === motifLength - 1 ? 0 : step
    case "fragmentation":
      return Math.sign(step) * Math.max(1, Math.abs(step) - 1)
    case "augmentation":
      return Math.sign(step) * Math.max(1, Math.round(Math.abs(step) * 1.4))
    case "answer":
      return -step
    case "delayed-return":
      return indexInMotif === motifLength - 1 ? -step : 0
  }
}

function developmentStep(
  baseStep: number,
  stage: SignatureDevelopmentStage,
  indexInMotif: number,
): number {
  if (stage === "answer") return -baseStep
  if (stage === "fragment") {
    return indexInMotif >= 2
      ? 0
      : Math.sign(baseStep) * Math.max(1, Math.abs(baseStep) - 1)
  }
  if (stage === "sparse-recall") {
    return Math.sign(baseStep) * Math.min(2, Math.abs(baseStep))
  }
  if (stage === "open-tail" && indexInMotif > 0) {
    return Math.sign(baseStep) * Math.min(1, Math.abs(baseStep))
  }
  return baseStep
}

function motifPathForCreativeRisk(
  source: readonly number[],
  plan: SignaturePhrasePlan,
): number[] {
  if (plan.creativeRisk.risk === "focused") return [...source]
  if (plan.creativeRisk.risk === "bold") {
    return source.map((step, index) =>
      index === 1 && step !== 0
        ? step + Math.sign(step) * 2
        : step,
    )
  }
  const direction = source.find((step) => step !== 0 && Math.sign(step)) ?? 1
  const sign = Math.sign(direction) || 1
  switch (plan.creativeRisk.pitchDevice) {
    case "interval-signature":
      return [0, sign * 7, -sign * 2, -sign * 6, sign * 3]
    case "chromatic-side-step":
      return [0, sign, sign * 6, -sign, -sign * 5]
    case "register-rupture":
      return [0, sign * 5, -sign * 9, sign * 4]
    case "pedal-tension":
      return [0, 0, sign * 6, 0, -sign * 5]
    case "none":
      return [...source]
  }
}

function contextualMotifPath(
  source: readonly number[],
  plan: SignaturePhrasePlan,
): number[] {
  const context = plan.compositionContext
  if (
    context?.opportunity !== "motif-foreshadowing" ||
    context.referenceMotifIntervals.length < 2
  ) {
    return [...source]
  }
  const invert = plan.motifVariant % 2 === 1
  const transformed = context.referenceMotifIntervals
    .slice(0, 4)
    .map((interval, index) => {
      const sign = Math.sign(interval) || (index % 2 === 0 ? 1 : -1)
      const compressed = Math.max(
        1,
        Math.min(5, Math.round(Math.abs(interval) * 0.65)),
      )
      const displaced = index === plan.motifVariant % 3 ? compressed + 1 : compressed
      return sign * displaced * (invert ? -1 : 1)
    })
  // 元旋律の音程列をそのまま移高することはなく、方向反転・圧縮・一点変形を必ず含む。
  return [0, ...transformed]
}

function targetToneAtBeat(
  plan: SignaturePhrasePlan,
  beat: number,
) {
  return plan.compositionContext?.targetTonePath
    .filter((target) => target.beat <= beat + 0.001)
    .at(-1)
}

function integratedDecorationStep(
  intent: SignatureDecorationIntent,
  decorationIndex: number,
): number {
  const direction =
    intent.shape === "falling" ? -1 : 1
  if (intent.shape === "neighbor-motion") return decorationIndex % 2 === 0 ? 2 : -2
  if (intent.shape === "turn") return decorationIndex % 2 === 0 ? 2 : -3
  if (intent.shape === "suspense") return decorationIndex === 0 ? direction : -direction
  if (intent.shape === "sparse-accent") return decorationIndex === 0 ? 0 : direction * 5
  if (intent.shape === "arpeggiated-fill") return direction * [4, 3, 4][decorationIndex % 3]
  if (intent.shape === "repeated-sequence") return decorationIndex % 2 === 0 ? 0 : direction * 2
  if (intent.shape === "sequence") return direction * 2
  return direction * (decorationIndex + 1)
}

function placePitchPath(
  input: GenerateSignaturePhrasesInput,
  plan: SignaturePhrasePlan,
  events: RhythmEvent[],
  map: HarmonicMapEntry[],
  seed: number,
  motifPath: number[],
  phraseLengthBeats: number,
): MelodyNote[] {
  if (events.length === 0 || map.length === 0) return []
  const rng = new SeededRandom(seed ^ 0xbb67ae85)
  const keyScale = keyScalePitchClasses(input.key)
  const firstMotifEvent = events.find((event) => !event.integratedDecoration) ?? events[0]
  const firstEntry = chordAtBeat(map, firstMotifEvent.start) ?? map[0]
  let previous = startPitch(plan, firstEntry, keyScale, input.range, rng)
  const motifRoot = previous
  let previousInterval = 0
  let repeatedPitchCount = 0
  let previousStatement = -1
  let statementEventIndex = 0
  const creativePitchIndex = Math.max(1, Math.floor(events.length * 0.24))
  let pendingRecoveryPitch: number | undefined

  return events.map((event, index) => {
    const entry = chordAtBeat(map, event.start) ?? map[map.length - 1]
    const statement = Math.floor(event.start / input.beatsPerBar)
    if (statement !== previousStatement) {
      statementEventIndex = 0
      previousStatement = statement
    }
    const indexInMotif = statementEventIndex % motifPath.length
    const stage = plan.developmentStages[statement] ?? "repeat"
    let step = event.integratedDecoration
      ? integratedDecorationStep(
          event.integratedDecoration,
          event.decorationIndex ?? 0,
        )
      : developmentStep(
          transformedStep(
            motifPath[indexInMotif],
            plan.variationStrategy,
            statement,
            indexInMotif,
          ),
          stage,
          indexInMotif,
        )
    if (!event.integratedDecoration) statementEventIndex += 1
    if (plan.lengthBars === 1 && index > 0) {
      step = singleStatementVariation(
        step,
        plan.variationStrategy,
        indexInMotif,
        motifPath.length,
      )
    }
    const direction = contourDirection(
      plan.contour,
      event.start / Math.max(1, phraseLengthBeats),
    )
    if (!event.integratedDecoration && statement > 0 && indexInMotif === 0) {
      const returnDistance =
        stage === "register-lift"
          ? direction * (plan.archetype === "kinetic-hook" ? 5 : 3)
          : stage === "decorated-return"
            ? 0
            : plan.archetype === "obsessive-motor"
          ? plan.rhythmVariant === 2
            ? direction
            : 0
          : plan.archetype === "kinetic-hook"
            ? direction * (plan.rhythmVariant + 1)
            : direction * (plan.rhythmVariant === 1 ? 2 : 1)
      step = motifRoot + returnDistance - previous
    } else if (
      index > 0 &&
      indexInMotif === motifPath.length - 1 &&
      plan.archetype !== "obsessive-motor"
    ) {
      // 全音を同方向へ矯正せず、Motif終端だけ長期Contourへ軽く導く。
      step += direction
    }
    if (Math.abs(previousInterval) >= 5 && plan.archetype !== "kinetic-hook") {
      step = -Math.sign(previousInterval) * rng.pick([1, 2])
    }
    let desired =
      !event.integratedDecoration && statement === 0 && indexInMotif === 0
        ? motifRoot
        : previous + step
    const chordTones = chordTonePitchClasses(entry.parsed)
    const usable = allUsablePitchClasses(entry.parsed)
    const structural =
      index === 0 ||
      index === events.length - 1 ||
      (plan.harmonicAnchorPolicy === "structural-only" &&
        Math.abs(event.start % input.beatsPerBar) < 0.05)
    const targetTone = targetToneAtBeat(plan, event.start)
    const structuralTargets = targetTone?.pitchClasses.filter((value) =>
      [...new Set([...usable, ...keyScale])].includes(value),
    ) ?? []
    let allowed = structural && structuralTargets.length > 0
      ? structuralTargets
      : structural
      ? plan.harmonicAnchorPolicy === "tension-led"
        ? [...new Set([...usable, ...keyScale])]
        : chordTones
      : [...new Set([...keyScale, ...usable])]
    let forcedRole: MelodyNote["plannedToneRole"] | undefined
    if (pendingRecoveryPitch !== undefined) {
      desired = pendingRecoveryPitch
      allowed = chordTones
      pendingRecoveryPitch = undefined
      forcedRole = "chord-tone"
    } else if (
      plan.creativeRisk.risk !== "focused" &&
      index === creativePitchIndex &&
      !event.integratedDecoration
    ) {
      const recoveryTarget = nearestAllowedPitch(desired, chordTones, input.range)
      switch (plan.creativeRisk.pitchDevice) {
        case "interval-signature": {
          const leap = contourDirection(
            plan.contour,
            event.start / Math.max(1, phraseLengthBeats),
          ) * (plan.creativeRisk.risk === "radical" ? 9 : 7)
          desired = previous + leap
          allowed = [...new Set([...keyScale, ...usable])]
          pendingRecoveryPitch = recoveryTarget
          break
        }
        case "chromatic-side-step":
          desired = recoveryTarget + (previous <= recoveryTarget ? -1 : 1)
          allowed = [pitchClass(desired)]
          pendingRecoveryPitch = recoveryTarget
          forcedRole = "approach-tone"
          break
        case "register-rupture":
          desired = previous + (previous < (input.range.low + input.range.high) / 2 ? 12 : -12)
          allowed = [...new Set([...keyScale, ...usable])]
          pendingRecoveryPitch = recoveryTarget
          break
        case "pedal-tension":
          desired = motifRoot
          allowed = [pitchClass(motifRoot)]
          forcedRole = isChordTone(entry.parsed, pitchClass(motifRoot))
            ? "common-tone"
            : "tension-hold"
          break
        case "none":
          break
      }
    }
    let placed = nearestAllowedPitch(desired, allowed, input.range)
    repeatedPitchCount = placed === previous ? repeatedPitchCount + 1 : 0
    if (repeatedPitchCount >= 2) {
      placed = nearestAllowedPitch(desired + direction * 2, allowed, input.range)
      repeatedPitchCount = placed === previous ? repeatedPitchCount : 0
    }
    const role = forcedRole ?? (event.integratedDecoration
      ? event.integratedDecoration.gestureRole === "pickup" ||
        event.integratedDecoration.gestureRole === "transition"
        ? "approach-tone"
        : event.integratedDecoration.gestureRole === "swell"
          ? "suspension"
          : event.integratedDecoration.gestureRole === "pedal"
            ? "common-tone"
            : "neighbor-tone"
      : isChordTone(entry.parsed, pitchClass(placed))
        ? "chord-tone"
        : isTensionTone(entry.parsed, pitchClass(placed))
          ? "tension-hold"
          : "passing-tone")
    const note: MelodyNote = {
      id: `signature-${seed}-${index}`,
      startBeat: event.start,
      durationBeats: event.duration,
      pitch: placed,
      velocity: Math.round(
        (plan.archetype === "atmospheric-gateway"
          ? 55
          : plan.archetype === "obsessive-motor"
            ? 66
            : 70) +
          event.accent *
            (plan.archetype === "atmospheric-gateway" ? 18 : 25) +
          rng.intBetween(-3, 3),
      ),
      locks: [],
      plannedToneRole: role,
      plannedResolution:
        role === "chord-tone" || role === "common-tone"
          ? undefined
          : {
              targetPitchClass:
                pendingRecoveryPitch === undefined
                  ? entry.parsed.rootPc
                  : pitchClass(pendingRecoveryPitch),
              targetBeat: Math.min(
                phraseLengthBeats,
                event.start + event.duration + 0.5,
              ),
              maximumDelayBeats: 1,
            },
    }
    previousInterval = placed - previous
    previous = placed
    return note
  })
}

interface SignatureVoicingFrame {
  startBeat: number
  pitches: number[]
  leadPitch: number
}

interface VoicedSignaturePhrase {
  notes: MelodyNote[]
  frames: SignatureVoicingFrame[]
}

function supportCombinations(
  pitches: readonly number[],
  count: number,
): number[][] {
  if (count <= 0) return [[]]
  const combinations: number[][] = []
  const visit = (start: number, selected: number[]) => {
    if (selected.length === count) {
      combinations.push([...selected])
      return
    }
    for (let index = start; index < pitches.length; index++) {
      selected.push(pitches[index])
      visit(index + 1, selected)
      selected.pop()
    }
  }
  visit(0, [])
  return combinations
}

function normalizedVoiceMovement(
  previous: readonly number[],
  current: readonly number[],
): number[] {
  const count = Math.min(previous.length, current.length)
  return Array.from({ length: count }, (_, index) => {
    const previousIndex = Math.round(
      index * (previous.length - 1) / Math.max(1, count - 1),
    )
    const currentIndex = Math.round(
      index * (current.length - 1) / Math.max(1, count - 1),
    )
    return current[currentIndex] - previous[previousIndex]
  })
}

function voicingStylePenalty(
  pitches: readonly number[],
  entry: HarmonicMapEntry,
  plan: SignatureVoiceLeadingPlan,
  previous: SignatureVoicingFrame | null,
): number {
  const gaps = pitches.slice(1).map((pitch, index) => pitch - pitches[index])
  const span = pitches.at(-1)! - pitches[0]
  const bassIsRoot = pitchClass(pitches[0]) === entry.parsed.rootPc
  let penalty = 0
  if (plan.style === "close-position") {
    penalty += Math.max(0, span - 16) * 0.8
    penalty += gaps.filter((gap) => gap > 7).length * 5
  } else if (plan.style === "open-spread") {
    penalty += Math.max(0, 11 - span) * 1.2
    penalty += Math.max(0, 5 - gaps[0]) * 1.4
  } else if (plan.style === "drop-2") {
    penalty += Math.max(0, 12 - span) * 1.1
    penalty += pitches.length < 4 ? 8 : 0
    penalty += gaps.filter((gap) => gap >= 5).length === 0 ? 6 : 0
  } else if (plan.style === "pedal-tone") {
    penalty +=
      plan.pedalPitchClass !== undefined &&
      !pitches.some((pitch) => pitchClass(pitch) === plan.pedalPitchClass)
        ? 12
        : 0
  } else if (plan.style === "inner-motion" && previous) {
    penalty += Math.abs(pitches[0] - previous.pitches[0]) * 1.3
  }
  // すべてをRoot Positionへ戻さず、自然な転回形を候補化する。
  if (bassIsRoot && plan.style !== "close-position") penalty += 2.5
  return penalty
}

function chooseVoicingFrame(
  note: MelodyNote,
  entry: HarmonicMapEntry,
  range: RangeSetting,
  voicePlan: SignatureVoiceLeadingPlan,
  stage: SignatureDevelopmentStage,
  previous: SignatureVoicingFrame | null,
): SignatureVoicingFrame {
  const addColor =
    (voicePlan.tensionPolicy === "color-on-lift" && stage === "register-lift") ||
    (voicePlan.tensionPolicy === "color-on-return" &&
      stage === "decorated-return")
  const chordTones = chordTonePitchClasses(entry.parsed)
  const allowed = [
    ...new Set([
      ...chordTones,
      ...(addColor ? safeVoicingColorPitchClasses(entry.parsed) : []),
      ...(voicePlan.style === "pedal-tone" &&
      voicePlan.pedalPitchClass !== undefined
        ? [voicePlan.pedalPitchClass]
        : []),
    ]),
  ]
  const available = Array.from(
    { length: Math.max(0, note.pitch - range.low - 2) },
    (_, index) => range.low + index,
  )
    .filter(
      (pitch) =>
        pitch <= note.pitch - 3 && allowed.includes(pitchClass(pitch)),
    )
    .slice(-14)
  const desiredSupportCount = Math.max(1, voicePlan.voiceCount - 1)
  let candidates: number[][] = []
  for (let count = desiredSupportCount; count >= 1; count--) {
    candidates = supportCombinations(available, count)
      .map((support) => [...support, note.pitch])
      .filter((pitches) =>
        pitches.slice(1).every(
          (pitch, index) => pitch - pitches[index] >= 3,
        ),
      )
    if (candidates.length > 0) break
  }
  if (candidates.length === 0) {
    return { startBeat: note.startBeat, pitches: [note.pitch], leadPitch: note.pitch }
  }

  const previousLead = previous?.leadPitch ?? note.pitch
  const leadMotion = note.pitch - previousLead
  let best = candidates[0]
  let bestCost = Infinity
  for (const pitches of candidates) {
    const movements = previous
      ? normalizedVoiceMovement(previous.pitches, pitches)
      : []
    const supportMovements = movements.slice(0, -1)
    const totalMovement = supportMovements.reduce(
      (sum, movement) => sum + Math.abs(movement),
      0,
    )
    const leapPenalty = supportMovements.reduce(
      (sum, movement) =>
        sum + Math.max(0, Math.abs(movement) - voicePlan.maxVoiceLeap) * 3,
      0,
    )
    const commonToneBonus = supportMovements.filter(
      (movement) => movement === 0,
    ).length * 5
    const movingSupport = supportMovements.filter((movement) => movement !== 0)
    const parallelPenalty =
      leadMotion !== 0 &&
      movingSupport.length > 0 &&
      movingSupport.every((movement) => Math.sign(movement) === Math.sign(leadMotion))
        ? 7
        : 0
    const contraryBonus =
      voicePlan.motion === "contrary" &&
      leadMotion !== 0 &&
      movingSupport.some((movement) => Math.sign(movement) === -Math.sign(leadMotion))
        ? 8
        : 0
    const obliqueBonus =
      voicePlan.motion === "oblique" &&
      supportMovements.some((movement) => movement === 0)
        ? 8
        : 0
    const smoothWeight = voicePlan.motion === "smooth" ? 1.45 : 1
    const colorBonus =
      addColor &&
      pitches.slice(0, -1).some(
        (pitch) => !chordTones.includes(pitchClass(pitch)),
      )
        ? 4
        : 0
    const cost =
      totalMovement * smoothWeight +
      leapPenalty +
      parallelPenalty +
      voicingStylePenalty(pitches, entry, voicePlan, previous) -
      commonToneBonus -
      contraryBonus -
      obliqueBonus -
      colorBonus
    if (cost < bestCost) {
      best = pitches
      bestCost = cost
    }
  }
  return {
    startBeat: note.startBeat,
    pitches: best,
    leadPitch: note.pitch,
  }
}

function canVoiceNote(
  note: MelodyNote,
  noteIndex: number,
  barIndex: number,
  stage: SignatureDevelopmentStage,
  voicedBars: ReadonlySet<number>,
  mode: SignatureVoicingMode,
): boolean {
  const structuralStage =
    stage === "establish" ||
    stage === "answer" ||
    stage === "register-lift" ||
    stage === "decorated-return" ||
    stage === "open-tail"
  return (
    !voicedBars.has(barIndex) &&
    note.durationBeats >= (mode === "broken-chord" ? 0.75 : 0.5) &&
    (structuralStage || (barIndex % 2 === 0 && noteIndex % 3 === 0)) &&
    note.plannedToneRole !== "approach-tone" &&
    note.plannedToneRole !== "neighbor-tone"
  )
}

function voiceLabel(index: number, total: number): "low" | "inner" | "upper" {
  if (index === 0) return "low"
  if (index === total - 1) return "upper"
  return "inner"
}

/** 構造点だけを和音化し、前のVoicing Frameから各声部を独立して接続する。 */
function applyBlockChordVoicing(
  leadNotes: readonly MelodyNote[],
  map: readonly HarmonicMapEntry[],
  range: RangeSetting,
  plan: SignaturePhrasePlan,
  beatsPerBar: number,
): VoicedSignaturePhrase {
  const result: MelodyNote[] = []
  const frames: SignatureVoicingFrame[] = []
  const voicedBars = new Set<number>()
  let previousFrame: SignatureVoicingFrame | null = null
  for (const [noteIndex, note] of leadNotes.entries()) {
    result.push(note)
    const barIndex = Math.floor(note.startBeat / beatsPerBar)
    const stage = plan.developmentStages[barIndex] ?? "repeat"
    if (!canVoiceNote(note, noteIndex, barIndex, stage, voicedBars, "block-chord")) continue
    const entry = chordAtBeat(map as HarmonicMapEntry[], note.startBeat)
    if (!entry) continue
    const frame = chooseVoicingFrame(
      note,
      entry,
      range,
      plan.voiceLeading,
      stage,
      previousFrame,
    )
    if (frame.pitches.length < 2) continue
    voicedBars.add(barIndex)
    frames.push(frame)
    previousFrame = frame
    const supportPitches = frame.pitches.slice(0, -1)
    for (const [voice, support] of supportPitches.entries()) {
      const label = voiceLabel(voice, supportPitches.length)
      result.push({
        id: `${note.id}-voice-${label}-${voice}`,
        startBeat: note.startBeat,
        durationBeats: note.durationBeats,
        pitch: support,
        velocity: Math.max(20, note.velocity - 14 - voice * 6),
        locks: [],
        plannedToneRole: isChordTone(entry.parsed, pitchClass(support))
          ? "chord-tone"
          : "tension-hold",
      })
    }
  }
  return { notes: result, frames }
}

function arpeggioOrder(
  frame: SignatureVoicingFrame,
  style: SignatureVoicingStyle,
  maximumNotes: number,
): number[] {
  const source = frame.pitches.slice(0, -1)
  let ordered = source
  if (style === "drop-2" && source.length >= 3) {
    ordered = [source[0], source[2], source[1]]
  } else if (style === "inner-motion" && source.length >= 3) {
    ordered = [source[0], source.at(-1)!, source.at(-2)!]
  }
  if (ordered.length <= maximumNotes) return ordered
  if (maximumNotes === 1) return [ordered[0]]
  if (maximumNotes === 2) return [ordered[0], ordered.at(-1)!]
  return [ordered[0], ordered[Math.floor(ordered.length / 2)], ordered.at(-1)!]
}

/** Blockと同じVoice Leading Frameを、短いアルペジオとして時間方向へ展開する。 */
function applyBrokenChordVoicing(
  leadNotes: readonly MelodyNote[],
  map: readonly HarmonicMapEntry[],
  range: RangeSetting,
  seed: number,
  plan: SignaturePhrasePlan,
  beatsPerBar: number,
): VoicedSignaturePhrase {
  const rng = new SeededRandom(seed ^ 0x27d4eb2f)
  const result: MelodyNote[] = []
  const frames: SignatureVoicingFrame[] = []
  const voicedBars = new Set<number>()
  let previousFrame: SignatureVoicingFrame | null = null
  leadNotes.forEach((note, index) => {
    // 核MotifのPitch / Onset / Durationは必ずそのまま残し、
    // Broken Chordは後続する支援声部としてだけ加える。
    result.push(note)
    const barIndex = Math.floor(note.startBeat / beatsPerBar)
    const stage = plan.developmentStages[barIndex] ?? "repeat"
    const entry = chordAtBeat(map as HarmonicMapEntry[], note.startBeat)
    if (
      !entry ||
      !canVoiceNote(note, index, barIndex, stage, voicedBars, "broken-chord")
    ) {
      return
    }
    const frame = chooseVoicingFrame(
      note,
      entry,
      range,
      plan.voiceLeading,
      stage,
      previousFrame,
    )
    if (frame.pitches.length < 2) {
      return
    }
    voicedBars.add(barIndex)
    frames.push(frame)
    previousFrame = frame
    const arpeggioOffset = Math.min(0.25, note.durationBeats / 2)
    const availableDuration = note.durationBeats - arpeggioOffset
    const maximumNotes = Math.max(1, Math.floor(availableDuration / 0.25))
    const ordered = arpeggioOrder(
      frame,
      plan.voiceLeading.style,
      maximumNotes,
    )
    const subDuration = availableDuration / ordered.length
    for (let step = 0; step < ordered.length; step++) {
      const startBeat = roundQuarter(
        note.startBeat + arpeggioOffset + step * subDuration,
      )
      const nextBeat =
        step === ordered.length - 1
          ? note.startBeat + note.durationBeats
          : roundQuarter(
              note.startBeat + arpeggioOffset + (step + 1) * subDuration,
            )
      const label = voiceLabel(step, ordered.length)
      // 分散音がコード境界を越えた場合、元leadのコードではなく実際の発音位置で
      // 音楽的役割を判定する。MIDI上は正しいコードトーンを誤ってtension扱いしない。
      const soundingEntry =
        chordAtBeat(map as HarmonicMapEntry[], startBeat) ?? entry
      const soundingAllowed = [
        ...new Set([
          ...chordTonePitchClasses(soundingEntry.parsed),
          ...safeVoicingColorPitchClasses(soundingEntry.parsed),
        ]),
      ]
      const soundingPitch = soundingAllowed.includes(
        pitchClass(ordered[step]),
      )
        ? ordered[step]
        : nearestAllowedPitch(ordered[step], soundingAllowed, range)
      result.push({
        id: `${note.id}-voice-${label}-arp${step}`,
        startBeat,
        durationBeats: Math.max(0.25, roundQuarter(nextBeat - startBeat)),
        pitch: soundingPitch,
        velocity: Math.max(20, note.velocity - step * 3 + rng.intBetween(-2, 2)),
        locks: [],
        plannedToneRole: isChordTone(
          soundingEntry.parsed,
          pitchClass(soundingPitch),
        )
          ? "chord-tone"
          : "tension-hold",
      })
    }
  })
  return { notes: result, frames }
}

function applyVoicing(
  voicingMode: SignatureVoicingMode,
  leadNotes: readonly MelodyNote[],
  map: readonly HarmonicMapEntry[],
  range: RangeSetting,
  seed: number,
  plan: SignaturePhrasePlan,
  beatsPerBar: number,
): VoicedSignaturePhrase {
  if (voicingMode === "block-chord") {
    return applyBlockChordVoicing(
      leadNotes,
      map,
      range,
      plan,
      beatsPerBar,
    )
  }
  if (voicingMode === "broken-chord") {
    return applyBrokenChordVoicing(
      leadNotes,
      map,
      range,
      seed,
      plan,
      beatsPerBar,
    )
  }
  return { notes: leadNotes.map((note) => ({ ...note })), frames: [] }
}

/** block-chord/broken-chordで追加した声部の音間隔・重複を評価する。単音のみなら常に1。 */
function computeVoicingQuality(notes: readonly MelodyNote[]): number {
  const groups = new Map<number, number[]>()
  for (const note of notes) {
    const key = Math.round(note.startBeat * 4)
    const group = groups.get(key) ?? []
    group.push(note.pitch)
    groups.set(key, group)
  }
  let chordGroups = 0
  let violations = 0
  for (const pitches of groups.values()) {
    if (pitches.length < 2) continue
    chordGroups++
    const sorted = [...pitches].sort((left, right) => left - right)
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index] - sorted[index - 1] < 3) violations++
    }
  }
  if (chordGroups === 0) return 1
  return clamp01(1 - violations / (chordGroups * 1.5))
}

function computeVoiceLeadingQuality(
  frames: readonly SignatureVoicingFrame[],
  plan: SignatureVoiceLeadingPlan,
): number {
  if (frames.length < 2) return 1
  let leapExcess = 0
  let movementCount = 0
  let parallelPairs = 0
  let motionMatches = 0
  let commonTonePairs = 0
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]
    const current = frames[index]
    const movements = normalizedVoiceMovement(previous.pitches, current.pitches)
    const supportMovements = movements.slice(0, -1)
    movementCount += supportMovements.length
    leapExcess += supportMovements.reduce(
      (sum, movement) =>
        sum + Math.max(0, Math.abs(movement) - plan.maxVoiceLeap),
      0,
    )
    const leadMovement = current.leadPitch - previous.leadPitch
    const moving = supportMovements.filter((movement) => movement !== 0)
    if (
      leadMovement !== 0 &&
      moving.length > 0 &&
      moving.every((movement) => Math.sign(movement) === Math.sign(leadMovement))
    ) {
      parallelPairs++
    }
    if (supportMovements.some((movement) => movement === 0)) {
      commonTonePairs++
      if (plan.motion === "oblique") motionMatches++
    }
    if (
      plan.motion === "contrary" &&
      leadMovement !== 0 &&
      moving.some((movement) => Math.sign(movement) === -Math.sign(leadMovement))
    ) {
      motionMatches++
    }
    if (
      plan.motion === "smooth" &&
      supportMovements.every((movement) => Math.abs(movement) <= 4)
    ) {
      motionMatches++
    }
  }
  const pairCount = frames.length - 1
  const leapPenalty = Math.min(
    0.45,
    leapExcess / Math.max(1, movementCount * 12),
  )
  const parallelPenalty = parallelPairs / pairCount * 0.24
  const motionBonus = motionMatches / pairCount * 0.12
  const commonToneBonus = commonTonePairs / pairCount * 0.08
  return clamp01(
    0.82 - leapPenalty - parallelPenalty + motionBonus + commonToneBonus,
  )
}

function intervalSequence(notes: readonly MelodyNote[]): number[] {
  return notes.slice(1).map((note, index) => note.pitch - notes[index].pitch)
}

function onsetGaps(notes: readonly MelodyNote[]): number[] {
  return notes
    .slice(1)
    .map((note, index) => roundQuarter(note.startBeat - notes[index].startBeat))
}

function countDirectionChanges(intervals: readonly number[]): number {
  const signs = intervals.map(Math.sign).filter((sign) => sign !== 0)
  return signs.slice(1).filter((sign, index) => sign !== signs[index]).length
}

function soundingTimeRatio(
  notes: readonly MelodyNote[],
  phraseLengthBeats: number,
): number {
  const ranges = [...notes]
    .sort((left, right) => left.startBeat - right.startBeat)
    .reduce<{ start: number; end: number }[]>((merged, note) => {
      const end = note.startBeat + note.durationBeats
      const last = merged.at(-1)
      if (last && note.startBeat <= last.end) last.end = Math.max(last.end, end)
      else merged.push({ start: note.startBeat, end })
      return merged
    }, [])
  return ranges.reduce((sum, range) => sum + range.end - range.start, 0) /
    Math.max(1, phraseLengthBeats)
}

function scoreSignaturePhrase(
  notes: MelodyNote[],
  plan: SignaturePhrasePlan,
  map: HarmonicMapEntry[],
  phraseLengthBeats: number,
  motifPath: readonly number[],
  fullNotes: MelodyNote[] = notes,
  voicingFrames: readonly SignatureVoicingFrame[] = [],
): SignaturePhraseScore {
  if (notes.length < 3) {
    return {
      identity: 0,
      openingImpact: 0,
      rhythmicIdentity: 0,
      contourIdentity: 0,
      developmentPotential: 0,
      standaloneStrength: 0,
      worldBuilding: 0,
      motifMemorability: 0,
      motifIntegrity: 0,
      repetitionDrive: 0,
      longRangeCoherence: 0,
      variationBalance: 0,
      silenceUse: 0,
      arpeggioPenalty: 1,
      mechanicalPenalty: 1,
      voicingQuality: 1,
      voiceLeadingQuality: 1,
      audacity: 0,
      controlledRisk: 0,
      surpriseCoherence: 0,
      harmonicNarrative: 0,
      thematicForeshadowing: 0,
      rhythmicComplement: 0,
      compositionPurpose: 0,
      overall: 0,
    }
  }
  const intervals = intervalSequence(notes)
  const gaps = onsetGaps(notes)
  const durations = notes.map((note) => note.durationBeats)
  const pitchRange =
    Math.max(...notes.map((note) => note.pitch)) -
    Math.min(...notes.map((note) => note.pitch))
  const uniqueIntervalCells = new Set(
    intervals.slice(1).map((value, index) => `${intervals[index]}:${value}`),
  ).size
  const identity = clamp01(
    uniqueIntervalCells / 4 * 0.55 +
      new Set(gaps).size / 4 * 0.45,
  )
  const firstInterval = Math.abs(intervals[0] ?? 0)
  const openingImpact = clamp01(
    (notes[0].startBeat <= 0.75 ? 0.32 : 0.18) +
      (notes[0].durationBeats >= 0.75 ? 0.24 : 0.14) +
      (firstInterval >= 3 ? 0.28 : firstInterval > 0 ? 0.2 : 0.12) +
      (gaps[0] !== gaps[1] ? 0.16 : 0.08),
  )
  const sounding = notes.reduce(
    (sum, note) => sum + note.durationBeats,
    0,
  )
  const restRatio = clamp01(1 - sounding / Math.max(1, phraseLengthBeats))
  const syncopated = notes.filter(
    (note) => Math.abs(note.startBeat * 2 - Math.round(note.startBeat * 2)) > 0.05,
  ).length / notes.length
  const rhythmicIdentity = clamp01(
    Math.min(1, new Set(durations).size / 3) * 0.35 +
      Math.min(1, new Set(gaps).size / 3) * 0.3 +
      Math.min(1, restRatio / 0.35) * 0.2 +
      Math.min(1, syncopated / 0.35) * 0.15,
  )
  const directionChanges = countDirectionChanges(intervals)
  const contourIdentity = clamp01(
    Math.min(1, pitchRange / 9) * 0.55 +
      Math.min(1, directionChanges / 2) * 0.3 +
      (intervals.some((interval) => Math.abs(interval) >= 4) ? 0.15 : 0.06),
  )
  const firstHalf = intervals.slice(0, Math.max(1, Math.floor(intervals.length / 2)))
  const secondHalf = intervals.slice(Math.floor(intervals.length / 2))
  const sharedSigns = secondHalf.filter((interval, index) => {
    const source = firstHalf[index % firstHalf.length]
    return Math.sign(interval) === Math.sign(source)
  }).length / Math.max(1, secondHalf.length)
  const exactRepeat = secondHalf.length > 0 && secondHalf.every(
    (interval, index) => interval === firstHalf[index % firstHalf.length],
  )
  const developmentPotential = clamp01(
    (sharedSigns > 0.35 && sharedSigns < 0.9 ? 0.5 : 0.28) +
      (!exactRepeat ? 0.28 : 0.08) +
      (plan.variationStrategy !== "displacement" ? 0.22 : 0.16),
  )
  const harmonicFit = notes.filter((note) => {
    const entry = chordAtBeat(map, note.startBeat)
    return entry
      ? isChordTone(entry.parsed, pitchClass(note.pitch)) ||
          isTensionTone(entry.parsed, pitchClass(note.pitch))
      : false
  }).length / notes.length
  const chordToneRatio = notes.filter((note) => {
    const entry = chordAtBeat(map, note.startBeat)
    return entry ? isChordTone(entry.parsed, pitchClass(note.pitch)) : false
  }).length / notes.length
  const standaloneStrength = clamp01(
    Math.min(1, notes.length / 6) * 0.25 +
      (harmonicFit >= 0.55 ? 0.28 : harmonicFit * 0.4) +
      (pitchRange >= 3 && pitchRange <= 16 ? 0.24 : 0.12) +
      (notes.at(-1)!.durationBeats >= 0.5 ? 0.13 : 0.07) +
      (restRatio >= 0.08 ? 0.1 : 0.03),
  )
  const repeatedIntervalCells = intervals.filter(
    (interval, index) =>
      index > 0 && intervals.slice(0, index).includes(interval),
  ).length / Math.max(1, intervals.length)
  const expectedMotifIntervals = motifPath.slice(
    1,
    Math.min(motifPath.length, intervals.length + 1),
  )
  const motifIntegrity = clamp01(
    sequenceSimilarity(
      intervals.slice(0, expectedMotifIntervals.length),
      expectedMotifIntervals,
      2,
    ),
  )
  const shortKernel = Math.max(2, Math.min(plan.motifSize, 5))
  const openingNoteCount = notes.filter(
    (note) => note.startBeat < phraseLengthBeats / Math.max(1, plan.lengthBars),
  ).length
  const motifMemorability = clamp01(
    (openingNoteCount >= 3 && openingNoteCount <= 7 ? 0.28 : 0.14) +
      Math.min(1, repeatedIntervalCells / 0.45) * 0.28 +
      (shortKernel <= 5 ? 0.2 : 0.08) +
      (new Set(intervals.map((interval) => Math.abs(interval))).size <= 5
        ? 0.16
        : 0.06) +
      (gaps.some((gap, index) => index > 0 && gaps.slice(0, index).includes(gap))
        ? 0.08
        : 0.02),
  )
  const beatsPerStatement = phraseLengthBeats / Math.max(1, plan.lengthBars)
  const firstStatement = notes.filter((note) => note.startBeat < beatsPerStatement)
  const secondStatement = notes.filter((note) => note.startBeat >= beatsPerStatement)
  const recurrence =
    secondStatement.length > 0
      ? sequenceSimilarity(
          onsetGaps(firstStatement),
          onsetGaps(secondStatement),
          0.25,
        ) *
          0.45 +
        sequenceSimilarity(
          intervalSequence(firstStatement).map(Math.sign),
          intervalSequence(secondStatement).map(Math.sign),
        ) *
          0.55
      : repeatedIntervalCells
  const barNotes = Array.from({ length: plan.lengthBars }, (_, barIndex) =>
    notes.filter(
      (note) =>
        note.startBeat >= barIndex * beatsPerStatement &&
        note.startBeat < (barIndex + 1) * beatsPerStatement,
    ),
  )
  const normalizedOnsets = (items: MelodyNote[], barIndex: number) =>
    items.map((note) =>
      roundQuarter(note.startBeat - barIndex * beatsPerStatement),
    )
  const barSimilarities = barNotes.slice(1).map((items, index) => {
    const barIndex = index + 1
    const rhythm = sequenceSimilarity(
      normalizedOnsets(barNotes[0], 0),
      normalizedOnsets(items, barIndex),
      0.25,
    )
    const intervalsForBar = intervalSequence(items)
    const contour = sequenceSimilarity(
      intervalSequence(barNotes[0]).map(Math.sign),
      intervalsForBar.map(Math.sign),
    )
    return rhythm * 0.48 + contour * 0.52
  })
  const averageBarSimilarity = mean(barSimilarities)
  const finalReturnSimilarity = barSimilarities.at(-1) ?? recurrence
  const longRangeCoherence = clamp01(
    finalReturnSimilarity * 0.5 +
      motifIntegrity * 0.25 +
      (barSimilarities.some((similarity) => similarity >= 0.55) ? 0.15 : 0.04) +
      (new Set(plan.developmentStages).size >= Math.min(4, plan.lengthBars)
        ? 0.1
        : 0.04),
  )
  const variationBalance = clamp01(
    plan.lengthBars <= 2
      ? 0.72
      : (1 - Math.abs(averageBarSimilarity - 0.58) / 0.58) * 0.72 +
          (barSimilarities.some((similarity) => similarity < 0.5) ? 0.14 : 0.04) +
          (barSimilarities.some((similarity) => similarity > 0.62) ? 0.14 : 0.04),
  )
  const repetitionDrive = clamp01(
    Math.min(1, recurrence / 0.7) * 0.65 +
      (recurrence < 0.98 ? 0.2 : 0.05) +
      plan.repetitionStrength * 0.15,
  )
  const silenceUse = clamp01(
    1 -
      Math.abs(restRatio - plan.targetSilenceRatio) /
        Math.max(0.2, plan.targetSilenceRatio),
  )
  const worldBuilding = clamp01(
    plan.archetype === "atmospheric-gateway"
      ? silenceUse * 0.42 +
          Math.min(1, Math.max(...durations) / 1.5) * 0.28 +
          (chordToneRatio < 0.78 ? 0.18 : 0.06) +
          (notes[0].velocity < 84 ? 0.12 : 0.04)
      : plan.archetype === "obsessive-motor"
        ? repetitionDrive * 0.42 +
          motifMemorability * 0.28 +
          rhythmicIdentity * 0.2 +
          (pitchRange <= 10 ? 0.1 : 0.04)
        : rhythmicIdentity * 0.32 +
          contourIdentity * 0.28 +
          openingImpact * 0.24 +
          (pitchRange >= 5 ? 0.16 : 0.06),
  )
  const thirdMotion = intervals.filter(
    (interval) => Math.abs(interval) === 3 || Math.abs(interval) === 4,
  ).length / Math.max(1, intervals.length)
  const monotonic = countDirectionChanges(intervals) === 0
  const arpeggioPenalty = clamp01(
    Math.max(0, chordToneRatio - 0.72) * 1.8 +
      (thirdMotion > 0.65 && monotonic ? 0.35 : 0),
  )
  const uniformDuration = new Set(durations).size === 1
  const stepwiseStaircase =
    monotonic &&
    intervals.length >= 3 &&
    intervals.filter((interval) => Math.abs(interval) <= 2).length /
      intervals.length >=
      0.75
  const overfilled = notes.length / Math.max(1, phraseLengthBeats) > 1.25
  const mechanicalPenalty = clamp01(
    (uniformDuration ? 0.28 : 0) +
      (stepwiseStaircase ? 0.38 : 0) +
      (overfilled ? 0.25 : 0) +
      (recurrence > 0.985 ? 0.16 : 0) +
      (barSimilarities.filter((similarity) => similarity > 0.985).length > 2
        ? 0.18
        : 0),
  )
  const structuralNotes = notes.filter(
    (note, index) =>
      index === 0 ||
      index === notes.length - 1 ||
      Math.abs(note.startBeat % Math.max(1, beatsPerStatement)) < 0.05,
  )
  const targetMatches = structuralNotes.filter((note) => {
    const target = targetToneAtBeat(plan, note.startBeat)
    return target?.pitchClasses.includes(pitchClass(note.pitch)) ?? false
  }).length
  const harmonicNarrative = clamp01(
    harmonicFit * 0.45 +
      targetMatches / Math.max(1, structuralNotes.length) * 0.55,
  )
  const referenceIntervals =
    plan.compositionContext?.referenceMotifIntervals ?? []
  const candidateIdentityCell = intervals.slice(0, referenceIntervals.length)
  const transformedRelation = referenceIntervals.length >= 2
    ? sequenceSimilarity(
        candidateIdentityCell.map(Math.abs),
        referenceIntervals.map(Math.abs),
        2,
      )
    : 0.65
  const exactMelodyCopy = referenceIntervals.length >= 2
    ? sequenceSimilarity(candidateIdentityCell, referenceIntervals, 0)
    : 0
  const thematicForeshadowing = clamp01(
    transformedRelation * 0.58 +
      (1 - exactMelodyCopy) * 0.3 +
      (candidateIdentityCell.some(
        (interval, index) =>
          Math.sign(interval) !== Math.sign(referenceIntervals[index] ?? interval),
      )
        ? 0.12
        : 0.05),
  )
  const referenceGaps = plan.compositionContext?.referenceRhythmGaps ?? []
  const rhythmRelation = referenceGaps.length >= 2
    ? sequenceSimilarity(gaps.slice(0, referenceGaps.length), referenceGaps, 0.25)
    : 0.35
  // 完全一致でも無関係でもなく、旋律と認識可能な対話をする距離を高く評価する。
  const rhythmicComplement = clamp01(
    1 - Math.abs(rhythmRelation - 0.42) / 0.58,
  )
  const opportunity = plan.compositionContext?.opportunity
  const opportunityFit = opportunity === "motif-foreshadowing"
    ? thematicForeshadowing
    : opportunity === "rhythmic-counter-identity"
      ? rhythmicComplement
      : opportunity === "harmonic-identity" ||
          opportunity === "tension-premonition"
        ? harmonicNarrative
        : opportunity === "register-contrast"
          ? clamp01(pitchRange / 10 * 0.4 + standaloneStrength * 0.6)
          : openingImpact
  const compositionPurpose = clamp01(
    opportunityFit * 0.72 +
      ((plan.compositionContext?.opportunityScore ?? 70) / 100) * 0.28,
  )
  const baseWeighted =
    identity * 0.07 +
    openingImpact * 0.1 +
    rhythmicIdentity * 0.11 +
    contourIdentity * 0.08 +
    developmentPotential * 0.08 +
    standaloneStrength * 0.04 +
    worldBuilding * 0.11 +
    motifMemorability * 0.13 +
    motifIntegrity * 0.06 +
    repetitionDrive * 0.05 +
    longRangeCoherence * 0.08 +
    variationBalance * 0.06 +
    silenceUse * 0.03
  const weighted =
    baseWeighted * 0.82 +
    harmonicNarrative * 0.07 +
    thematicForeshadowing * 0.04 +
    rhythmicComplement * 0.03 +
    compositionPurpose * 0.04
  const voicingExpansion = fullNotes.length / Math.max(1, notes.length)
  const voicingDensityQuality =
    plan.voicingMode === "single-line"
      ? 1
      : clamp01(1 - Math.max(0, voicingExpansion - 1.65) * 0.9)
  const voicingQuality =
    computeVoicingQuality(fullNotes) * 0.72 + voicingDensityQuality * 0.28
  const voiceLeadingQuality =
    plan.voicingMode === "single-line"
      ? 1
      : computeVoiceLeadingQuality(voicingFrames, plan.voiceLeading)
  const largestLeap = Math.max(0, ...intervals.map((interval) => Math.abs(interval)))
  const largestGap = Math.max(0, ...gaps)
  const intentionalTensions = notes.filter(
    (note) =>
      note.plannedToneRole === "approach-tone" ||
      note.plannedToneRole === "suspension" ||
      note.plannedToneRole === "tension-hold",
  ).length
  const audacity = clamp01(
    Math.min(1, largestLeap / 9) * 0.34 +
      Math.min(1, syncopated / 0.3) * 0.2 +
      Math.min(1, largestGap / 2.5) * 0.2 +
      Math.min(1, intentionalTensions / 2) * 0.14 +
      (plan.creativeRisk.structuralDevice !== "none" ? 0.12 : 0),
  )
  const recoveredLeaps = intervals.filter((interval, index) => {
    const next = intervals[index + 1]
    return (
      Math.abs(interval) >= 6 &&
      next !== undefined &&
      Math.sign(next) === -Math.sign(interval) &&
      Math.abs(next) <= 5
    )
  }).length
  const leapCount = intervals.filter((interval) => Math.abs(interval) >= 6).length
  const resolutionControl = leapCount === 0
    ? 0.72
    : Math.min(1, recoveredLeaps / leapCount)
  const controlledRisk = clamp01(
    harmonicFit * 0.34 +
      resolutionControl * 0.32 +
      (mechanicalPenalty <= 0.45 ? 0.16 : 0.05) +
      (pitchRange <= 19 ? 0.08 : 0.03) +
      (notes.every((note) => note.durationBeats >= 0.25) ? 0.1 : 0),
  )
  const surpriseCoherence = clamp01(
    motifIntegrity * 0.35 +
      recurrence * 0.3 +
      longRangeCoherence * 0.2 +
      (finalReturnSimilarity >= 0.38 ? 0.15 : 0.05),
  )
  const riskTargetFit = clamp01(
    1 - Math.abs(audacity - plan.creativeRisk.targetAudacity),
  )
  const creativeBonus =
    plan.creativeRisk.risk === "focused"
      ? 0
      : riskTargetFit * 0.035 + controlledRisk * 0.035 + surpriseCoherence * 0.025
  return {
    identity,
    openingImpact,
    rhythmicIdentity,
    contourIdentity,
    developmentPotential,
    standaloneStrength,
    worldBuilding,
    motifMemorability,
    motifIntegrity,
    repetitionDrive,
    longRangeCoherence,
    variationBalance,
    silenceUse,
    arpeggioPenalty,
    mechanicalPenalty,
    voicingQuality,
    voiceLeadingQuality,
    audacity,
    controlledRisk,
    surpriseCoherence,
    harmonicNarrative,
    thematicForeshadowing,
    rhythmicComplement,
    compositionPurpose,
    overall:
      Math.round(
        clamp01(
          weighted -
            arpeggioPenalty * 0.18 -
            mechanicalPenalty * 0.22 -
            (1 - voicingQuality) * 0.1 -
            (1 - voiceLeadingQuality) * 0.1 +
            creativeBonus,
        ) * 10000,
      ) / 100,
  }
}

function buildSignaturePhrase(
  input: GenerateSignaturePhrasesInput,
  seed: number,
  poolIndex: number,
  analysis: SignaturePhraseContextAnalysis,
): BuiltSignaturePhrase {
  const plan = planSignaturePhrase(input, seed, poolIndex, analysis)
  const phraseLengthBeats = Math.min(
    input.totalBeats,
    plan.lengthBars * input.beatsPerBar,
  )
  const chords = phraseChords(input, phraseLengthBeats)
  const map = buildHarmonicMap(chords)
  const baseEvents = buildSignatureRhythmSkeleton(plan, input.beatsPerBar)
  const events =
    input.density === "sparse"
      ? baseEvents.filter(
          (_, index) => index % 4 !== 2 || baseEvents.length <= 4,
        )
      : baseEvents
  const motifOptions = MOTIF_PATHS[plan.archetype]
  const baseMotifPath = motifOptions[plan.motifVariant]
  const profiledMotifPath = baseMotifPath.map((step) => {
    if (input.drama === "restrained") {
      return Math.sign(step) * Math.min(3, Math.abs(step))
    }
    if (input.drama === "open" && Math.abs(step) >= 3) {
      return step + Math.sign(step)
    }
    return step
  })
  const motifPath = motifPathForCreativeRisk(
    contextualMotifPath(profiledMotifPath, plan),
    plan,
  )
  const rawLeadNotes = placePitchPath(
    input,
    plan,
    events,
    map,
    seed,
    motifPath,
    phraseLengthBeats,
  )
  const rawVoiced = applyVoicing(
    plan.voicingMode,
    rawLeadNotes,
    map,
    input.range,
    seed,
    plan,
    input.beatsPerBar,
  )
  const score = scoreSignaturePhrase(
    rawLeadNotes,
    plan,
    map,
    phraseLengthBeats,
    motifPath,
    rawVoiced.notes,
    rawVoiced.frames,
  )
  const leadNotes = enforceHarmonicIntegrity(
    rawLeadNotes,
    chords,
    input.range,
  ).notes
  // 補正済みLeadを入力にVoicingを再解決し、声部間隔とvoice leadingを維持する。
  // Candidate選抜用Scoreは元の作曲案で算出し、補正が創作方向の分布を偏らせないようにする。
  const voiced = applyVoicing(
    plan.voicingMode,
    leadNotes,
    map,
    input.range,
    seed,
    plan,
    input.beatsPerBar,
  )
  const notes = voiced.notes
  return {
    notes,
    leadNotes,
    plan,
    phraseLengthBeats,
    seed,
    score,
  }
}

function sequenceSimilarity(
  left: readonly number[],
  right: readonly number[],
  tolerance = 0,
): number {
  const length = Math.min(left.length, right.length)
  if (length === 0) return left.length === right.length ? 1 : 0
  const matches = Array.from({ length }, (_, index) =>
    Math.abs(left[index] - right[index]) <= tolerance ? 1 : 0,
  )
  return mean(matches) *
    (Math.min(left.length, right.length) / Math.max(left.length, right.length))
}

export function signaturePhraseSimilarity(
  left: Pick<BuiltSignaturePhrase, "notes" | "plan"> &
    Partial<Pick<BuiltSignaturePhrase, "leadNotes">>,
  right: Pick<BuiltSignaturePhrase, "notes" | "plan"> &
    Partial<Pick<BuiltSignaturePhrase, "leadNotes">>,
): SignaturePhraseSimilarity {
  // 和音展開後のnotesではなく、旋律の核であるleadNotesで比較する
  // (block-chord/broken-chordが加える声部の数で類似度が薄まらないようにする)。
  // leadNotesを持たない呼び出し元(公開Candidate型)にはnotesへ後方互換フォールバックする。
  const leftMelodic = left.leadNotes ?? left.notes
  const rightMelodic = right.leadNotes ?? right.notes
  const leftOnsets = leftMelodic.map((note) => roundQuarter(note.startBeat))
  const rightOnsets = rightMelodic.map((note) => roundQuarter(note.startBeat))
  const leftDurations = leftMelodic.map((note) => roundQuarter(note.durationBeats))
  const rightDurations = rightMelodic.map((note) => roundQuarter(note.durationBeats))
  const leftIntervals = intervalSequence(leftMelodic)
  const rightIntervals = intervalSequence(rightMelodic)
  const leftContour = leftIntervals.map(Math.sign)
  const rightContour = rightIntervals.map(Math.sign)
  const leftRisk = creativeRiskOf(left.plan)
  const rightRisk = creativeRiskOf(right.plan)
  const rhythmSimilarity = sequenceSimilarity(leftOnsets, rightOnsets, 0.01)
  const intervalSimilarity = sequenceSimilarity(leftIntervals, rightIntervals, 1)
  const contourSimilarity = sequenceSimilarity(leftContour, rightContour)
  const durationSimilarity = sequenceSimilarity(leftDurations, rightDurations, 0.01)
  const planSimilarity =
    (left.plan.archetype === right.plan.archetype ? 0.18 : 0) +
    (left.plan.rhythmIdentity === right.plan.rhythmIdentity ? 0.18 : 0) +
    (left.plan.contour === right.plan.contour ? 0.1 : 0) +
    (left.plan.variationStrategy === right.plan.variationStrategy ? 0.08 : 0) +
    (left.plan.lengthBars === right.plan.lengthBars ? 0.06 : 0) +
    (left.plan.voicingMode === right.plan.voicingMode ? 0.07 : 0) +
    (left.plan.voiceLeading?.style === right.plan.voiceLeading?.style ? 0.05 : 0) +
    (left.plan.voiceLeading?.motion === right.plan.voiceLeading?.motion ? 0.04 : 0) +
    (leftRisk.risk === rightRisk.risk ? 0.1 : 0) +
    (leftRisk.rhythmicDevice === rightRisk.rhythmicDevice ? 0.05 : 0) +
    (leftRisk.pitchDevice === rightRisk.pitchDevice ? 0.05 : 0) +
    (leftRisk.structuralDevice === rightRisk.structuralDevice ? 0.04 : 0) +
    (left.plan.compositionContext?.opportunity ===
    right.plan.compositionContext?.opportunity
      ? 0.08
      : 0)
  return {
    rhythmSimilarity,
    intervalSimilarity,
    contourSimilarity,
    durationSimilarity,
    planSimilarity,
    overallSimilarity: clamp01(
      rhythmSimilarity * 0.3 +
        intervalSimilarity * 0.24 +
        contourSimilarity * 0.18 +
        durationSimilarity * 0.13 +
        planSimilarity * 0.15,
    ),
  }
}

function selectDiversePool(
  pool: BuiltSignaturePhrase[],
  finalCount: number,
): {
  candidate: BuiltSignaturePhrase
  selectionScore: number
  similarities: SignaturePhraseSimilarity[]
}[] {
  const qualityEligible = pool.filter(
    (candidate) =>
      candidate.score.overall >= QUALITY_FLOOR &&
      candidate.score.mechanicalPenalty <= 0.5 &&
      candidate.score.voicingQuality >= 0.5 &&
      candidate.score.voiceLeadingQuality >= 0.58 &&
      (candidate.score.compositionPurpose ?? 0.7) >= 0.48 &&
      (candidate.score.harmonicNarrative ?? 0.7) >= 0.42,
  )
  const hookEligible = qualityEligible.filter(
    (candidate) =>
      (candidate.score.openingImpact >= 0.55 &&
        candidate.score.motifMemorability >= 0.55 &&
        candidate.score.motifIntegrity >= 0.4 &&
        candidate.score.worldBuilding >= 0.5 &&
        (candidate.plan.lengthBars < 4 ||
          (candidate.score.longRangeCoherence >= 0.42 &&
            candidate.score.variationBalance >= 0.38))) ||
      (candidate.plan.creativeRisk.risk !== "focused" &&
        candidate.score.openingImpact >= 0.5 &&
        candidate.score.motifMemorability >= 0.48 &&
        candidate.score.controlledRisk >= 0.55 &&
        candidate.score.surpriseCoherence >= 0.38),
  )
  const source =
    hookEligible.length >= finalCount
      ? hookEligible
      : qualityEligible.length >= finalCount
        ? qualityEligible
      : [...pool].sort((left, right) => right.score.overall - left.score.overall)
  const selected: {
    candidate: BuiltSignaturePhrase
    selectionScore: number
    similarities: SignaturePhraseSimilarity[]
  }[] = []
  const remaining = [...source]
  const radicalTarget = Math.max(1, Math.round(finalCount / 3))
  const boldTarget = Math.max(1, Math.round(finalCount * 0.42))
  const focusedTarget = Math.max(1, finalCount - radicalTarget - boldTarget)

  while (selected.length < finalCount && remaining.length > 0) {
    let bestIndex = 0
    let bestScore = -Infinity
    let bestSimilarities: SignaturePhraseSimilarity[] = []
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index]
      const similarities = selected.map((item) =>
        signaturePhraseSimilarity(candidate, item.candidate),
      )
      const maximumSimilarity =
        similarities.length > 0
          ? Math.max(...similarities.map((value) => value.overallSimilarity))
          : 0
      const diversity = 1 - maximumSimilarity
      const sameRhythmCount = selected.filter(
        (item) =>
          item.candidate.plan.rhythmIdentity === candidate.plan.rhythmIdentity,
      ).length
      const sameContourCount = selected.filter(
        (item) => item.candidate.plan.contour === candidate.plan.contour,
      ).length
      const sameArchetypeCount = selected.filter(
        (item) => item.candidate.plan.archetype === candidate.plan.archetype,
      ).length
      const sameVoicingCount = selected.filter(
        (item) => item.candidate.plan.voicingMode === candidate.plan.voicingMode,
      ).length
      const sameVoicingStyleCount = selected.filter(
        (item) =>
          item.candidate.plan.voiceLeading.style ===
          candidate.plan.voiceLeading.style,
      ).length
      const sameRiskCount = selected.filter(
        (item) =>
          item.candidate.plan.creativeRisk.risk ===
          candidate.plan.creativeRisk.risk,
      ).length
      const sameOpportunityCount = selected.filter(
        (item) =>
          item.candidate.plan.compositionContext?.opportunity ===
          candidate.plan.compositionContext?.opportunity,
      ).length
      const selectedRadical = selected.filter(
        (item) => item.candidate.plan.creativeRisk.risk === "radical",
      ).length
      const selectedBold = selected.filter(
        (item) => item.candidate.plan.creativeRisk.risk === "bold",
      ).length
      const selectedFocused = selected.filter(
        (item) => item.candidate.plan.creativeRisk.risk === "focused",
      ).length
      const archetypeAlreadyRepresented = sameArchetypeCount > 0
      const voicingAlreadyRepresented = sameVoicingCount > 0
      const sparseAtmosphereAlreadyRepresented = selected.some(
        (item) =>
          item.candidate.plan.archetype === "atmospheric-gateway" &&
          soundingTimeRatio(
            item.candidate.leadNotes,
            item.candidate.phraseLengthBeats,
          ) < 0.62,
      )
      const redundancyPenalty =
        sameRhythmCount * 4 + sameContourCount * 1.5 +
        sameArchetypeCount * 2.5 +
        sameVoicingCount * 1.5 +
        sameVoicingStyleCount * 1.25 +
        sameRiskCount * 1.25 +
        sameOpportunityCount * 3.5 +
        (maximumSimilarity > 0.78 ? 18 : 0)
      const archetypeCoverageBonus =
        selected.length < 6 && !archetypeAlreadyRepresented ? 18 : 0
      // 単音のみに偏らないよう、和音系Voicingが未選出のうちは軽く後押しする
      // (single-lineは既定配分が最も厚いため、ここでは優遇しない)。
      const voicingCoverageBonus =
        selected.length < 6 &&
        !voicingAlreadyRepresented &&
        candidate.plan.voicingMode !== "single-line"
          ? 10
          : 0
      const sparseAtmosphereCoverageBonus =
        selected.length < 8 &&
        !sparseAtmosphereAlreadyRepresented &&
        candidate.plan.archetype === "atmospheric-gateway" &&
        soundingTimeRatio(candidate.leadNotes, candidate.phraseLengthBeats) < 0.62
          ? 12
          : 0
      const creativeRiskCoverageBonus =
        candidate.plan.creativeRisk.risk === "radical" &&
        selectedRadical < radicalTarget
          ? 34
          : candidate.plan.creativeRisk.risk === "bold" &&
              selectedBold < boldTarget
            ? 24
            : candidate.plan.creativeRisk.risk === "focused" &&
                selectedFocused < focusedTarget
              ? 20
            : 0
      const opportunityCoverageBonus =
        selected.length < 8 && sameOpportunityCount === 0 ? 14 : 0
      const controlledAdventureBonus =
        candidate.plan.creativeRisk.risk === "focused"
          ? 0
          : candidate.score.audacity * 8 +
            candidate.score.controlledRisk * 8 +
            candidate.score.surpriseCoherence * 6
      const score =
        candidate.score.overall * 0.62 +
        diversity * 100 * 0.38 -
        redundancyPenalty +
        archetypeCoverageBonus +
        voicingCoverageBonus +
        sparseAtmosphereCoverageBonus +
        creativeRiskCoverageBonus +
        opportunityCoverageBonus +
        controlledAdventureBonus
      if (score > bestScore) {
        bestIndex = index
        bestScore = score
        bestSimilarities = similarities
      }
    }
    selected.push({
      candidate: remaining.splice(bestIndex, 1)[0],
      selectionScore: Math.round(bestScore * 100) / 100,
      similarities: bestSimilarities,
    })
  }
  return selected
}

export function generateSignaturePhraseCandidates(
  input: GenerateSignaturePhrasesInput,
): Omit<SignaturePhraseCandidate, "id" | "batchId" | "createdAt">[] {
  const finalCount = Math.max(1, input.finalCandidateCount ?? DEFAULT_FINAL_COUNT)
  const poolSize = Math.max(
    input.candidatePoolSize ?? DEFAULT_POOL_SIZE,
    finalCount,
  )
  const analysis = analyzeSignaturePhraseContext({
    chords: input.chords,
    referenceMelody: input.referenceMelody,
    totalBeats: input.totalBeats,
  })
  const pool = Array.from({ length: poolSize }, (_, poolIndex) =>
    buildSignaturePhrase(
      input,
      (input.seed + poolIndex * 16127) >>> 0,
      poolIndex,
      analysis,
    ),
  )
  return selectDiversePool(pool, finalCount).map(
    ({ candidate, selectionScore, similarities }, index) => ({
      sectionId: input.sectionId,
      name: `Signature ${index + 1}`,
      seed: candidate.seed,
      notes: candidate.notes,
      plan: candidate.plan,
      phraseLengthBeats: candidate.phraseLengthBeats,
      score: candidate.score,
      selectionScore,
      similarityToSelected: similarities,
    }),
  )
}

export function regenerateSignaturePhraseCandidate(
  input: GenerateSignaturePhrasesInput,
  current: Pick<SignaturePhraseCandidate, "seed" | "notes" | "plan">,
  avoid: Pick<SignaturePhraseCandidate, "notes" | "plan">[],
): Omit<SignaturePhraseCandidate, "id" | "batchId" | "createdAt"> {
  const analysis = analyzeSignaturePhraseContext({
    chords: input.chords,
    referenceMelody: input.referenceMelody,
    totalBeats: input.totalBeats,
  })
  const pool = Array.from({ length: 24 }, (_, index) =>
    buildSignaturePhrase(
      input,
      (current.seed + 104729 + index * 16127) >>> 0,
      index + 7,
      analysis,
    ),
  )
  const ranked = pool
    .map((candidate) => {
      const similarities = avoid.map((other) =>
        signaturePhraseSimilarity(candidate, other),
      )
      const diversity =
        similarities.length === 0
          ? 1
          : 1 - Math.max(...similarities.map((value) => value.overallSimilarity))
      const currentSimilarity = signaturePhraseSimilarity(candidate, current)
      return {
        candidate,
        similarities,
        selectionScore:
          candidate.score.overall * 0.58 +
          diversity * 100 * 0.3 +
          (1 - currentSimilarity.overallSimilarity) * 100 * 0.12 -
          (currentSimilarity.rhythmSimilarity > 0.96 ? 16 : 0),
      }
    })
    .sort((left, right) => right.selectionScore - left.selectionScore)
  const best = ranked[0]
  return {
    sectionId: input.sectionId,
    name: "Regenerated Signature",
    seed: best.candidate.seed,
    notes: best.candidate.notes,
    plan: best.candidate.plan,
    phraseLengthBeats: best.candidate.phraseLengthBeats,
    score: best.candidate.score,
    selectionScore: Math.round(best.selectionScore * 100) / 100,
    similarityToSelected: best.similarities,
  }
}
