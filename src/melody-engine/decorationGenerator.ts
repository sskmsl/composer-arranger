import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent, SongProfileId } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import type { SectionRole } from "@/core/section"
import type {
  DecorationCharacter,
  DecorationPlan,
  DecorationRhythmStyle,
  DecorationShape,
  DecorationType,
  ReactiveLayerCandidate,
  ReactiveLayerCollisionSummary,
} from "@/core/reactiveLayer"
import { decorationStructureFingerprint } from "@/core/reactiveLayer"
import { keyScalePitchClasses } from "@/core/scale"
import {
  analyzeMelodyActivity,
  evaluateReactiveLayerQuality,
} from "./reactiveLayerAnalysis"

export type DecorationTypeSetting = "auto" | DecorationType
export type DecorationCharacterSetting = "auto" | DecorationCharacter
export type DecorationDirectionSetting = "auto" | "rising" | "falling" | "mixed"
export type DecorationLengthSetting = 2 | 4 | "bar"
export type DecorationDensitySetting = "sparse" | "normal" | "rich"

export interface DecorationSettings {
  type: DecorationTypeSetting
  character: DecorationCharacterSetting
  direction: DecorationDirectionSetting
  length: DecorationLengthSetting
  density: DecorationDensitySetting
  /** 同じ構造・設定で候補を再現するための任意固定seed。 */
  seed?: number
}

export const DEFAULT_DECORATION_SETTINGS: DecorationSettings = {
  type: "auto",
  character: "auto",
  direction: "auto",
  length: 4,
  density: "normal",
  seed: 71,
}

export interface GenerateDecorationInput {
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  chords: ChordEvent[]
  totalBeats: number
  beatsPerBar: number
  key: string
  seed: number
  settings: DecorationSettings
  melodyNotes?: MelodyNote[]
  previousSectionRole?: SectionRole
  nextSectionRole?: SectionRole
  nextSectionFirstChord?: string
  isLastSection: boolean
  candidateCount?: number
}

const SHAPES: DecorationShape[] = [
  "rising",
  "falling",
  "sequence",
  "repeated-sequence",
  "turn",
  "neighbor-motion",
  "arpeggiated-fill",
  "suspense",
  "sparse-accent",
]

const RHYTHMS: DecorationRhythmStyle[] = [
  "eighth",
  "sixteenth",
  "triplet",
  "syncopation",
  "dotted",
  "legato",
  "staccato",
]

const CHARACTERS: DecorationCharacter[] = ["strings", "bell", "piano", "generic"]

export function decorationFingerprintForInput(input: GenerateDecorationInput): string {
  return decorationStructureFingerprint({
    sectionId: input.sectionId,
    sectionRole: input.sectionRole,
    chords: input.chords,
    totalBeats: input.totalBeats,
    previousSectionRole: input.previousSectionRole,
    nextSectionRole: input.nextSectionRole,
    nextSectionFirstChord: input.nextSectionFirstChord,
    isLastSection: input.isLastSection,
  })
}

function resolveType(
  input: GenerateDecorationInput,
  poolIndex: number,
): DecorationType {
  if (input.settings.type !== "auto") return input.settings.type
  if (input.isLastSection || input.sectionRole === "outro") return "ending-fill"
  if (input.nextSectionRole) {
    const transitionWeight =
      input.nextSectionRole === "chorus" ||
      input.nextSectionRole === "grand-chorus" ||
      input.sectionRole === "pre-chorus"
        ? 3
        : 2
    return poolIndex % transitionWeight === 0
      ? "decorative-fill"
      : "transition-fill"
  }
  return "decorative-fill"
}

function resolveCharacter(
  setting: DecorationCharacterSetting,
  poolIndex: number,
): DecorationCharacter {
  return setting === "auto" ? CHARACTERS[poolIndex % CHARACTERS.length] : setting
}

function resolveDirection(
  setting: DecorationDirectionSetting,
  type: DecorationType,
  poolIndex: number,
): DecorationPlan["direction"] {
  if (setting !== "auto") return setting
  if (type === "transition-fill") return poolIndex % 3 === 0 ? "mixed" : "rising"
  if (type === "ending-fill") return poolIndex % 3 === 0 ? "mixed" : "falling"
  return (["rising", "falling", "mixed"] as const)[poolIndex % 3]
}

