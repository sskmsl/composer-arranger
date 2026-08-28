import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { ChordEvent, SongProfileId } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import type { SectionRole } from "@/core/section"
import {
  techniquePreferenceWeight,
  type ResolvedComposerRules,
} from "@/composer-intelligence"
import type {
  CounterCompositionPlan,
  CounterContourPlan,
  CounterCreativeRisk,
  CounterDevelopmentStrategy,
  CounterDialogueIntent,
  CounterEndingStrategy,
  CounterGeneratorStyle,
  CounterMusicalQuality,
  CounterRhythmGrammar,
  ReactiveLayerCandidate,
  ReactiveLayerRole,
} from "@/core/reactiveLayer"
import { keyScalePitchClasses } from "@/core/scale"
import {
  analyzeCounterContext,
  assessReactiveActiveContextFit,
  assessReactiveNegativeSpaceFit,
  assessReactiveRoleComplementarity,
  evaluateReactiveLayerQuality,
  unresolvedReactiveToneNoteIds,
  type CounterContextAnalysis,
  type CounterOpportunity,
  type MelodyActivityAnalysis,
} from "./reactiveLayerAnalysis"

export interface GenerateCounterInput {
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  key: string
  chords: ChordEvent[]
  melody: MelodyVariant
  totalBeats: number
  seed: number
  /** 現在鳴っているAccompaniment / Decoration。候補選抜時の衝突回避に使う。 */
  existingSupportNotes?: MelodyNote[]
  existingReactiveLayers?: Pick<
    ReactiveLayerCandidate,
    "kind" | "role" | "notes"
  >[]
  poolSize?: number
  finalCount?: number
  composerRules?: ResolvedComposerRules
  /** A/B実験時だけ有効にする、候補選抜におけるTechnique Fitの補助比率。 */
  techniqueFitSelectionWeight?: number
  /** DirectorがStrings等の明確な役割を指定した場合だけ、生成音色キャラクターを限定する。 */
  preferredStyles?: readonly CounterGeneratorStyle[]
  /** AI PartnerのSafe / Surprise判断を、既存のRisk語彙へ渡す任意バイアス。 */
  preferredCreativeRisks?: readonly CounterCreativeRisk[]
}

interface StylePlan {
  style: CounterGeneratorStyle
  role: ReactiveLayerRole
  noteCount: readonly [number, number]
  durations: readonly number[]
  velocity: readonly [number, number]
  preferredSide: "analysis" | "below" | "above"
  gapCount: readonly [number, number]
}

interface CounterRhythmEvent {
  offset: number
  duration: number
  accent: number
}

export const COUNTER_CANDIDATE_CONFIG = {
  candidatePoolSize: 120,
  finalCandidateCount: 10,
} as const

const STYLE_PLANS: readonly StylePlan[] = [
  {
    style: "bell-response",
    role: "answer-phrase",
    noteCount: [3, 5],
    durations: [0.5, 0.75],
    velocity: [54, 68],
    preferredSide: "above",
    gapCount: [1, 1],
  },
  {
    style: "piano-echo",
    role: "motif-echo",
    noteCount: [3, 5],
    durations: [0.5, 1, 1.5],
    velocity: [45, 61],
    preferredSide: "below",
    gapCount: [1, 1],
  },
  {
    style: "string-answer",
    role: "counterline",
    noteCount: [4, 6],
    durations: [0.75, 1, 1.5],
    velocity: [42, 58],
    preferredSide: "analysis",
    gapCount: [1, 1],
  },
  {
    style: "guitar-fill",
    role: "gap-fill",
    noteCount: [4, 7],
    durations: [0.25, 0.5, 0.75],
    velocity: [52, 68],
    preferredSide: "below",
    gapCount: [1, 1],
  },
  {
    style: "synth-whisper",
    role: "suspension-layer",
    noteCount: [3, 4],
    durations: [1, 1.5, 2],
    velocity: [36, 50],
    preferredSide: "above",
    gapCount: [1, 1],
  },
] as const

const STYLE_LABELS: Record<CounterGeneratorStyle, string> = {
  "bell-response": "Bell Response",
  "piano-echo": "Piano Echo",
  "string-answer": "String Answer",
  "guitar-fill": "Guitar Fill",
  "synth-whisper": "Synth Whisper",
}

const CREATIVE_RISK_CYCLE: readonly CounterCreativeRisk[] = [
  "focused",
  "focused",
  "focused",
  "bold",
  "bold",
  "bold",
  "bold",
  "radical",
  "radical",
  "radical",
]

const DEVELOPMENT_STRATEGIES: readonly CounterDevelopmentStrategy[] = [
  "inversion",
  "fragmentation",
  "augmentation",
  "delayed-return",
  "register-exchange",
  "local-mutation",
]

const ENDING_STRATEGIES: readonly CounterEndingStrategy[] = [
  "resolved",
  "open-fifth",
  "suspended",
  "motif-return",
  "silence-cut",
]

function planCounterComposition(
  input: GenerateCounterInput,
  stylePlan: StylePlan,
  poolIndex: number,
  context: CounterContextAnalysis,
  primaryOpportunity: CounterOpportunity,
  rng: SeededRandom,
): CounterCompositionPlan {
  const creativeRisk =
    CREATIVE_RISK_CYCLE[poolIndex % CREATIVE_RISK_CYCLE.length]
  const intentsByOpportunity: Record<
    CounterOpportunity["kind"],
    readonly CounterDialogueIntent[]
  > = {
    "answer-needed": ["answer", "echo-transform", "shadow"],
    "continuation-needed": ["counter-current", "answer", "strategic-silence"],
    "harmonic-colour-needed": ["suspended-halo", "shadow", "counter-current"],
    "tension-support": ["suspended-halo", "counter-current", "strategic-silence"],
    "motif-recall": ["echo-transform", "shadow", "answer"],
    "transition-support": ["counter-current", "answer", "suspended-halo"],
    "silence-preferred": ["strategic-silence"],
  }
  const rhythmsByOpportunity: Record<
    CounterOpportunity["kind"],
    readonly CounterRhythmGrammar[]
  > = {
    "answer-needed": ["breath-answer", "long-short", "syncopated-reply"],
    "continuation-needed": ["displaced-cell", "breath-answer", "sparse-signal"],
    "harmonic-colour-needed": ["sparse-signal", "long-short", "broken-pulse"],
    "tension-support": ["sparse-signal", "displaced-cell", "long-short"],
    "motif-recall": ["long-short", "syncopated-reply", "breath-answer"],
    "transition-support": ["syncopated-reply", "displaced-cell", "broken-pulse"],
    "silence-preferred": ["sparse-signal"],
  }
  const contoursByOpportunity: Record<
    CounterOpportunity["kind"],
    readonly CounterContourPlan[]
  > = {
    "answer-needed": ["arch", "inverted-arch", "leap-recovery"],
    "continuation-needed": ["ascending-staircase", "descending-staircase", "wave"],
    "harmonic-colour-needed": ["pedal-break", "wave", "arch"],
    "tension-support": ["pedal-break", "descending-staircase", "leap-recovery"],
    "motif-recall": ["arch", "wave", "inverted-arch"],
    "transition-support": ["ascending-staircase", "leap-recovery", "wave"],
    "silence-preferred": ["pedal-break"],
  }
  const chooseContextual = <T>(values: readonly T[], offset: number): T =>
    values[(poolIndex + offset + rng.intBetween(0, values.length - 1)) % values.length]
  const dialogueIntent = chooseContextual(
    intentsByOpportunity[primaryOpportunity.kind],
    stylePlan.style === "piano-echo" ? 1 : 0,
  )
  const rhythmGrammar = chooseContextual(
    rhythmsByOpportunity[primaryOpportunity.kind],
    poolIndex % 3,
  )
  const contour = chooseContextual(
    contoursByOpportunity[primaryOpportunity.kind],
    primaryOpportunity.preferredMotion === "contrary" ? 1 : 0,
  )
  const development =
    DEVELOPMENT_STRATEGIES[
      (poolIndex * 5 + rng.intBetween(0, 5)) % DEVELOPMENT_STRATEGIES.length
    ]
  const ending =
    ENDING_STRATEGIES[(poolIndex * 3 + rng.intBetween(0, 4)) % ENDING_STRATEGIES.length]
  const preferredPhraseCount =
    dialogueIntent === "strategic-silence"
      ? 1
      : creativeRisk === "focused"
        ? 1
        : creativeRisk === "bold"
          ? 2
          : 3
  const phraseCount = Math.max(
    1,
    Math.min(3, preferredPhraseCount, context.opportunities.length),
  ) as 1 | 2 | 3
  const registerRelation =
    development === "register-exchange"
      ? "exchange"
      : stylePlan.preferredSide === "analysis"
        ? input.sectionRole === "chorus" || input.sectionRole === "grand-chorus"
          ? "above"
          : "below"
        : stylePlan.preferredSide
  return {
    creativeRisk,
    dialogueIntent,
    rhythmGrammar,
    contour,
    development,
    ending,
    registerRelation,
    phraseCount,
    targetSilenceRatio:
      dialogueIntent === "strategic-silence"
        ? 0.82
        : creativeRisk === "focused"
          ? 0.7
          : creativeRisk === "bold"
            ? 0.58
          : 0.48,
    opportunityKinds: [primaryOpportunity.kind],
    counterNeedScore: primaryOpportunity.needScore,
    targetTonePitchClasses: primaryOpportunity.targetTonePitchClasses,
    sourceDriven: true,
  }
}

