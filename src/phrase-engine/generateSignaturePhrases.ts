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
  SignaturePhrasePlan,
  SignaturePhraseScore,
  SignaturePhraseSimilarity,
  SignatureRhythmIdentity,
  SignatureVariationStrategy,
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
  plan: SignaturePhrasePlan
  phraseLengthBeats: number
  seed: number
  score: SignaturePhraseScore
}

const DEFAULT_FINAL_COUNT = 12
const DEFAULT_POOL_SIZE = 48
const QUALITY_FLOOR = 58

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

const RHYTHM_IDENTITIES = Object.keys(
  RHYTHM_BLUEPRINTS,
) as SignatureRhythmIdentity[]

const CONTOURS: PhraseContour[] = [
  "ascending",
  "descending",
  "arch",
  "inverted-arch",
  "wave",
]

const VARIATIONS: SignatureVariationStrategy[] = [
  "displacement",
  "fragmentation",
  "augmentation",
  "answer",
  "delayed-return",
]

const MOTIF_PATHS: readonly number[][] = [
  [0, 2, -1, 3],
  [0, -2, 1, -3],
  [0, 4, -2, -1],
  [0, -5, 2, 1],
  [0, 0, 3, -1, -2],
  [0, 3, -1, 2, -4],
  [0, -3, 1, -2, 4],
  [0, 2, 2, -3, 1],
  [0, -1, 4, -2],
  [0, 5, -2, -2],
  [0, -4, 1, 2],
  [0, 1, -2, 4, -1],
]

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
  const rhythmIdentity =
    RHYTHM_IDENTITIES[(poolIndex + rng.intBetween(0, 2)) % RHYTHM_IDENTITIES.length]
  const contour = CONTOURS[(poolIndex * 3 + rng.intBetween(0, 2)) % CONTOURS.length]
  const variationStrategy =
    VARIATIONS[(poolIndex * 2 + rng.intBetween(0, 2)) % VARIATIONS.length]
  const harmonicPolicies = [
    "structural-only",
    "opening-and-ending",
    "tension-led",
  ] as const
  return {
    role: "intro",
    lengthBars,
    rhythmIdentity,
    contour,
    variationStrategy,
    motifSize: RHYTHM_BLUEPRINTS[rhythmIdentity].length,
    pickupBeats: RHYTHM_BLUEPRINTS[rhythmIdentity][0]?.start ?? 0,
    harmonicAnchorPolicy:
      harmonicPolicies[(poolIndex + rng.intBetween(0, 2)) % harmonicPolicies.length],
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

/** Pitchより先に、休符を含むRhythm Skeletonを完成させる。 */
export function buildSignatureRhythmSkeleton(
  plan: SignaturePhrasePlan,
  beatsPerBar: number,
): RhythmEvent[] {
  const source = RHYTHM_BLUEPRINTS[plan.rhythmIdentity]
  const events: RhythmEvent[] = []
  for (let bar = 0; bar < plan.lengthBars; bar++) {
    const statement = transformStatement(source, plan.variationStrategy, bar)
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
    plan.harmonicAnchorPolicy === "tension-led" && tensions.length > 0
      ? tensions
      : [...new Set([...chordTones, ...keyScale])]
  const center =
    range.low +
    (range.high - range.low) *
      (plan.contour === "descending" ? 0.67 : 0.42)
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
  let previousInterval = 0
  let repeatedPitchCount = 0

  return events.map((event, index) => {
    const entry = chordAtBeat(map, event.start) ?? map[map.length - 1]
    const statement = Math.floor(event.start / input.beatsPerBar)
    const indexInMotif = index % motifPath.length
    let step = transformedStep(
      motifPath[indexInMotif],
      plan.variationStrategy,
      statement,
      indexInMotif,
    )
    const direction = contourDirection(
      plan.contour,
      event.start / Math.max(1, phraseLengthBeats),
    )
    if (index > 0 && step !== 0 && Math.sign(step) !== direction) {
      step = Math.abs(step) * direction
    }
    if (Math.abs(previousInterval) >= 5) {
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
        68 + event.accent * 22 + rng.intBetween(-4, 4),
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
): SignaturePhraseScore {
  if (notes.length < 3) {
    return {
      identity: 0,
      openingImpact: 0,
      rhythmicIdentity: 0,
      contourIdentity: 0,
      developmentPotential: 0,
      standaloneStrength: 0,
      arpeggioPenalty: 1,
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
  const thirdMotion = intervals.filter(
    (interval) => Math.abs(interval) === 3 || Math.abs(interval) === 4,
  ).length / Math.max(1, intervals.length)
  const monotonic = countDirectionChanges(intervals) === 0
  const arpeggioPenalty = clamp01(
    Math.max(0, chordToneRatio - 0.72) * 1.8 +
      (thirdMotion > 0.65 && monotonic ? 0.35 : 0),
  )
  const weighted =
    identity * 0.2 +
    openingImpact * 0.18 +
    rhythmicIdentity * 0.19 +
    contourIdentity * 0.16 +
    developmentPotential * 0.15 +
    standaloneStrength * 0.12
  return {
    identity,
    openingImpact,
    rhythmicIdentity,
    contourIdentity,
    developmentPotential,
    standaloneStrength,
    arpeggioPenalty,
    overall: Math.round(clamp01(weighted - arpeggioPenalty * 0.22) * 10000) / 100,
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
  const baseMotifPath =
    MOTIF_PATHS[(poolIndex * 5 + seed) % MOTIF_PATHS.length]
  const motifPath = baseMotifPath.map((step) => {
    if (input.drama === "restrained") {
      return Math.sign(step) * Math.min(3, Math.abs(step))
    }
    if (input.drama === "open" && Math.abs(step) >= 3) {
      return step + Math.sign(step)
    }
    return step
  })
  const notes = placePitchPath(
    input,
    plan,
    events,
    map,
    seed,
    motifPath,
    phraseLengthBeats,
  )
  return {
    notes,
    plan,
    phraseLengthBeats,
    seed,
    score: scoreSignaturePhrase(notes, plan, map, phraseLengthBeats),
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
  left: Pick<BuiltSignaturePhrase, "notes" | "plan">,
  right: Pick<BuiltSignaturePhrase, "notes" | "plan">,
): SignaturePhraseSimilarity {
  const leftOnsets = left.notes.map((note) => roundQuarter(note.startBeat))
  const rightOnsets = right.notes.map((note) => roundQuarter(note.startBeat))
  const leftDurations = left.notes.map((note) => roundQuarter(note.durationBeats))
  const rightDurations = right.notes.map((note) => roundQuarter(note.durationBeats))
  const leftIntervals = intervalSequence(left.notes)
  const rightIntervals = intervalSequence(right.notes)
  const leftContour = leftIntervals.map(Math.sign)
  const rightContour = rightIntervals.map(Math.sign)
  const rhythmSimilarity = sequenceSimilarity(leftOnsets, rightOnsets, 0.01)
  const intervalSimilarity = sequenceSimilarity(leftIntervals, rightIntervals, 1)
  const contourSimilarity = sequenceSimilarity(leftContour, rightContour)
  const durationSimilarity = sequenceSimilarity(leftDurations, rightDurations, 0.01)
  const planSimilarity =
    (left.plan.rhythmIdentity === right.plan.rhythmIdentity ? 0.45 : 0) +
    (left.plan.contour === right.plan.contour ? 0.25 : 0) +
    (left.plan.variationStrategy === right.plan.variationStrategy ? 0.2 : 0) +
    (left.plan.lengthBars === right.plan.lengthBars ? 0.1 : 0)
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
  const eligible = pool.filter(
    (candidate) => candidate.score.overall >= QUALITY_FLOOR,
  )
  const source =
    eligible.length >= finalCount
      ? eligible
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
      const redundancyPenalty =
        sameRhythmCount * 4 + sameContourCount * 1.5 +
        (maximumSimilarity > 0.78 ? 18 : 0)
      const score =
        candidate.score.overall * 0.62 +
        diversity * 100 * 0.38 -
        redundancyPenalty
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
  currentSeed: number,
  avoid: Pick<SignaturePhraseCandidate, "notes" | "plan">[],
): Omit<SignaturePhraseCandidate, "id" | "batchId" | "createdAt"> {
  const pool = Array.from({ length: 24 }, (_, index) =>
    buildSignaturePhrase(
      input,
      (currentSeed + 104729 + index * 16127) >>> 0,
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
      return {
        candidate,
        similarities,
        selectionScore: candidate.score.overall * 0.62 + diversity * 100 * 0.38,
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