function resolveRegister(
  type: DecorationType,
  character: DecorationCharacter,
  poolIndex: number,
): DecorationPlan["register"] {
  if (character === "bell") return "high"
  if (type === "ending-fill") return poolIndex % 2 === 0 ? "middle" : "low"
  return (["middle", "high", "low"] as const)[poolIndex % 3]
}

function registerWindow(register: DecorationPlan["register"]): { low: number; high: number } {
  if (register === "low") return { low: 43, high: 60 }
  if (register === "high") return { low: 72, high: 91 }
  return { low: 58, high: 77 }
}

function targetPitchClass(
  input: GenerateDecorationInput,
  type: DecorationType,
  poolIndex: number,
): number {
  const symbol =
    type === "transition-fill" && input.nextSectionFirstChord
      ? input.nextSectionFirstChord
      : input.chords[input.chords.length - 1]?.symbol
  const parsed = symbol ? parseChordSymbol(symbol) : null
  const targets = parsed
    ? [
        parsed.rootPc,
        ...parsed.tones
          .filter((tone) => tone.role === "third" || tone.role === "fifth" || tone.role === "seventh")
          .map((tone) => tone.pitchClass),
        ...parsed.tensions.slice(0, 1).map((tone) => tone.pitchClass),
      ]
    : [0, 4, 7]
  return targets[poolIndex % targets.length]
}

function nearestPitchClass(
  pitchClass: number,
  target: number,
  window: { low: number; high: number },
): number {
  let best = window.low
  let distance = Number.POSITIVE_INFINITY
  for (let pitch = window.low; pitch <= window.high; pitch++) {
    if (((pitch % 12) + 12) % 12 !== pitchClass) continue
    const nextDistance = Math.abs(pitch - target)
    if (nextDistance < distance) {
      best = pitch
      distance = nextDistance
    }
  }
  return best
}

function rhythmGrid(
  style: DecorationRhythmStyle,
  lengthBeats: number,
  density: DecorationDensitySetting,
): { onsets: number[]; durations: number[] } {
  const densityCount = density === "sparse" ? 3 : density === "rich" ? 8 : 5
  const cells: Record<DecorationRhythmStyle, number[]> = {
    eighth: [0, 0.5, 1.5, 2, 2.5, 3.5],
    sixteenth: [0, 0.25, 0.5, 1.25, 1.5, 2.5, 2.75, 3.5],
    triplet: [0, 1 / 3, 2 / 3, 1.5, 11 / 6, 13 / 6, 10 / 3],
    syncopation: [0.5, 1.25, 1.75, 2.5, 3.25],
    dotted: [0, 0.75, 1.5, 2.75, 3.5],
    legato: [0, 1.25, 2.5, 3.25],
    staccato: [0.25, 0.75, 1.5, 2.25, 3, 3.5],
  }
  const scaled = cells[style].map((onset) => onset * (lengthBeats / 4))
  const count = Math.min(densityCount, scaled.length)
  const indices =
    count === scaled.length
      ? scaled.map((_, index) => index)
      : Array.from({ length: count }, (_, index) =>
          Math.round((index * (scaled.length - 1)) / Math.max(1, count - 1)),
        )
  const onsets = indices.map((index) =>
    Number(Math.min(lengthBeats - 0.125, scaled[index]).toFixed(4)),
  )
  const durations = onsets.map((onset, index) => {
    const next = onsets[index + 1] ?? lengthBeats
    const available = Math.max(0.125, next - onset)
    const duration =
      style === "staccato"
        ? Math.min(0.25, available)
        : style === "legato"
          ? available
          : style === "dotted"
            ? Math.min(0.75 * (lengthBeats / 4), available)
            : Math.min(style === "sixteenth" ? 0.25 : 0.5, available)
    return Number(duration.toFixed(4))
  })
  return { onsets, durations }
}