function clampMidi(value: number): number {
  return Math.max(24, Math.min(108, value))
}

function chordForBeat(chords: ChordEvent[], beat: number): ChordEvent | undefined {
  return (
    chords.find(
      (chord) =>
        beat >= chord.startBeat && beat < chord.startBeat + chord.durationBeats,
    ) ?? chords[chords.length - 1]
  )
}

function pitchInRegister(
  pitchClass: number,
  low: number,
  high: number,
  target: number,
): number {
  const candidates: number[] = []
  for (let pitch = low; pitch <= high; pitch++) {
    if (((pitch % 12) + 12) % 12 === pitchClass) candidates.push(pitch)
  }
  if (candidates.length === 0) {
    const octave = Math.round((target - pitchClass) / 12)
    return clampMidi(pitchClass + octave * 12)
  }
  return candidates.reduce((best, pitch) =>
    Math.abs(pitch - target) < Math.abs(best - target) ? pitch : best,
  )
}

function scaleLadder(key: string, low: number, high: number): number[] {
  const pitchClasses = new Set(keyScalePitchClasses(key))
  return Array.from({ length: high - low + 1 }, (_, index) => low + index).filter(
    (pitch) => pitchClasses.has(((pitch % 12) + 12) % 12),
  )
}

function nearestLadderIndex(ladder: number[], target: number): number {
  let bestIndex = 0
  for (let index = 1; index < ladder.length; index++) {
    if (
      Math.abs(ladder[index] - target) <
      Math.abs(ladder[bestIndex] - target)
    ) {
      bestIndex = index
    }
  }
  return bestIndex
}

function melodicSourceBefore(
  melody: MelodyNote[],
  beat: number,
): MelodyNote[] {
  return melody
    .filter((note) => note.startBeat + note.durationBeats <= beat + 0.001)
    .sort((a, b) => a.startBeat - b.startBeat)
    .slice(-4)
}

function contourSteps(
  plan: CounterCompositionPlan,
  source: MelodyNote[],
  count: number,
  inverseDirection: number,
  phraseIndex: number,
): number[] {
  const sourceIntervals = source
    .slice(1)
    .map((note, index) => note.pitch - source[index].pitch)
  const direction = inverseDirection || 1
  const vocab: Record<CounterContourPlan, readonly number[]> = {
    "ascending-staircase": [0, 1, 1, 1, 1],
    "descending-staircase": [0, -1, -1, -1, -1],
    arch: [0, 1, 1, -1, -1],
    "inverted-arch": [0, -1, -1, 1, 1],
    wave: [0, 2, -1, 2, -2],
    "leap-recovery": [0, 3, -1, -1, 1],
    "pedal-break": [0, 0, 2, -2, 0],
  }
  let steps = Array.from({ length: count }, (_, index) =>
    vocab[plan.contour][index % vocab[plan.contour].length] * direction,
  )
  if (plan.dialogueIntent === "echo-transform" && sourceIntervals.length > 0) {
    steps = steps.map((_, index) =>
      index === 0
        ? 0
        : Math.sign(sourceIntervals[(index - 1) % sourceIntervals.length]) *
          Math.max(1, Math.min(3, Math.round(Math.abs(sourceIntervals[(index - 1) % sourceIntervals.length]) / 2))),
    )
  }
  if (phraseIndex > 0) {
    if (plan.development === "inversion") steps = steps.map((step) => -step)
    if (plan.development === "fragmentation") {
      steps = steps.map((step, index) => (index >= Math.ceil(count * 0.65) ? 0 : step))
    }
    if (plan.development === "augmentation") {
      steps = steps.map((step) => Math.sign(step) * Math.min(4, Math.max(1, Math.abs(step) * 2)))
    }
    if (plan.development === "delayed-return") {
      steps = steps.map((step, index) => (index < 2 ? 0 : step))
    }
    if (plan.development === "local-mutation") {
      steps = steps.map((step, index) => (index === 2 ? -step || direction * 2 : step))
    }
  }
  return steps
}

function registerForPlan(
  composition: CounterCompositionPlan,
  analysis: MelodyActivityAnalysis,
  phraseIndex: number,
): { low: number; high: number } {
  const relation =
    composition.registerRelation === "exchange"
      ? phraseIndex % 2 === 0
        ? "below"
        : "above"
      : composition.registerRelation
  if (relation === "below") {
    return {
      low: Math.max(36, analysis.registerBudget.melodyLow - 17),
      high: Math.max(40, analysis.registerBudget.melodyLow - 4),
    }
  }
  if (relation === "above") {
    return {
      low: Math.min(92, analysis.registerBudget.melodyHigh + 4),
      high: Math.min(96, analysis.registerBudget.melodyHigh + 16),
    }
  }
  return {
    low: analysis.registerBudget.low,
    high: analysis.registerBudget.high,
  }
}

function roundQuarter(value: number): number {
  return Math.round(value * 4) / 4
}

