import {
  allUsablePitchClasses,
  chordTonePitchClasses,
  isChordTone,
  isTensionTone,
} from "@/core/chord"
import type { MelodyNote, PhraseContour } from "@/core/melody"
import { pitchClass } from "@/core/note"
import type { ChordEvent, SongProfileId } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import { keyScalePitchClasses } from "@/core/scale"
import type {
  SignaturePhraseCandidate,
  SignaturePhraseArchetype,
  SignaturePhrasePlan,
  SignaturePhraseScore,
  SignaturePhraseSimilarity,
  SignatureRhythmIdentity,
  SignatureVariationStrategy,
  SignatureVoicingMode,
} from "@/core/signaturePhrase"
import type { SectionRole } from "@/core/section"
import type { Density, Drama, RangeSetting } from "@/melody-engine/generationParams"
import {
  buildHarmonicMap,
  chordAtBeat,
  type HarmonicMapEntry,
} from "@/melody-engine/harmonicMap"
import { nearestAllowedPitch } from "@/melody-engine/pitchUtils"

export interface GenerateSignaturePhrasesInput {
  chords: ChordEvent[]
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
  lengthBars?: 1 | 2
  finalCandidateCount?: number
  candidatePoolSize?: number
}

interface RhythmEvent {
  start: number
  duration: number
  accent: number
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

const VOICING_MODES: SignatureVoicingMode[] = [
  "single-line",
  "block-chord",
  "broken-chord",
]

/**
 * Archetypeごとの質感に合わせた分布。single-lineを最大配分に保ち、
 * 「短音だけでなく和音のフレーズも提案する」を既存の単音候補への追加として扱う。
 * obsessive-motorは反復スタブ(Dead or Aliveのシンセスタブのような駆動感)と
 * 相性が良いためblock-chordを厚めに、atmospheric-gatewayは分散和音の質感も
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

const ARCHETYPES: SignaturePhraseArchetype[] = [
  "atmospheric-gateway",
  "obsessive-motor",
  "kinetic-hook",
]

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mean(values: readonly number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function roundQuarter(value: number): number {
  return Math.round(value * 4) / 4
}

function planSignaturePhrase(
  input: GenerateSignaturePhrasesInput,
  seed: number,
  poolIndex: number,
): SignaturePhrasePlan {
  const rng = new SeededRandom(seed ^ 0x6a09e667)
  const lengthBars = (input.lengthBars ?? (poolIndex % 3 === 0 ? 1 : 2)) as
    | 1
    | 2
  const profileWeights: Record<SongProfileId, readonly number[]> = {
    "dark-romantic": [1.25, 1.45, 0.8],
    "cinematic-french-pop": [1.55, 0.75, 1],
    "minimal-tension": [1.6, 1.05, 0.55],
    "dramatic-synth-pop": [0.75, 1.4, 1.55],
    "original-custom": [1, 1, 1],
  }
  const archetype =
    poolIndex < ARCHETYPES.length
      ? ARCHETYPES[poolIndex]
      : rng.weightedPick(ARCHETYPES, profileWeights[input.songProfile])
  const archetypeRhythms = ARCHETYPE_RHYTHMS[archetype]
  const rhythmIdentity =
    archetypeRhythms[(poolIndex + rng.intBetween(0, 1)) % archetypeRhythms.length]
  const contour = CONTOURS[(poolIndex * 3 + rng.intBetween(0, 2)) % CONTOURS.length]
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
  return {
    role: "intro",
    lengthBars,
    archetype,
    rhythmIdentity,
    contour,
    variationStrategy,
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
      archetype === "atmospheric-gateway"
        ? 0.5
        : archetype === "kinetic-hook"
          ? 0.3
          : 0.22,
    harmonicAnchorPolicy:
      rng.next() < 0.72
        ? archetypePolicy[archetype]
        : harmonicPolicies[(poolIndex + rng.intBetween(0, 2)) % harmonicPolicies.length],
    voicingMode: rng.weightedPick(VOICING_MODES, VOICING_MODE_WEIGHTS[archetype]),
  }
}

function transformStatement(
  source: readonly RhythmEvent[],
  strategy: SignatureVariationStrategy,
  statementIndex: number,
): RhythmEvent[] {
  if (statementIndex === 0) return source.map((event) => ({ ...event }))
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

/** Pitchより先に、休符を含むRhythm Skeletonを完成させる。 */
export function buildSignatureRhythmSkeleton(
  plan: SignaturePhrasePlan,
  beatsPerBar: number,
): RhythmEvent[] {
  const source = RHYTHM_BLUEPRINTS[plan.rhythmIdentity]
  const events: RhythmEvent[] = []
  for (let bar = 0; bar < plan.lengthBars; bar++) {
    const transformed = transformStatement(source, plan.variationStrategy, bar)
    const statement = shapeStatementForArchetype(transformed, plan, bar)
    for (const event of statement) {
      const scale = beatsPerBar / 4
      const start = roundQuarter(bar * beatsPerBar + event.start * scale)
      const maxDuration = plan.lengthBars * beatsPerBar - start
      if (maxDuration <= 0) continue
      events.push({
        start,
        duration: Math.max(0.25, Math.min(roundQuarter(event.duration * scale), maxDuration)),
        accent: event.accent,
      })
    }
  }
  return events.sort((left, right) => left.start - right.start)
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
  const center =
    range.low +
    (range.high - range.low) *
      (plan.contour === "descending"
        ? Math.min(0.72, registerPosition + 0.12)
        : registerPosition)
  return nearestAllowedPitch(
    Math.round(center) + rng.pick([-4, -2, 0, 2, 5]),
    pool,
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
  const firstEntry = chordAtBeat(map, events[0].start) ?? map[0]
  let previous = startPitch(plan, firstEntry, keyScale, input.range, rng)
  const motifRoot = previous
  let previousInterval = 0
  let repeatedPitchCount = 0
  let previousStatement = -1
  let statementEventIndex = 0

  return events.map((event, index) => {
    const entry = chordAtBeat(map, event.start) ?? map[map.length - 1]
    const statement = Math.floor(event.start / input.beatsPerBar)
    if (statement !== previousStatement) {
      statementEventIndex = 0
      previousStatement = statement
    }
    const indexInMotif = statementEventIndex % motifPath.length
    statementEventIndex += 1
    let step = transformedStep(
      motifPath[indexInMotif],
      plan.variationStrategy,
      statement,
      indexInMotif,
    )
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
    if (statement > 0 && indexInMotif === 0) {
      const returnDistance =
        plan.archetype === "obsessive-motor"
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
    const desired = index === 0 ? previous : previous + step
    const chordTones = chordTonePitchClasses(entry.parsed)
    const usable = allUsablePitchClasses(entry.parsed)
    const structural =
      index === 0 ||
      index === events.length - 1 ||
      (plan.harmonicAnchorPolicy === "structural-only" &&
        Math.abs(event.start % input.beatsPerBar) < 0.05)
    const allowed = structural
      ? plan.harmonicAnchorPolicy === "tension-led"
        ? [...new Set([...usable, ...keyScale])]
        : chordTones
      : [...new Set([...keyScale, ...usable])]
    let placed = nearestAllowedPitch(desired, allowed, input.range)
    repeatedPitchCount = placed === previous ? repeatedPitchCount + 1 : 0
    if (repeatedPitchCount >= 2) {
      placed = nearestAllowedPitch(desired + direction * 2, allowed, input.range)
      repeatedPitchCount = placed === previous ? repeatedPitchCount : 0
    }
    const role = isChordTone(entry.parsed, pitchClass(placed))
      ? "chord-tone"
      : isTensionTone(entry.parsed, pitchClass(placed))
        ? "tension-hold"
        : "passing-tone"
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
        role === "chord-tone"
          ? undefined
          : {
              targetPitchClass: entry.parsed.rootPc,
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

function chordToneLadder(
  chordTones: readonly number[],
  range: RangeSetting,
): number[] {
  const ladder: number[] = []
  for (let pitch = range.low; pitch <= range.high; pitch++) {
    if (chordTones.includes(pitchClass(pitch))) ladder.push(pitch)
  }
  return ladder
}

function nearestLadderIndex(ladder: readonly number[], target: number): number {
  return ladder.reduce(
    (best, pitch, index) =>
      Math.abs(pitch - target) < Math.abs(ladder[best] - target) ? index : best,
    0,
  )
}

/**
 * leadピッチの直下から、和音構成音のうち既存の声部と3半音以上離れた
 * 支援音を探す。濁った密集和音(半音・全音の重なり)を避けるため。
 */
function supportPitchBelow(
  fromPitch: number,
  chordTones: readonly number[],
  range: RangeSetting,
  usedPitches: readonly number[],
): number | null {
  for (let pitch = fromPitch - 3; pitch >= range.low; pitch--) {
    if (!chordTones.includes(pitchClass(pitch))) continue
    if (usedPitches.some((used) => Math.abs(used - pitch) < 3)) continue
    return pitch
  }
  return null
}

/** 各leadノートへ和音構成音を1〜2声重ね、同時発音のスタブ／パッドにする。 */
function applyBlockChordVoicing(
  leadNotes: readonly MelodyNote[],
  map: readonly HarmonicMapEntry[],
  range: RangeSetting,
  seed: number,
): MelodyNote[] {
  const rng = new SeededRandom(seed ^ 0x1b873593)
  const result: MelodyNote[] = []
  for (const note of leadNotes) {
    result.push(note)
    const entry = chordAtBeat(map as HarmonicMapEntry[], note.startBeat)
    if (!entry) continue
    const chordTones = chordTonePitchClasses(entry.parsed)
    if (chordTones.length === 0) continue
    const voiceCount = rng.chance(0.55) ? 2 : 1
    const used = [note.pitch]
    for (let voice = 0; voice < voiceCount; voice++) {
      const support = supportPitchBelow(
        used[used.length - 1],
        chordTones,
        range,
        used,
      )
      if (support === null) break
      used.push(support)
      result.push({
        id: `${note.id}-chord${voice}`,
        startBeat: note.startBeat,
        durationBeats: note.durationBeats,
        pitch: support,
        velocity: Math.max(20, note.velocity - 14 - voice * 6),
        locks: [],
        plannedToneRole: "chord-tone",
      })
    }
  }
  return result
}

/** 各leadノートを短いアルペジオへ分解し、和音を分散和音として鳴らす。 */
function applyBrokenChordVoicing(
  leadNotes: readonly MelodyNote[],
  map: readonly HarmonicMapEntry[],
  range: RangeSetting,
  seed: number,
): MelodyNote[] {
  const rng = new SeededRandom(seed ^ 0x27d4eb2f)
  const result: MelodyNote[] = []
  leadNotes.forEach((note, index) => {
    const entry = chordAtBeat(map as HarmonicMapEntry[], note.startBeat)
    const chordTones = entry ? chordTonePitchClasses(entry.parsed) : []
    const ladder = chordToneLadder(chordTones, range)
    if (!entry || chordTones.length < 2 || ladder.length < 2 || note.durationBeats < 0.5) {
      result.push(note)
      return
    }
    const subdivisions = note.durationBeats >= 1 ? 3 : 2
    const anchorIndex = nearestLadderIndex(ladder, note.pitch)
    const direction = index % 2 === 0 ? 1 : -1
    const subDuration = note.durationBeats / subdivisions
    for (let step = 0; step < subdivisions; step++) {
      const isLast = step === subdivisions - 1
      const ladderIndex = isLast
        ? anchorIndex
        : Math.max(
            0,
            Math.min(ladder.length - 1, anchorIndex + direction * (subdivisions - 1 - step)),
          )
      result.push({
        id: `${note.id}-arp${step}`,
        startBeat: roundQuarter(note.startBeat + step * subDuration),
        durationBeats: roundQuarter(subDuration),
        pitch: ladder[ladderIndex],
        velocity: Math.max(20, note.velocity - step * 3 + rng.intBetween(-2, 2)),
        locks: [],
        plannedToneRole: "chord-tone",
      })
    }
  })
  return result
}

function applyVoicing(
  voicingMode: SignatureVoicingMode,
  leadNotes: readonly MelodyNote[],
  map: readonly HarmonicMapEntry[],
  range: RangeSetting,
  seed: number,
): MelodyNote[] {
  if (voicingMode === "block-chord") {
    return applyBlockChordVoicing(leadNotes, map, range, seed)
  }
  if (voicingMode === "broken-chord") {
    return applyBrokenChordVoicing(leadNotes, map, range, seed)
  }
  return leadNotes.map((note) => ({ ...note }))
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

function scoreSignaturePhrase(
  notes: MelodyNote[],
  plan: SignaturePhrasePlan,
  map: HarmonicMapEntry[],
  phraseLengthBeats: number,
  motifPath: readonly number[],
  fullNotes: MelodyNote[] = notes,
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
      silenceUse: 0,
      arpeggioPenalty: 1,
      mechanicalPenalty: 1,
      voicingQuality: 1,
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
  const motifMemorability = clamp01(
    (notes.length >= 3 && notes.length <= 10 ? 0.28 : 0.14) +
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
      (recurrence > 0.985 ? 0.16 : 0),
  )
  const weighted =
    identity * 0.09 +
    openingImpact * 0.12 +
    rhythmicIdentity * 0.13 +
    contourIdentity * 0.1 +
    developmentPotential * 0.1 +
    standaloneStrength * 0.06 +
    worldBuilding * 0.13 +
    motifMemorability * 0.13 +
    motifIntegrity * 0.06 +
    repetitionDrive * 0.05 +
    silenceUse * 0.03
  const voicingQuality = computeVoicingQuality(fullNotes)
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
    silenceUse,
    arpeggioPenalty,
    mechanicalPenalty,
    voicingQuality,
    overall:
      Math.round(
        clamp01(
          weighted -
            arpeggioPenalty * 0.18 -
            mechanicalPenalty * 0.22 -
            (1 - voicingQuality) * 0.12,
        ) * 10000,
      ) / 100,
  }
}

function buildSignaturePhrase(
  input: GenerateSignaturePhrasesInput,
  seed: number,
  poolIndex: number,
): BuiltSignaturePhrase {
  const plan = planSignaturePhrase(input, seed, poolIndex)
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
  const motifPath = baseMotifPath.map((step) => {
    if (input.drama === "restrained") {
      return Math.sign(step) * Math.min(3, Math.abs(step))
    }
    if (input.drama === "open" && Math.abs(step) >= 3) {
      return step + Math.sign(step)
    }
    return step
  })
  const leadNotes = placePitchPath(
    input,
    plan,
    events,
    map,
    seed,
    motifPath,
    phraseLengthBeats,
  )
  const notes = applyVoicing(plan.voicingMode, leadNotes, map, input.range, seed)
  return {
    notes,
    leadNotes,
    plan,
    phraseLengthBeats,
    seed,
    score: scoreSignaturePhrase(
      leadNotes,
      plan,
      map,
      phraseLengthBeats,
      motifPath,
      notes,
    ),
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
  const rhythmSimilarity = sequenceSimilarity(leftOnsets, rightOnsets, 0.01)
  const intervalSimilarity = sequenceSimilarity(leftIntervals, rightIntervals, 1)
  const contourSimilarity = sequenceSimilarity(leftContour, rightContour)
  const durationSimilarity = sequenceSimilarity(leftDurations, rightDurations, 0.01)
  const planSimilarity =
    (left.plan.archetype === right.plan.archetype ? 0.26 : 0) +
    (left.plan.rhythmIdentity === right.plan.rhythmIdentity ? 0.26 : 0) +
    (left.plan.contour === right.plan.contour ? 0.16 : 0) +
    (left.plan.variationStrategy === right.plan.variationStrategy ? 0.12 : 0) +
    (left.plan.lengthBars === right.plan.lengthBars ? 0.08 : 0) +
    (left.plan.voicingMode === right.plan.voicingMode ? 0.12 : 0)
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
      candidate.score.voicingQuality >= 0.5,
  )
  const hookEligible = qualityEligible.filter(
    (candidate) =>
      candidate.score.openingImpact >= 0.55 &&
      candidate.score.motifMemorability >= 0.55 &&
      candidate.score.motifIntegrity >= 0.4 &&
      candidate.score.worldBuilding >= 0.5,
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
      const archetypeAlreadyRepresented = sameArchetypeCount > 0
      const voicingAlreadyRepresented = sameVoicingCount > 0
      const redundancyPenalty =
        sameRhythmCount * 4 + sameContourCount * 1.5 +
        sameArchetypeCount * 2.5 +
        sameVoicingCount * 1.5 +
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
      const score =
        candidate.score.overall * 0.62 +
        diversity * 100 * 0.38 -
        redundancyPenalty +
        archetypeCoverageBonus +
        voicingCoverageBonus
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
  const pool = Array.from({ length: poolSize }, (_, poolIndex) =>
    buildSignaturePhrase(
      input,
      (input.seed + poolIndex * 16127) >>> 0,
      poolIndex,
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
  const pool = Array.from({ length: 24 }, (_, index) =>
    buildSignaturePhrase(
      input,
      (current.seed + 104729 + index * 16127) >>> 0,
      index + 7,
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