function shapePitchTargets(
  shape: DecorationShape,
  direction: DecorationPlan["direction"],
  count: number,
  window: { low: number; high: number },
  target: number,
): number[] {
  const center = (window.low + window.high) / 2
  const sign = direction === "falling" ? -1 : 1
  const targets: number[] = []
  for (let index = 0; index < count; index++) {
    const progress = count <= 1 ? 1 : index / (count - 1)
    let value = center
    if (shape === "rising") value = window.low + progress * (window.high - window.low) * 0.75
    else if (shape === "falling") value = window.high - progress * (window.high - window.low) * 0.75
    else if (shape === "turn") value = center + [0, 3, -2, 1][index % 4]
    else if (shape === "neighbor-motion") value = center + [0, sign * 2, 0, -sign * 2][index % 4]
    else if (shape === "suspense") value = center + (index === count - 1 ? 0 : sign)
    else if (shape === "sparse-accent") value = center + (index % 2 === 0 ? 0 : sign * 5)
    else if (shape === "arpeggiated-fill") value = center + sign * [0, 4, 7, 11][index % 4]
    else if (shape === "repeated-sequence") value = center + sign * ([0, 2, 4][index % 3] + Math.floor(index / 3) * 2)
    else value = center + sign * (index * 2)
    targets.push(index === count - 1 ? target : value)
  }
  return targets
}

function chordAtBeat(chords: ChordEvent[], beat: number): ChordEvent | undefined {
  return (
    chords.find(
      (chord) =>
        beat >= chord.startBeat && beat < chord.startBeat + chord.durationBeats,
    ) ?? chords[chords.length - 1]
  )
}

function pitchLadder(
  pitchClasses: number[],
  window: { low: number; high: number },
): number[] {
  const allowed = new Set(pitchClasses)
  return Array.from(
    { length: window.high - window.low + 1 },
    (_, index) => window.low + index,
  ).filter((pitch) => allowed.has(((pitch % 12) + 12) % 12))
}

function nearestPitch(
  pitches: number[],
  target: number,
): number {
  return pitches.reduce((best, pitch) =>
    Math.abs(pitch - target) < Math.abs(best - target) ? pitch : best,
  )
}

function stepwiseShapePitches(
  input: GenerateDecorationInput,
  plan: DecorationPlan,
  count: number,
  window: { low: number; high: number },
): number[] | null {
  if (
    plan.shape !== "rising" &&
    plan.shape !== "falling" &&
    plan.shape !== "sequence" &&
    plan.shape !== "repeated-sequence"
  ) {
    return null
  }
  const ladder = pitchLadder(keyScalePitchClasses(input.key), window)
  if (ladder.length === 0) return null
  const target = nearestPitchClass(
    plan.targetPitchClass,
    (window.low + window.high) / 2,
    window,
  )
  const targetIndex = ladder.findIndex((pitch) => pitch === target)
  const anchorIndex =
    targetIndex >= 0
      ? targetIndex
      : ladder.reduce(
          (best, pitch, index) =>
            Math.abs(pitch - target) < Math.abs(ladder[best] - target)
              ? index
              : best,
          0,
        )
  const direction =
    plan.shape === "falling" || plan.direction === "falling" ? -1 : 1
  const startIndex = Math.max(
    0,
    Math.min(
      ladder.length - 1,
      anchorIndex - direction * Math.max(0, count - 1),
    ),
  )
  return Array.from({ length: count }, (_, index) => {
    const sequenceStep =
      plan.shape === "repeated-sequence"
        ? Math.floor((index + 1) / 2)
        : index
    const ladderIndex = Math.max(
      0,
      Math.min(ladder.length - 1, startIndex + direction * sequenceStep),
    )
    if (index === count - 1) return target
    return ladder[ladderIndex]
  })
}