function rhythmEventsForWindow(
  grammar: CounterRhythmGrammar,
  durationBeats: number,
  risk: CounterCreativeRisk,
  opportunity: CounterOpportunity,
): CounterRhythmEvent[] {
  const blueprints: Record<CounterRhythmGrammar, readonly CounterRhythmEvent[]> = {
    "breath-answer": [
      { offset: 0, duration: 0.5, accent: 0.72 },
      { offset: 0.75, duration: 0.25, accent: 1 },
      { offset: 1.5, duration: 0.75, accent: 0.82 },
      { offset: 2.75, duration: 0.5, accent: 0.9 },
    ],
    "long-short": [
      { offset: 0, duration: 0.75, accent: 1 },
      { offset: 0.75, duration: 0.25, accent: 0.64 },
      { offset: 1.25, duration: 0.5, accent: 0.82 },
      { offset: 2.5, duration: 0.25, accent: 0.7 },
    ],
    "syncopated-reply": [
      { offset: 0.25, duration: 0.5, accent: 0.68 },
      { offset: 0.75, duration: 0.25, accent: 1 },
      { offset: 1.5, duration: 0.5, accent: 0.78 },
      { offset: 2.25, duration: 0.75, accent: 0.92 },
    ],
    "displaced-cell": [
      { offset: 0.25, duration: 0.25, accent: 0.62 },
      { offset: 0.5, duration: 0.5, accent: 1 },
      { offset: 1.25, duration: 0.25, accent: 0.72 },
      { offset: 2, duration: 0.75, accent: 0.9 },
    ],
    "broken-pulse": [
      { offset: 0, duration: 0.25, accent: 0.88 },
      { offset: 0.5, duration: 0.25, accent: 0.62 },
      { offset: 0.75, duration: 0.25, accent: 1 },
      { offset: 1.75, duration: 0.5, accent: 0.76 },
      { offset: 2.75, duration: 0.25, accent: 0.94 },
    ],
    "sparse-signal": [
      { offset: 0, duration: 0.5, accent: 1 },
      { offset: 0.75, duration: 0.25, accent: 0.72 },
      { offset: 2.25, duration: 0.75, accent: 0.86 },
    ],
  }
  const maximumNotes = risk === "focused" ? 4 : risk === "bold" ? 5 : 6
  const windowNoteLimit =
    durationBeats <= 1 && risk !== "focused" ? 2 : maximumNotes
  let available = blueprints[grammar]
    .filter((event) => event.offset < durationBeats - 0.01)
    .slice(0, windowNoteLimit)
    .map((event) => ({
      ...event,
      offset: roundQuarter(event.offset),
      duration: Math.max(
        0.25,
        roundQuarter(Math.min(event.duration, durationBeats - event.offset)),
      ),
    }))
  if (
    opportunity.kind === "answer-needed" &&
    opportunity.sourceMotifOnsetGaps.length >= 2 &&
    risk !== "radical"
  ) {
    let offset = grammar === "syncopated-reply" ? 0.25 : 0
    available = opportunity.sourceMotifOnsetGaps
      .slice(0, risk === "focused" ? 3 : 4)
      .map((onsetGap, index) => {
        const duration = Math.max(
          0.25,
          Math.min(
            1,
            opportunity.sourceMotifDurations[index] ?? onsetGap * 0.75,
          ),
        )
        const event = {
          offset: roundQuarter(offset),
          duration: roundQuarter(duration),
          accent: index === 0 ? 0.92 : index % 2 === 0 ? 0.76 : 1,
        }
        offset += Math.max(0.25, Math.min(1.5, onsetGap))
        return event
      })
      .filter((event) => event.offset < durationBeats - 0.01)
  }
  if (opportunity.kind === "transition-support" && available.length > 0) {
    const lastEnd = Math.max(
      ...available.map((event) => event.offset + event.duration),
    )
    const shift = Math.max(0, roundQuarter(durationBeats - lastEnd - 0.25))
    available = available.map((event) => ({
      ...event,
      offset: roundQuarter(event.offset + shift),
    }))
  }
  if (
    opportunity.kind === "harmonic-colour-needed" ||
    opportunity.kind === "tension-support"
  ) {
    available = available.slice(0, risk === "radical" ? 4 : 3)
  }
  available = available.map((event) => {
    const absoluteBeat = opportunity.startBeat + event.offset
    const conflictsWithMelodyAttack = opportunity.avoidAttackBeats.some(
      (beat) => Math.abs(beat - absoluteBeat) <= 0.08,
    )
    const shiftedOffset = conflictsWithMelodyAttack
      ? event.offset + 0.25 < durationBeats
        ? event.offset + 0.25
        : Math.max(0, event.offset - 0.25)
      : event.offset
    return { ...event, offset: roundQuarter(shiftedOffset) }
  })
  // Focusedは1フレーズ内で識別できる3音、複数フレーズを持つBold/Radicalは
  // 2音の呼びかけを離れたGapへ配置し、総密度を上げずに対話を作る。
  const minimumNotes = risk === "focused" ? 3 : 2
  for (const offset of [0, 0.5, 0.75]) {
    if (available.length >= minimumNotes || offset >= durationBeats) break
    if (!available.some((event) => event.offset === offset)) {
      available.push({ offset, duration: 0.25, accent: offset === 0 ? 0.9 : 0.7 })
    }
  }
  return available
    .sort((left, right) => left.offset - right.offset)
    .map((event, index, events) => ({
      ...event,
      duration: Math.max(
        0.25,
        Math.min(
          event.duration,
          (events[index + 1]?.offset ?? durationBeats) - event.offset,
        ),
      ),
    }))
}

function melodyDirectionBefore(melody: MelodyNote[], beat: number): number {
  const prior = melody
    .filter((note) => note.startBeat + note.durationBeats <= beat + 0.001)
    .sort((a, b) => a.startBeat - b.startBeat)
    .slice(-2)
  if (prior.length < 2) return 1
  return Math.sign(prior[1].pitch - prior[0].pitch) || 1
}

function pitchClass(value: number): number {
  return ((value % 12) + 12) % 12
}

function contextualPitchForEvent(
  desiredPitch: number,
  previousPitch: number | undefined,
  beat: number,
  accent: number,
  isLast: boolean,
  register: { low: number; high: number },
  opportunity: CounterOpportunity,
  input: GenerateCounterInput,
): { pitch: number; role: MelodyNote["plannedToneRole"] } {
  const chord = chordForBeat(input.chords, beat)
  const parsed = chord
    ? parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    : null
  if (!parsed) return { pitch: desiredPitch, role: "passing-tone" }
  const chordToneSet = new Set(parsed.tones.map((tone) => tone.pitchClass))
  const tensionSet = new Set(parsed.tensions.map((tone) => tone.pitchClass))
  const guideToneSet = new Set(
    parsed.tones
      .filter((tone) => tone.role === "third" || tone.role === "seventh")
      .map((tone) => tone.pitchClass),
  )
  const melodyNote = overlappingMelodyNote(input.melody.notes, beat)
  const desiredPitchClass = pitchClass(desiredPitch)
  const desiredVerticalInterval = melodyNote
    ? Math.abs(desiredPitch - melodyNote.pitch) % 12
    : null
  const weakPosition = accent < 0.84 && !isLast
  const safePassingTone =
    weakPosition &&
    (previousPitch === undefined || Math.abs(desiredPitch - previousPitch) <= 4) &&
    desiredVerticalInterval !== 0 &&
    desiredVerticalInterval !== 1 &&
    desiredVerticalInterval !== 11
  if (
    safePassingTone &&
    !chordToneSet.has(desiredPitchClass) &&
    !tensionSet.has(desiredPitchClass)
  ) {
    return { pitch: desiredPitch, role: "passing-tone" }
  }

  const candidatePitchClasses = [
    ...opportunity.targetTonePitchClasses,
    ...parsed.tones.map((tone) => tone.pitchClass),
    ...parsed.tensions.map((tone) => tone.pitchClass),
  ].filter(
    (candidate, index, values) => values.indexOf(candidate) === index,
  )
  const consonantClasses = new Set([3, 4, 5, 7, 8, 9])
  const selected = candidatePitchClasses
    .map((candidatePitchClass, targetIndex) => {
      const pitch = pitchInRegister(
        candidatePitchClass,
        register.low,
        register.high,
        desiredPitch,
      )
      const verticalInterval = melodyNote
        ? Math.abs(pitch - melodyNote.pitch) % 12
        : null
      const verticalScore =
        verticalInterval === null
          ? 4
          : verticalInterval === 0 || verticalInterval === 1 || verticalInterval === 11
            ? -60
            : consonantClasses.has(verticalInterval)
              ? 18
              : verticalInterval === 2 || verticalInterval === 10
                ? weakPosition
                  ? 2
                  : -14
                : -5
      const melodicDistance = previousPitch === undefined
        ? 0
        : Math.abs(pitch - previousPitch)
      const leapScore = melodicDistance <= 4
        ? 10
        : melodicDistance <= 7
          ? 2
          : -18
      return {
        pitch,
        pitchClass: candidatePitchClass,
        score:
          -Math.abs(pitch - desiredPitch) * 2.2 +
          verticalScore +
          leapScore +
          (guideToneSet.has(candidatePitchClass) ? 12 : 0) +
          (opportunity.targetTonePitchClasses.includes(candidatePitchClass)
            ? Math.max(2, 12 - targetIndex * 2)
            : 0) +
          (tensionSet.has(candidatePitchClass) && weakPosition ? 5 : 0),
      }
    })
    .sort((left, right) => right.score - left.score)[0]
  if (!selected) return { pitch: desiredPitch, role: "passing-tone" }
  return {
    pitch: selected.pitch,
    role: chordToneSet.has(selected.pitchClass)
      ? "chord-tone"
      : tensionSet.has(selected.pitchClass)
        ? isLast
          ? "tension-hold"
          : "appoggiatura"
        : "passing-tone",
  }
}

function generatePhraseInGap(
  stylePlan: StylePlan,
  composition: CounterCompositionPlan,
  gap: CounterOpportunity,
  phraseIndex: number,
  isFinalPhrase: boolean,
  input: GenerateCounterInput,
  analysis: MelodyActivityAnalysis,
  rng: SeededRandom,
): MelodyNote[] {
  const register = registerForPlan(composition, analysis, phraseIndex)
  const rhythmEvents = rhythmEventsForWindow(
    composition.rhythmGrammar,
    Math.min(4, gap.durationBeats),
    composition.creativeRisk,
    gap,
  )
  const count = rhythmEvents.length
  const phraseStart = gap.startBeat
  const endBeat = Math.min(gap.endBeat, gap.startBeat + 4)
  const inverseDirection = -melodyDirectionBefore(input.melody.notes, gap.startBeat)
  const source = melodicSourceBefore(input.melody.notes, gap.startBeat)
  const ladder = scaleLadder(input.key, register.low, register.high)
  if (ladder.length === 0) return []
  let ladderIndex = nearestLadderIndex(
    ladder,
    (register.low + register.high) / 2,
  )
  const steps = contourSteps(
    composition,
    source,
    count,
    inverseDirection,
    phraseIndex,
  )
  const usesStepwiseContour =
    composition.contour === "ascending-staircase" ||
    composition.contour === "descending-staircase" ||
    composition.contour === "arch" ||
    composition.contour === "inverted-arch"
  if (usesStepwiseContour) {
    // 折り返し(アーチ型)を許容するようになったため、始点から終点までの純移動量は
    // 単純なinverseDirection * (count - 1)ではなく、実際のsteps合計から求める。
    const netDisplacement = steps.slice(1).reduce((sum, step) => sum + step, 0)
    const finalBeat = phraseStart + (rhythmEvents.at(-1)?.offset ?? 0)
    const finalChord = chordForBeat(input.chords, finalBeat)
    const finalParsed = finalChord
      ? parseChordSymbol(finalChord.symbol, finalChord.bass ?? undefined)
      : null
    const chordIndices = finalParsed?.tones
      .map((tone) =>
        ladder.findIndex(
          (pitch) =>
            ((pitch % 12) + 12) % 12 === tone.pitchClass,
        ),
      )
      .filter((index) => index >= 0)
    const alignedTarget = chordIndices
      ?.map((targetIndex) => ({
        targetIndex,
        startIndex: targetIndex - netDisplacement,
      }))
      .filter(
        ({ startIndex }) =>
          startIndex >= 0 && startIndex < ladder.length,
      )
      .sort(
        (left, right) =>
          Math.abs(
            ladder[left.startIndex] -
              (register.low + register.high) / 2,
          ) -
          Math.abs(
            ladder[right.startIndex] -
              (register.low + register.high) / 2,
          ),
      )[0]
    if (alignedTarget) ladderIndex = alignedTarget.startIndex
  }
  const notes: MelodyNote[] = []
  if (composition.development === "register-exchange" && phraseIndex > 0) {
    const target = (register.low + register.high) / 2
    ladderIndex = nearestLadderIndex(ladder, target)
  }

  for (let index = 0; index < count; index++) {
    const rhythmEvent = rhythmEvents[index]
    const beat = roundQuarter(phraseStart + rhythmEvent.offset)
    if (beat >= endBeat - 0.1) break
    const chord = chordForBeat(input.chords, beat)
    const parsed = chord
      ? parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      : null
    if (index > 0) {
      ladderIndex = Math.max(
        0,
        Math.min(ladder.length - 1, ladderIndex + steps[index]),
      )
    }
    let pitch = ladder[ladderIndex]
    const isLast = index === count - 1
    const contextualPitch = contextualPitchForEvent(
      pitch,
      notes.at(-1)?.pitch,
      beat,
      rhythmEvent.accent,
      isLast && isFinalPhrase,
      register,
      gap,
      input,
    )
    pitch = contextualPitch.pitch
    if (
      isLast &&
      isFinalPhrase &&
      parsed &&
      composition.ending !== "silence-cut"
    ) {
      const chordPitchClasses = parsed.tones.map((tone) => tone.pitchClass)
      const endingPitchClasses =
        composition.ending === "suspended" && parsed.tensions.length > 0
          ? parsed.tensions.map((tone) => tone.pitchClass)
          : composition.ending === "open-fifth"
            ? chordPitchClasses.slice(0, Math.min(3, chordPitchClasses.length))
            : chordPitchClasses
      const nearestChordPitchClass = endingPitchClasses.reduce((best, current) => {
        const bestPitch = pitchInRegister(best, register.low, register.high, pitch)
        const currentPitch = pitchInRegister(
          current,
          register.low,
          register.high,
          pitch,
        )
        return Math.abs(currentPitch - pitch) < Math.abs(bestPitch - pitch)
          ? current
          : best
      })
      const resolvedPitch = pitchInRegister(
        nearestChordPitchClass,
        register.low,
        register.high,
        pitch,
      )
      const previous = notes.at(-1)?.pitch
      if (
        composition.ending !== "motif-return" &&
        (previous === undefined ||
          (Math.abs(resolvedPitch - previous) >= 1 &&
            Math.abs(resolvedPitch - previous) <= 3))
      ) {
        pitch = resolvedPitch
      }
    }

    if (
      isLast &&
      isFinalPhrase &&
      composition.ending === "motif-return" &&
      notes.length > 0
    ) {
      pitch = pitchInRegister(
        ((notes[0].pitch % 12) + 12) % 12,
        register.low,
        register.high,
        pitch,
      )
    }

    const echoedDuration =
      stylePlan.style === "piano-echo"
        ? source[index % Math.max(1, source.length)]?.durationBeats
        : undefined
    const desiredDuration =
      echoedDuration && stylePlan.durations.includes(echoedDuration)
        ? echoedDuration
        : rhythmEvent.duration
    const remaining = endBeat - beat
    const nextBeat = rhythmEvents[index + 1]
      ? phraseStart + rhythmEvents[index + 1].offset
      : endBeat
    const articulatedSlot = Math.max(0.25, nextBeat - beat)
    const durationBeats = Math.max(
      0.25,
      Math.min(desiredDuration, articulatedSlot, remaining),
    )
    notes.push({
      id: `counter:${input.seed}:${phraseIndex}:${index}`,
      startBeat: beat,
      durationBeats,
      pitch,
      velocity: Math.max(
        stylePlan.velocity[0],
        Math.min(
          stylePlan.velocity[1],
          Math.round(
            stylePlan.velocity[0] +
              (stylePlan.velocity[1] - stylePlan.velocity[0]) *
                rhythmEvent.accent +
              rng.intBetween(-2, 2),
          ),
        ),
      ),
      locks: [],
      plannedToneRole: composition.ending === "suspended" && isLast
          ? "tension-hold"
          : stylePlan.style === "synth-whisper" && contextualPitch.role !== "chord-tone"
          ? "tension-hold"
          : contextualPitch.role,
    })
  }
  return notes.map((note, index) => {
    if (note.plannedToneRole !== "passing-tone") return note
    const target = notes[index + 1]
    if (!target) return { ...note, plannedToneRole: "tension-hold" }
    return {
      ...note,
      plannedResolution: {
        targetPitchClass: ((target.pitch % 12) + 12) % 12,
        targetBeat: target.startBeat,
        maximumDelayBeats: Math.max(0.25, target.startBeat - note.startBeat),
      },
    }
  })
}

function harmonicFit(notes: MelodyNote[], chords: ChordEvent[]): number {
  if (notes.length === 0) return 0
  const fitted = notes.filter((note) => {
    const chord = chordForBeat(chords, note.startBeat)
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    if (!parsed) return false
    const pc = ((note.pitch % 12) + 12) % 12
    return [...parsed.tones, ...parsed.tensions].some((tone) => tone.pitchClass === pc)
  }).length
  return (fitted / notes.length) * 100
}

function sectionFit(role: SectionRole, noteCount: number): number {
  const sparse = role === "verse" || role === "intro" || role === "breakdown-chorus"
  const dense = role === "grand-chorus" || role === "instrumental"
  if (sparse) return Math.max(55, 100 - Math.max(0, noteCount - 5) * 10)
  if (dense) return Math.min(100, 65 + noteCount * 4)
  return Math.max(65, 95 - Math.abs(noteCount - 5) * 5)
}

function motifRelationship(melody: MelodyNote[], notes: MelodyNote[]): number {
  if (melody.length < 2 || notes.length < 2) return 62
  const melodyIntervals = melody
    .slice(0, 8)
    .slice(1)
    .map((note, index) => Math.abs(note.pitch - melody[index].pitch))
  const counterIntervals = notes
    .slice(1)
    .map((note, index) => Math.abs(note.pitch - notes[index].pitch))
  const related = counterIntervals.filter((interval) =>
    melodyIntervals.some((melodyInterval) => Math.abs(melodyInterval - interval) <= 1),
  ).length
  return 55 + (related / Math.max(1, counterIntervals.length)) * 35
}