function notesForPlan(
  input: GenerateDecorationInput,
  plan: DecorationPlan,
  seed: number,
): MelodyNote[] {
  const rng = new SeededRandom(seed)
  const grid = rhythmGrid(plan.rhythmStyle, plan.lengthBeats, plan.density)
  const window = registerWindow(plan.register)
  const pitchTargets = shapePitchTargets(
    plan.shape,
    plan.direction,
    grid.onsets.length,
    window,
    nearestPitchClass(plan.targetPitchClass, (window.low + window.high) / 2, window),
  )
  const stepwisePitches = stepwiseShapePitches(
    input,
    plan,
    grid.onsets.length,
    window,
  )
  const keyScale = keyScalePitchClasses(input.key)
  let previousPitch: number | null = null
  const notes: MelodyNote[] = grid.onsets.map((onset, index) => {
    const startBeat = plan.placementBeat + onset
    const chord = chordAtBeat(input.chords, Math.min(input.totalBeats - 0.001, startBeat))
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    const chordPitchClasses = parsed?.tones.map((tone) => tone.pitchClass) ?? []
    const palette = [
      ...(parsed?.tones.map((tone) => tone.pitchClass) ?? []),
      ...(parsed?.tensions.slice(0, 2).map((tone) => tone.pitchClass) ?? []),
      ...keyScale,
    ]
    const desiredPitch =
      stepwisePitches?.[index] ??
      (previousPitch === null
        ? pitchTargets[index]
        : Math.max(
            window.low,
            Math.min(
              window.high,
              pitchTargets[index] * 0.65 + previousPitch * 0.35,
            ),
          ))
    const targetPitchClass =
      index === grid.onsets.length - 1
        ? plan.targetPitchClass
        : undefined
    const availablePitches = pitchLadder(
      targetPitchClass === undefined ? palette : [targetPitchClass],
      window,
    )
    let pitch =
      stepwisePitches?.[index] ??
      nearestPitch(availablePitches, desiredPitch)
    if (
      previousPitch !== null &&
      Math.abs(pitch - previousPitch) > 7 &&
      index < grid.onsets.length - 1
    ) {
      const scalePitches = pitchLadder(keyScale, window)
      pitch = nearestPitch(
        scalePitches.filter(
          (candidate) => Math.abs(candidate - previousPitch!) <= 4,
        ).length > 0
          ? scalePitches.filter(
              (candidate) => Math.abs(candidate - previousPitch!) <= 4,
            )
          : scalePitches,
        desiredPitch,
      )
    }
    previousPitch = pitch
    const pitchClass = ((pitch % 12) + 12) % 12
    return {
      id: `decoration:${seed}:${index}`,
      startBeat,
      durationBeats: Math.min(
        grid.durations[index],
        Math.max(0.125, input.totalBeats - startBeat),
      ),
      pitch,
      velocity: rng.intBetween(
        plan.character === "bell" ? 52 : 45,
        plan.character === "strings" ? 66 : 72,
      ),
      locks: [],
      plannedToneRole:
        index === grid.onsets.length - 1
          ? "chord-tone"
          : chordPitchClasses.includes(pitchClass)
            ? "chord-tone"
            : "passing-tone",
    }
  })
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
  const matches = notes.filter((note) => {
    const chord = chordAtBeat(chords, note.startBeat)
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    const pc = ((note.pitch % 12) + 12) % 12
    return parsed
      ? [...parsed.tones, ...parsed.tensions].some((tone) => tone.pitchClass === pc)
      : false
  }).length
  return 55 + (matches / notes.length) * 45
}

function transitionQuality(notes: MelodyNote[], plan: DecorationPlan): number {
  const last = notes[notes.length - 1]
  if (!last) return 0
  const targetFit =
    ((last.pitch % 12) + 12) % 12 === plan.targetPitchClass ? 100 : 45
  if (plan.type === "transition-fill") return targetFit
  if (plan.type === "ending-fill") return targetFit * 0.9 + 8
  return 72 + targetFit * 0.18
}

function musicality(notes: MelodyNote[]): number {
  if (notes.length < 2) return 72
  const intervals = notes.slice(1).map((note, index) => Math.abs(note.pitch - notes[index].pitch))
  const largeLeaps = intervals.filter((interval) => interval > 9).length
  const repeated = intervals.filter((interval) => interval === 0).length
  return Math.max(45, 94 - largeLeaps * 14 - Math.max(0, repeated - 2) * 5)
}

function zeroCollisions(): ReactiveLayerCollisionSummary {
  return {
    samePitchOverlapBeats: 0,
    minorSecondOverlapBeats: 0,
    protectedMomentOverlapBeats: 0,
    voiceCrossingCount: 0,
    simultaneousAttackCount: 0,
    hasBlockingCollision: false,
  }
}