function counterIntervals(notes: readonly MelodyNote[]): number[] {
  return notes.slice(1).map((note, index) => note.pitch - notes[index].pitch)
}

function counterOnsetGaps(notes: readonly MelodyNote[]): number[] {
  return notes
    .slice(1)
    .map((note, index) => roundQuarter(note.startBeat - notes[index].startBeat))
}

function evaluateCounterMusicalQuality(
  plan: CounterCompositionPlan,
  input: GenerateCounterInput,
  notes: MelodyNote[],
  baseQuality: ReactiveLayerCandidate["quality"],
  collisions: ReactiveLayerCandidate["collisions"],
  counterpointFit: number,
  relationship: number,
): CounterMusicalQuality {
  if (notes.length < 2) {
    return {
      dialogueClarity: 0,
      independence: 0,
      rhythmicCharacter: 0,
      contourPurpose: 0,
      breathAndRestraint: 0,
      development: 0,
      emotionalNecessity: 0,
      audacity: 0,
      controlledRisk: 0,
      harmonicNarrative: 0,
      melodicComplement: 0,
      placementPurpose: 0,
      overall: 0,
    }
  }
  const intervals = counterIntervals(notes)
  const onsetGaps = counterOnsetGaps(notes)
  const durations = notes.map((note) => roundQuarter(note.durationBeats))
  const directions = intervals.map(Math.sign).filter((value) => value !== 0)
  const directionChanges = directions.slice(1).filter(
    (direction, index) => direction !== directions[index],
  ).length
  const largestLeap = Math.max(0, ...intervals.map(Math.abs))
  const recoveredLeaps = intervals.filter((interval, index) => {
    const next = intervals[index + 1]
    return (
      Math.abs(interval) >= 5 &&
      next !== undefined &&
      Math.sign(next) === -Math.sign(interval) &&
      Math.abs(next) <= 4
    )
  }).length
  const leapCount = intervals.filter((interval) => Math.abs(interval) >= 5).length
  const melodyIntervals = counterIntervals(input.melody.notes)
  const copiedIntervals = intervals.filter((interval) =>
    melodyIntervals.some((melodyInterval) => melodyInterval === interval),
  ).length / Math.max(1, intervals.length)
  const syncopatedRatio = notes.filter(
    (note) => Math.abs(note.startBeat - Math.round(note.startBeat)) >= 0.24,
  ).length / notes.length
  const sounded = notes.reduce((sum, note) => sum + note.durationBeats, 0)
  const silenceRatio = Math.max(0, 1 - sounded / Math.max(1, input.totalBeats))
  const phraseStarts = notes.filter(
    (note, index) => index === 0 || note.startBeat - notes[index - 1].startBeat >= 1,
  ).length
  const dialogueClarity = Math.min(
    100,
    relationship * 0.35 +
      counterpointFit * 0.4 +
      baseQuality.melodyRespect * 0.25,
  )
  const independence = Math.max(
    0,
    Math.min(
      100,
      (1 - copiedIntervals) * 55 +
        Math.min(1, directionChanges / 2) * 20 +
        Math.min(1, new Set(intervals).size / 4) * 25,
    ),
  )
  const rhythmicCharacter = Math.min(
    100,
    Math.min(1, new Set(onsetGaps).size / 3) * 35 +
      Math.min(1, new Set(durations).size / 3) * 25 +
      Math.min(1, syncopatedRatio / 0.45) * 25 +
      (new Set(onsetGaps).size > 1 ? 15 : 4),
  )
  const contourPurpose = Math.min(
    100,
    Math.min(1, largestLeap / 7) * 28 +
      Math.min(1, directionChanges / 2) * 32 +
      (plan.contour.includes("staircase")
        ? intervals.every((interval) => interval !== 0 && Math.abs(interval) <= 3)
          ? 32
          : 12
        : 24) +
      (plan.contour === "leap-recovery" && recoveredLeaps > 0 ? 16 : 6),
  )
  const breathAndRestraint = Math.max(
    0,
    Math.min(
      100,
      (1 - Math.abs(silenceRatio - plan.targetSilenceRatio)) * 65 +
        (notes.length <= Math.max(5, input.totalBeats * 0.55) ? 20 : 6) +
        (plan.dialogueIntent === "strategic-silence" ? 15 : 10),
    ),
  )
  const development = Math.min(
    100,
    phraseStarts * 18 +
      Math.min(1, new Set(intervals.map(Math.abs)).size / 4) * 28 +
      (plan.development !== "local-mutation" ? 22 : 16) +
      (phraseStarts >= plan.phraseCount ? 20 : 8),
  )
  const emotionalNecessity = Math.min(
    100,
    baseQuality.melodyRespect * 0.42 +
      breathAndRestraint * 0.28 +
      dialogueClarity * 0.2 +
      (collisions.simultaneousAttackCount === 0 ? 10 : 3),
  )
  const audacity = Math.min(
    100,
    Math.min(1, largestLeap / 9) * 30 +
      Math.min(1, syncopatedRatio / 0.45) * 22 +
      (plan.ending === "resolved" ? 5 : 17) +
      (plan.registerRelation === "exchange" ? 16 : 5) +
      (plan.creativeRisk === "radical" ? 15 : plan.creativeRisk === "bold" ? 9 : 2),
  )
  const unresolved = unresolvedReactiveToneNoteIds(notes).length
  const resolutionControl =
    leapCount === 0 ? 90 : (recoveredLeaps / leapCount) * 100
  const controlledRisk = Math.max(
    0,
    Math.min(
      100,
      baseQuality.harmonicFit * 0.3 +
        baseQuality.melodyRespect * 0.35 +
        resolutionControl * 0.2 +
        (unresolved === 0 ? 15 : 0) -
        (collisions.hasBlockingCollision ? 40 : 0),
    ),
  )
  const targetToneRatio = notes.filter((note) =>
    plan.targetTonePitchClasses.includes(pitchClass(note.pitch)),
  ).length / notes.length
  const harmonicNarrative = Math.min(
    100,
    baseQuality.harmonicFit * 0.38 +
      targetToneRatio * 34 +
      counterpointFit * 0.28,
  )
  const simultaneousAttackControl = Math.max(
    0,
    100 - collisions.simultaneousAttackCount * 18,
  )
  const melodicComplement = Math.min(
    100,
    counterpointFit * 0.34 +
      independence * 0.24 +
      rhythmicCharacter * 0.2 +
      simultaneousAttackControl * 0.22,
  )
  const placementPurpose = Math.min(
    100,
    plan.counterNeedScore * 0.42 +
      baseQuality.gapUsage * 0.24 +
      dialogueClarity * 0.2 +
      breathAndRestraint * 0.14,
  )
  const overall =
    dialogueClarity * 0.12 +
    independence * 0.1 +
    rhythmicCharacter * 0.1 +
    contourPurpose * 0.07 +
    breathAndRestraint * 0.08 +
    development * 0.07 +
    emotionalNecessity * 0.1 +
    controlledRisk * 0.1 +
    harmonicNarrative * 0.1 +
    melodicComplement * 0.09 +
    placementPurpose * 0.07
  return {
    dialogueClarity,
    independence,
    rhythmicCharacter,
    contourPurpose,
    breathAndRestraint,
    development,
    emotionalNecessity,
    audacity,
    controlledRisk,
    harmonicNarrative,
    melodicComplement,
    placementPurpose,
    overall,
  }
}

function overlappingMelodyNote(
  melody: MelodyNote[],
  beat: number,
): MelodyNote | undefined {
  return melody.find(
    (note) =>
      beat >= note.startBeat &&
      beat < note.startBeat + note.durationBeats,
  )
}

/** 強拍協和・反行/斜行・終止協調をまとめたCounter固有評価。 */
export function evaluateCounterpointFit(
  melody: MelodyNote[],
  counter: MelodyNote[],
  chords: ChordEvent[],
): number {
  if (counter.length < 2) return 40
  const consonantClasses = new Set([0, 3, 4, 5, 7, 8, 9])
  let structuralAttacks = 0
  let consonantAttacks = 0
  for (const note of counter) {
    if (Math.abs(note.startBeat - Math.round(note.startBeat)) > 0.08) {
      continue
    }
    const melodyNote = overlappingMelodyNote(melody, note.startBeat)
    if (!melodyNote) continue
    structuralAttacks++
    const intervalClass =
      Math.abs(note.pitch - melodyNote.pitch) % 12
    if (consonantClasses.has(intervalClass)) consonantAttacks++
  }

  let independentMotion = 0
  let comparableMotion = 0
  const sortedMelody = [...melody].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const sortedCounter = [...counter].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  for (let index = 1; index < sortedCounter.length; index++) {
    const previousCounter = sortedCounter[index - 1]
    const currentCounter = sortedCounter[index]
    const previousMelody =
      overlappingMelodyNote(
        sortedMelody,
        previousCounter.startBeat,
      ) ??
      sortedMelody
        .filter(
          (note) => note.startBeat <= previousCounter.startBeat,
        )
        .at(-1)
    const currentMelody =
      overlappingMelodyNote(sortedMelody, currentCounter.startBeat) ??
      sortedMelody
        .filter(
          (note) => note.startBeat <= currentCounter.startBeat,
        )
        .at(-1)
    if (!previousMelody || !currentMelody) continue
    const melodyMotion = Math.sign(
      currentMelody.pitch - previousMelody.pitch,
    )
    const counterMotion = Math.sign(
      currentCounter.pitch - previousCounter.pitch,
    )
    comparableMotion++
    if (
      melodyMotion === 0 ||
      counterMotion === 0 ||
      melodyMotion !== counterMotion
    ) {
      independentMotion++
    }
  }

  const last = sortedCounter.at(-1)!
  const lastChord = chordForBeat(chords, last.startBeat)
  const parsedLast = lastChord
    ? parseChordSymbol(lastChord.symbol, lastChord.bass ?? undefined)
    : null
  const lastPitchClass = ((last.pitch % 12) + 12) % 12
  const cadenceFit = parsedLast?.tones.some(
    (tone) => tone.pitchClass === lastPitchClass,
  )
    ? 100
    : 68
  const consonance =
    structuralAttacks === 0
      ? 82
      : (consonantAttacks / structuralAttacks) * 100
  const motion =
    comparableMotion === 0
      ? 78
      : (independentMotion / comparableMotion) * 100
  return Math.max(
    0,
    Math.min(
      100,
      consonance * 0.42 + motion * 0.38 + cadenceFit * 0.2,
    ),
  )
}

function candidateSimilarity(
  left: Pick<
    ReactiveLayerCandidate,
    "notes" | "generatorStyle" | "role" | "counterPlan"
  >,
  right: Pick<
    ReactiveLayerCandidate,
    "notes" | "generatorStyle" | "role" | "counterPlan"
  >,
): number {
  const startsLeft = new Set(left.notes.map((note) => Math.round(note.startBeat * 4)))
  const startsRight = new Set(right.notes.map((note) => Math.round(note.startBeat * 4)))
  const intersection = [...startsLeft].filter((start) => startsRight.has(start)).length
  const onsetSimilarity =
    intersection / Math.max(1, Math.max(startsLeft.size, startsRight.size))
  const pitchLeft = left.notes.map((note) => note.pitch)
  const pitchRight = right.notes.map((note) => note.pitch)
  const contourLength = Math.min(pitchLeft.length, pitchRight.length) - 1
  let contourMatches = 0
  for (let index = 0; index < contourLength; index++) {
    const a = Math.sign(pitchLeft[index + 1] - pitchLeft[index])
    const b = Math.sign(pitchRight[index + 1] - pitchRight[index])
    if (a === b) contourMatches++
  }
  const contourSimilarity = contourLength > 0 ? contourMatches / contourLength : 0
  const intervalLeft = counterIntervals(left.notes)
  const intervalRight = counterIntervals(right.notes)
  const intervalLength = Math.min(intervalLeft.length, intervalRight.length)
  const intervalSimilarity =
    intervalLength === 0
      ? 0
      : intervalLeft
          .slice(0, intervalLength)
          .filter(
            (interval, index) =>
              Math.abs(interval - intervalRight[index]) <= 1,
          ).length / Math.max(intervalLeft.length, intervalRight.length)
  const durationLeft = left.notes.map((note) => roundQuarter(note.durationBeats))
  const durationRight = right.notes.map((note) => roundQuarter(note.durationBeats))
  const durationLength = Math.min(durationLeft.length, durationRight.length)
  const durationSimilarity =
    durationLength === 0
      ? 0
      : durationLeft
          .slice(0, durationLength)
          .filter((duration, index) => duration === durationRight[index]).length /
        Math.max(durationLeft.length, durationRight.length)
  const styleSimilarity = left.generatorStyle === right.generatorStyle ? 1 : 0
  const roleSimilarity = left.role === right.role ? 1 : 0
  const planSimilarity = left.counterPlan && right.counterPlan
    ? (left.counterPlan.dialogueIntent === right.counterPlan.dialogueIntent ? 0.25 : 0) +
      (left.counterPlan.rhythmGrammar === right.counterPlan.rhythmGrammar ? 0.2 : 0) +
      (left.counterPlan.contour === right.counterPlan.contour ? 0.2 : 0) +
      (left.counterPlan.development === right.counterPlan.development ? 0.15 : 0) +
      (left.counterPlan.ending === right.counterPlan.ending ? 0.1 : 0) +
      (left.counterPlan.creativeRisk === right.counterPlan.creativeRisk ? 0.1 : 0)
    : 0
  const detailedSimilarity =
    onsetSimilarity * 0.2 +
    intervalSimilarity * 0.2 +
    contourSimilarity * 0.14 +
    durationSimilarity * 0.12 +
    planSimilarity * 0.18 +
    styleSimilarity * 0.1 +
    roleSimilarity * 0.06
  // Plan名が違っても、聴こえるOnset・Contour・Roleが同じなら近い案として扱う。
  // Technique Fitが特定Roleへ寄せる場合も、音として同型の候補が並ぶのを防ぐ。
  const audibleSimilarity =
    onsetSimilarity * 0.45 + contourSimilarity * 0.35 + roleSimilarity * 0.2
  return Math.max(detailedSimilarity, audibleSimilarity * 0.94)
}

function normalizedPreferenceWeight(
  composerRules: ResolvedComposerRules | undefined,
  axis: "partRole" | "registerRelation",
  value: string,
): number | undefined {
  const preference = composerRules?.preferences[axis]
  if (!preference || preference.values.length === 0) return undefined
  const maximum = Math.max(
    ...preference.values.map((candidate) => candidate.weight),
  )
  return maximum > 0
    ? techniquePreferenceWeight(composerRules, axis, value) / maximum
    : undefined
}

export function counterTechniqueFitScore(
  candidate: Pick<ReactiveLayerCandidate, "notes" | "role">,
  melody: readonly MelodyNote[],
  composerRules?: ResolvedComposerRules,
): number | undefined {
  const values: number[] = []
  const roleFit = normalizedPreferenceWeight(
    composerRules,
    "partRole",
    candidate.role,
  )
  if (roleFit !== undefined) values.push(roleFit)
  if (candidate.notes.length > 0 && melody.length > 0) {
    const counterAverage =
      candidate.notes.reduce((sum, note) => sum + note.pitch, 0) /
      candidate.notes.length
    const melodyAverage =
      melody.reduce((sum, note) => sum + note.pitch, 0) /
      melody.length
    const relation =
      counterAverage >= melodyAverage + 2 ? "above" : "below"
    const registerFit = normalizedPreferenceWeight(
      composerRules,
      "registerRelation",
      relation,
    )
    if (registerFit !== undefined) values.push(registerFit)
  }
  return values.length > 0
    ? Math.max(
        0,
        Math.min(
          1,
          values.reduce((sum, value) => sum + value, 0) /
            values.length,
        ),
      )
    : undefined
}