function similarity(a: ReactiveLayerCandidate, b: ReactiveLayerCandidate): number {
  const planA = a.decorationPlan
  const planB = b.decorationPlan
  if (!planA || !planB) return 1
  const categorical =
    Number(planA.type === planB.type) +
    Number(planA.shape === planB.shape) +
    Number(planA.rhythmStyle === planB.rhythmStyle) +
    Number(planA.register === planB.register) +
    Number(planA.direction === planB.direction)
  const onsetsA = new Set(a.notes.map((note) => Math.round(note.startBeat * 4)))
  const onsetsB = new Set(b.notes.map((note) => Math.round(note.startBeat * 4)))
  const onsetMatch =
    [...onsetsA].filter((onset) => onsetsB.has(onset)).length /
    Math.max(1, Math.max(onsetsA.size, onsetsB.size))
  return (categorical / 5) * 0.7 + onsetMatch * 0.3
}

function planFor(
  input: GenerateDecorationInput,
  poolIndex: number,
  rng: SeededRandom,
): DecorationPlan {
  const type = resolveType(input, poolIndex)
  const character = resolveCharacter(input.settings.character, poolIndex)
  const direction = resolveDirection(input.settings.direction, type, poolIndex)
  const lengthBeats =
    input.settings.length === "bar" ? input.beatsPerBar : input.settings.length
  const shape = SHAPES[(poolIndex + rng.intBetween(0, SHAPES.length - 1)) % SHAPES.length]
  const rhythmStyle = RHYTHMS[(poolIndex * 2 + rng.intBetween(0, RHYTHMS.length - 1)) % RHYTHMS.length]
  const melodyGaps =
    input.melodyNotes && input.melodyNotes.length > 0
      ? analyzeMelodyActivity(input.melodyNotes, input.totalBeats).gaps.filter(
          (gap) => gap.durationBeats >= lengthBeats,
        )
      : []
  const preferredGaps =
    type === "decorative-fill"
      ? melodyGaps
      : [...melodyGaps].sort((a, b) => b.startBeat - a.startBeat)
  const selectedGap =
    preferredGaps.length > 0
      ? preferredGaps[poolIndex % preferredGaps.length]
      : undefined
  const placementBeat =
    selectedGap?.startBeat ??
    (type === "decorative-fill"
      ? Math.max(
          0,
          Math.min(
            input.totalBeats - lengthBeats,
            (1 + (poolIndex % 3)) * input.beatsPerBar - lengthBeats / 2,
          ),
        )
      : Math.max(0, input.totalBeats - lengthBeats))
  const intention =
    type === "transition-fill"
      ? `${input.sectionRole}から${input.nextSectionRole ?? "次セクション"}への期待を作る`
      : type === "ending-fill"
        ? `${input.sectionRole}の終止と余韻を補強する`
        : `${input.sectionRole}内の空間へ短い色彩を加える`
  return {
    type,
    character,
    shape,
    rhythmStyle,
    direction,
    density: input.settings.density,
    lengthBeats,
    register: resolveRegister(type, character, poolIndex),
    placementBeat,
    targetPitchClass: targetPitchClass(input, type, poolIndex),
    intention,
  }
}

function buildCandidate(
  input: GenerateDecorationInput,
  poolIndex: number,
  fingerprint: string,
): ReactiveLayerCandidate {
  const seed = (input.seed + (poolIndex + 1) * 104_729) >>> 0
  const rng = new SeededRandom(seed)
  const plan = planFor(input, poolIndex, rng)
  const notes = notesForPlan(input, plan, seed)
  const harmonic = harmonicFit(notes, input.chords)
  const transition = transitionQuality(notes, plan)
  const music = musicality(notes)
  const melodyNotes = input.melodyNotes ?? []
  const evaluated =
    melodyNotes.length > 0
      ? evaluateReactiveLayerQuality(
          melodyNotes,
          notes,
          analyzeMelodyActivity(melodyNotes, input.totalBeats),
          {
            harmonicFit: harmonic,
            motifRelationship: music,
            sectionFit: plan.type === "transition-fill" && input.nextSectionRole ? 92 : 82,
            transitionValue: transition,
          },
        )
      : {
          quality: {
            melodyRespect: 90,
            harmonicFit: harmonic,
            gapUsage: 80,
            registerSeparation: 82,
            motifRelationship: music,
            sectionFit: plan.type === "transition-fill" && input.nextSectionRole ? 92 : 82,
            transitionValue: transition,
            overallQuality:
              harmonic * 0.25 + transition * 0.3 + music * 0.2 + 82 * 0.15 + 90 * 0.1,
          },
          collisions: zeroCollisions(),
        }
  return {
    id: `decoration-${seed}-${poolIndex}`,
    batchId: `decoration-batch-${input.seed}`,
    sectionId: input.sectionId,
    targetMelodyVariantId: null,
    kind: "decoration",
    role:
      plan.type === "transition-fill"
        ? "transition"
        : plan.type === "ending-fill"
          ? "cadential-fill"
          : "gap-fill",
    decorationPlan: plan,
    structureFingerprint: fingerprint,
    name: `${plan.type === "transition-fill" ? "Transition" : plan.type === "ending-fill" ? "Ending" : "Decorative"} · ${plan.character}`,
    notes,
    seed,
    quality: evaluated.quality,
    collisions: evaluated.collisions,
    reviewState: null,
    createdAt: new Date(0).toISOString(),
  }
}