function selectDiverseCandidates(
  pool: ReactiveLayerCandidate[],
  finalCount: number,
  techniqueFitSelectionWeight = 0,
  preferredCreativeRisks?: readonly CounterCreativeRisk[],
): ReactiveLayerCandidate[] {
  // Techniqueは候補の方向を補助するが、聴感多様性を上書きしない。
  // 外部指定値をそのまま支配力にせず、Counter固有品質の中へ穏やかに統合する。
  const effectiveTechniqueWeight = Math.min(
    0.025,
    techniqueFitSelectionWeight * 0.3,
  )
  const structuralWeight = Math.max(
    0,
    1 - effectiveTechniqueWeight,
  )
  const musicalScore = (candidate: ReactiveLayerCandidate) =>
    (candidate.quality.overallQuality * 0.52 +
      (candidate.counterQuality?.overall ?? 0) * 0.48) * 0.76 +
    (candidate.activeContextFit?.fitScore ?? 100) * 0.08 +
    (candidate.negativeSpaceFit?.fitScore ?? 100) * 0.08 +
    (candidate.roleComplementarityFit?.fitScore ?? 100) * 0.08
  const eligibleWithDuplicates = pool
    .filter(
      (candidate) =>
        candidate.quality.overallQuality >= 68 &&
        candidate.quality.melodyRespect >= 80 &&
        candidate.quality.harmonicFit >= 60 &&
        candidate.quality.motifRelationship >= 55 &&
        (candidate.counterQuality?.overall ?? 0) >= 62 &&
        (candidate.counterQuality?.controlledRisk ?? 0) >= 72 &&
        (candidate.counterQuality?.emotionalNecessity ?? 0) >= 68 &&
        !candidate.collisions.hasBlockingCollision &&
        !candidate.activeContextFit?.hasBlockingConflict &&
        !candidate.negativeSpaceFit?.hasBlockingConflict &&
        !candidate.roleComplementarityFit?.hasBlockingConflict &&
        candidate.notes.length >= 3,
    )
    .sort(
      (a, b) =>
        musicalScore(b) * structuralWeight +
        (b.techniqueFitScore ?? 0) *
          100 *
          effectiveTechniqueWeight -
        (musicalScore(a) * structuralWeight +
          (a.techniqueFitScore ?? 0) *
            100 *
            effectiveTechniqueWeight),
    )
  const eligible = eligibleWithDuplicates.filter(
    (candidate, index, candidates) =>
      candidates.findIndex(
        (other) =>
          other.notes
            .map(
              (note) =>
                `${note.startBeat.toFixed(3)}:${note.durationBeats.toFixed(3)}:${note.pitch}`,
            )
            .join("|") ===
          candidate.notes
            .map(
              (note) =>
                `${note.startBeat.toFixed(3)}:${note.durationBeats.toFixed(3)}:${note.pitch}`,
            )
            .join("|"),
      ) === index,
  )
  const preferred = preferredCreativeRisks?.length
    ? eligible.filter((candidate) =>
        preferredCreativeRisks.includes(
          candidate.counterPlan?.creativeRisk ?? "focused",
        ),
      )
    : []
  // 指定Riskだけで候補数を満たせない場合は、品質を落とさず全eligibleへ戻す。
  const source = preferred.length >= finalCount ? preferred : eligible
  const selected: ReactiveLayerCandidate[] = []
  const radicalTarget = Math.max(1, Math.round(finalCount * 0.3))
  const boldTarget = Math.max(1, Math.round(finalCount * 0.4))
  const focusedTarget = Math.max(1, finalCount - radicalTarget - boldTarget)
  while (selected.length < finalCount && selected.length < source.length) {
    if (selected.length === 0) {
      selected.push({ ...source[0], selectionReason: "highest-quality" })
      continue
    }
    const remaining = source.filter(
      (candidate) => !selected.some((item) => item.id === candidate.id),
    )
    const needsStepwise =
      !selected.some((candidate) => isStepwiseCandidate(candidate)) &&
      remaining.some((candidate) => isStepwiseCandidate(candidate))
    const selectedRiskCounts: Record<CounterCreativeRisk, number> = {
      focused: selected.filter(
        (candidate) =>
          (candidate.counterPlan?.creativeRisk ?? "focused") === "focused",
      ).length,
      bold: selected.filter(
        (candidate) => candidate.counterPlan?.creativeRisk === "bold",
      ).length,
      radical: selected.filter(
        (candidate) => candidate.counterPlan?.creativeRisk === "radical",
      ).length,
    }
    const riskTargets: Record<CounterCreativeRisk, number> = {
      focused: focusedTarget,
      bold: boldTarget,
      radical: radicalTarget,
    }
    const availableRisks = (["focused", "bold", "radical"] as const).filter(
      (risk) =>
        selectedRiskCounts[risk] < riskTargets[risk] &&
        remaining.some(
          (candidate) =>
            (candidate.counterPlan?.creativeRisk ?? "focused") === risk,
        ),
    )
    const highestDeficitRatio = Math.max(
      0,
      ...availableRisks.map(
        (risk) =>
          (riskTargets[risk] - selectedRiskCounts[risk]) /
          riskTargets[risk],
      ),
    )
    const quotaPool = remaining.filter((candidate) => {
      const risk = candidate.counterPlan?.creativeRisk ?? "focused"
      return (
        availableRisks.includes(risk) &&
        (riskTargets[risk] - selectedRiskCounts[risk]) /
          riskTargets[risk] >=
          highestDeficitRatio - 0.001
      )
    })
    const riskBalancedPool = quotaPool.length > 0 ? quotaPool : remaining
    const selectionPool =
      needsStepwise && riskBalancedPool.some(isStepwiseCandidate)
        ? riskBalancedPool.filter((candidate) => isStepwiseCandidate(candidate))
        : riskBalancedPool
    const next = selectionPool
      .map((candidate) => {
        const maximumSimilarity = Math.max(
          ...selected.map((item) => candidateSimilarity(candidate, item)),
        )
        const risk = candidate.counterPlan?.creativeRisk ?? "focused"
        const selectedRiskCount = selected.filter(
          (item) => (item.counterPlan?.creativeRisk ?? "focused") === risk,
        ).length
        const riskTarget =
          risk === "radical"
            ? radicalTarget
            : risk === "bold"
              ? boldTarget
              : focusedTarget
        const intentAlreadySelected = selected.some(
          (item) =>
            item.counterPlan?.dialogueIntent ===
            candidate.counterPlan?.dialogueIntent,
        )
        const rhythmAlreadySelected = selected.some(
          (item) =>
            item.counterPlan?.rhythmGrammar ===
            candidate.counterPlan?.rhythmGrammar,
        )
        const contourAlreadySelected = selected.some(
          (item) => item.counterPlan?.contour === candidate.counterPlan?.contour,
        )
        const endingAlreadySelected = selected.some(
          (item) => item.counterPlan?.ending === candidate.counterPlan?.ending,
        )
        const roleAlreadySelected = selected.some(
          (item) => item.role === candidate.role,
        )
        const styleAlreadySelected = selected.some(
          (item) => item.generatorStyle === candidate.generatorStyle,
        )
        const coverageBonus =
          (!intentAlreadySelected ? 8 : 0) +
          (!rhythmAlreadySelected ? 6 : 0) +
          (!contourAlreadySelected ? 5 : 0) +
          (!endingAlreadySelected ? 4 : 0) +
          (!roleAlreadySelected ? 18 : 0) +
          (!styleAlreadySelected ? 8 : 0) +
          (selectedRiskCount < riskTarget ? 22 : 0)
        return {
          candidate,
          score:
            musicalScore(candidate) *
              0.65 *
              structuralWeight +
            (1 - maximumSimilarity) *
              100 *
              0.35 *
              structuralWeight +
            (candidate.techniqueFitScore ?? 0) *
              100 *
              effectiveTechniqueWeight +
            coverageBonus,
        }
      })
      .sort((a, b) => b.score - a.score)[0]?.candidate
    if (!next) break
    selected.push({ ...next, selectionReason: "quality-diversity-balance" })
  }
  return selected
}

function isStepwiseCandidate(candidate: ReactiveLayerCandidate): boolean {
  if (candidate.notes.length < 2) return false
  return candidate.notes.slice(1).every((note, index) => {
    const interval = Math.abs(note.pitch - candidate.notes[index].pitch)
    return interval > 0 && interval <= 3
  })
}

function buildPoolCandidate(
  input: GenerateCounterInput,
  plan: StylePlan,
  poolIndex: number,
  analysis: CounterContextAnalysis,
): ReactiveLayerCandidate {
  const candidateSeed = (input.seed + (poolIndex + 1) * 104_729) >>> 0
  const rng = new SeededRandom(candidateSeed)
  const minimumDuration = plan.style === "synth-whisper" ? 0.75 : 0.5
  const filteredOpportunities = analysis.opportunities.filter(
    (opportunity) => opportunity.durationBeats >= minimumDuration,
  )
  const opportunities =
    filteredOpportunities.length > 0
      ? filteredOpportunities
      : analysis.opportunities
  const primaryOpportunity =
    opportunities[
      (poolIndex * 7 + input.seed) % Math.max(1, opportunities.length)
    ]
  const plannedComposition = planCounterComposition(
    input,
    plan,
    poolIndex,
    analysis,
    primaryOpportunity,
    rng,
  )
  const gapCount = Math.min(opportunities.length, plannedComposition.phraseCount)
  const selectedGaps = opportunities
    .map((gap) => ({
      gap,
      score: (() => {
        const preceding = melodicSourceBefore(
          input.melody.notes,
          gap.startBeat,
        ).at(-1)
        const phraseRelease = preceding
          ? Math.min(1.5, preceding.durationBeats) * 0.35
          : 0
        const usableSpace = Math.min(2, gap.durationBeats) * 0.35
        const contextualPriority =
          gap.kind === primaryOpportunity.kind ? 0.45 : 0
        const sectionalVariety =
          ((poolIndex + Math.round(gap.startBeat)) % 5) * 0.06
        return (
          gap.needScore / 100 +
          contextualPriority +
          phraseRelease +
          usableSpace +
          sectionalVariety +
          rng.next() * 0.2
        )
      })(),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, gapCount)
    .map(({ gap }) => gap)
    .sort((a, b) => a.startBeat - b.startBeat)
  const composition: CounterCompositionPlan = {
    ...plannedComposition,
    opportunityKinds: [...new Set(selectedGaps.map((gap) => gap.kind))],
    counterNeedScore: Math.round(
      selectedGaps.reduce((sum, gap) => sum + gap.needScore, 0) /
        Math.max(1, selectedGaps.length),
    ),
    targetTonePitchClasses: [
      ...new Set(
        selectedGaps.flatMap((gap) => gap.targetTonePitchClasses),
      ),
    ].slice(0, 8),
  }
  const notes = selectedGaps.flatMap((gap, index) =>
    generatePhraseInGap(
      plan,
      composition,
      gap,
      index,
      index === selectedGaps.length - 1,
      { ...input, seed: candidateSeed },
      analysis,
      rng,
    ),
  )
  const opportunityAnalysis = { ...analysis, gaps: opportunities }
  const relationship = motifRelationship(input.melody.notes, notes)
  const counterpointFit = evaluateCounterpointFit(
    input.melody.notes,
    notes,
    input.chords,
  )
  const evaluated = evaluateReactiveLayerQuality(input.melody.notes, notes, opportunityAnalysis, {
    harmonicFit: harmonicFit(notes, input.chords),
    motifRelationship: relationship * 0.55 + counterpointFit * 0.45,
    sectionFit: sectionFit(input.sectionRole, notes.length),
    transitionValue: input.sectionRole === "pre-chorus" || input.sectionRole === "bridge" ? 78 : 65,
  })
  const counterQuality = evaluateCounterMusicalQuality(
    composition,
    input,
    notes,
    evaluated.quality,
    evaluated.collisions,
    counterpointFit,
    relationship,
  )
  const activeContextFit = assessReactiveActiveContextFit(
    input.existingSupportNotes ?? [],
    notes,
  )
  const negativeSpaceFit = assessReactiveNegativeSpaceFit(
    input.melody.notes,
    input.existingSupportNotes ?? [],
    notes,
    input.totalBeats,
  )
  const roleComplementarityFit = assessReactiveRoleComplementarity(
    input.existingReactiveLayers ?? [],
    { kind: "counter", role: plan.role, notes },
  )
  return {
    id: `counter-${candidateSeed}-${poolIndex}`,
    batchId: `counter-batch-${input.seed}`,
    sectionId: input.sectionId,
    targetMelodyVariantId: input.melody.id,
    kind: "counter",
    role: plan.role,
    generatorStyle: plan.style,
    counterPlan: composition,
    counterQuality,
    name: STYLE_LABELS[plan.style],
    notes,
    seed: candidateSeed,
    quality: evaluated.quality,
    collisions: evaluated.collisions,
    activeContextFit,
    negativeSpaceFit,
    roleComplementarityFit,
    techniqueFitScore: counterTechniqueFitScore(
      { notes, role: plan.role },
      input.melody.notes,
      input.composerRules,
    ),
    reviewState: null,
    createdAt: new Date(0).toISOString(),
  }
}

/** 拡張候補プールを独立生成し、品質下限と候補間差を両立する10案を返す。 */
export function generateCounterCandidates(
  input: GenerateCounterInput,
): ReactiveLayerCandidate[] {
  const analysis = analyzeCounterContext(
    input.melody.notes,
    input.chords,
    input.totalBeats,
  )
  if (analysis.silenceRecommended || analysis.opportunities.length === 0) {
    return []
  }
  const poolSize = Math.max(
    input.finalCount ?? COUNTER_CANDIDATE_CONFIG.finalCandidateCount,
    input.poolSize ?? COUNTER_CANDIDATE_CONFIG.candidatePoolSize,
  )
  const allowedStylePlans = input.preferredStyles?.length
    ? STYLE_PLANS.filter((plan) => input.preferredStyles?.includes(plan.style))
    : [...STYLE_PLANS]
  const orderedStylePlans = [...allowedStylePlans].sort((left, right) => {
    const score = (plan: StylePlan) =>
      techniquePreferenceWeight(
        input.composerRules,
        "partRole",
        plan.role,
      ) +
      techniquePreferenceWeight(
        input.composerRules,
        "registerRelation",
        plan.preferredSide,
      )
    return score(right) - score(left)
  })
  const preferredStylePlans = orderedStylePlans.filter(
    (plan) =>
      techniquePreferenceWeight(
        input.composerRules,
        "partRole",
        plan.role,
      ) +
        techniquePreferenceWeight(
          input.composerRules,
          "registerRelation",
          plan.preferredSide,
        ) >
      0,
  )
  const pool = Array.from({ length: poolSize }, (_, index) =>
    buildPoolCandidate(
      input,
      preferredStylePlans.length > 0 && index % 2 === 0
        ? preferredStylePlans[index % preferredStylePlans.length]
        : orderedStylePlans[
            (index + (input.seed % orderedStylePlans.length)) %
              orderedStylePlans.length
          ],
      index,
      analysis,
    ),
  )
  return selectDiverseCandidates(
    pool,
    input.finalCount ?? COUNTER_CANDIDATE_CONFIG.finalCandidateCount,
    input.techniqueFitSelectionWeight,
    input.preferredCreativeRisks,
  )
}

export function regenerateCounterCandidate(
  input: GenerateCounterInput,
  current: ReactiveLayerCandidate,
  siblings: ReactiveLayerCandidate[],
): ReactiveLayerCandidate | null {
  const generated = generateCounterCandidates({
    ...input,
    seed: (current.seed + 1_000_003) >>> 0,
    poolSize: COUNTER_CANDIDATE_CONFIG.candidatePoolSize,
    finalCount: COUNTER_CANDIDATE_CONFIG.finalCandidateCount,
  })
  const alternatives = generated
    .filter((candidate) => {
      const currentPlan = current.counterPlan
      const nextPlan = candidate.counterPlan
      const changedPlanAxes =
        currentPlan && nextPlan
          ? [
              currentPlan.dialogueIntent !== nextPlan.dialogueIntent,
              currentPlan.rhythmGrammar !== nextPlan.rhythmGrammar,
              currentPlan.contour !== nextPlan.contour,
              currentPlan.development !== nextPlan.development,
              currentPlan.ending !== nextPlan.ending,
              currentPlan.creativeRisk !== nextPlan.creativeRisk,
            ].filter(Boolean).length
          : 0
      return (
        candidate.generatorStyle !== current.generatorStyle &&
        changedPlanAxes >= 3
      )
    })
    .map((candidate) => ({
      candidate,
      similarity: Math.max(
        0,
        ...siblings.map((sibling) => candidateSimilarity(candidate, sibling)),
      ),
      score:
        (candidate.counterQuality?.overall ?? 0) * 0.55 +
        candidate.quality.overallQuality * 0.15 +
        (1 -
          Math.max(
            0,
            ...siblings.map((sibling) => candidateSimilarity(candidate, sibling)),
          )) *
          100 *
          0.3,
    }))
    .sort((a, b) => b.score - a.score || a.similarity - b.similarity)
  const selected = alternatives[0]?.candidate ?? generated[0]
  return selected ? { ...selected, selectionReason: "regenerated" } : null
}