/** #71: Structure Driven候補プールから、品質とType/Shape/Rhythm差を持つ10案を返す。 */
export function generateDecorationCandidates(
  input: GenerateDecorationInput,
): ReactiveLayerCandidate[] {
  const finalCount = input.candidateCount ?? 10
  const fingerprint = decorationFingerprintForInput(input)
  const pool = Array.from({ length: Math.max(60, finalCount * 6) }, (_, index) =>
    buildCandidate(input, index, fingerprint),
  )
    .filter(
      (candidate) =>
        candidate.quality.overallQuality >= 68 &&
        candidate.quality.harmonicFit >= 72 &&
        candidate.quality.melodyRespect >= 78 &&
        !candidate.collisions.hasBlockingCollision,
    )
    .sort((a, b) => b.quality.overallQuality - a.quality.overallQuality)
  const selected: ReactiveLayerCandidate[] = []
  while (selected.length < finalCount && selected.length < pool.length) {
    if (selected.length === 0) {
      selected.push({ ...pool[0], selectionReason: "highest-quality" })
      continue
    }
    const next = pool
      .filter((candidate) => !selected.some((item) => item.id === candidate.id))
      .filter(
        (candidate) =>
          selected.some((item) => isStepwiseDecoration(item)) ||
          isStepwiseDecoration(candidate),
      )
      .map((candidate) => {
        const maximumSimilarity = Math.max(
          ...selected.map((item) => similarity(candidate, item)),
        )
        return {
          candidate,
          score:
            candidate.quality.overallQuality * 0.62 +
            (1 - maximumSimilarity) * 100 * 0.38,
        }
      })
      .sort((a, b) => b.score - a.score)[0]?.candidate
    if (!next) break
    selected.push({ ...next, selectionReason: "quality-diversity-balance" })
  }
  return selected
}

function isStepwiseDecoration(candidate: ReactiveLayerCandidate): boolean {
  if (candidate.notes.length < 3) return false
  const intervals = candidate.notes
    .slice(1)
    .map((note, index) => note.pitch - candidate.notes[index].pitch)
  const direction = Math.sign(intervals[0])
  return (
    direction !== 0 &&
    intervals.every(
      (interval) =>
        Math.sign(interval) === direction &&
        Math.abs(interval) >= 1 &&
        Math.abs(interval) <= 3,
    )
  )
}

export function regenerateDecorationCandidate(
  input: GenerateDecorationInput,
  current: ReactiveLayerCandidate,
  siblings: ReactiveLayerCandidate[],
): ReactiveLayerCandidate | null {
  const candidates = generateDecorationCandidates({
    ...input,
    seed: (current.seed + 1_000_003) >>> 0,
  })
  return (
    candidates
      .filter(
        (candidate) =>
          candidate.decorationPlan?.shape !== current.decorationPlan?.shape ||
          candidate.decorationPlan?.rhythmStyle !== current.decorationPlan?.rhythmStyle,
      )
      .map((candidate) => ({
        candidate,
        similarity: Math.max(0, ...siblings.map((sibling) => similarity(candidate, sibling))),
      }))
      .sort(
        (a, b) =>
          a.similarity - b.similarity ||
          b.candidate.quality.overallQuality - a.candidate.quality.overallQuality,
      )[0]?.candidate ?? candidates[0] ?? null
  )
}
