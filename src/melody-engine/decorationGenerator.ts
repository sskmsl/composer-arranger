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
  const baseStep =
    style === "sixteenth" || style === "staccato"
      ? 0.25
      : style === "triplet"
        ? 1 / 3
        : style === "legato" || style === "dotted"
          ? 0.75
          : 0.5
  const maxCount = Math.max(1, Math.floor(lengthBeats / baseStep))
  const count = Math.min(densityCount, maxCount)
  const onsets: number[] = []
  const durations: number[] = []
  for (let index = 0; index < count; index++) {
    let onset = index * (lengthBeats / count)
    if (style === "syncopation") onset += index === 0 ? 0.25 : index % 2 === 0 ? 0.125 : 0
    onset = Math.min(lengthBeats - 0.125, onset)
    onsets.push(Number(onset.toFixed(4)))
    const next = index + 1 < count ? (index + 1) * (lengthBeats / count) : lengthBeats
    const available = Math.max(0.125, next - onset)
    const duration =
      style === "staccato"
        ? Math.min(0.25, available)
        : style === "legato"
          ? available
          : style === "dotted"
            ? Math.min(0.75, available)
            : Math.min(baseStep, available)
    durations.push(Number(duration.toFixed(4)))
  }
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
  const keyScale = keyScalePitchClasses(input.key)
  const notes: MelodyNote[] = grid.onsets.map((onset, index) => {
    const startBeat = plan.placementBeat + onset
    const chord = chordAtBeat(input.chords, Math.min(input.totalBeats - 0.001, startBeat))
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    const palette = [
      ...(parsed?.tones.map((tone) => tone.pitchClass) ?? []),
      ...(parsed?.tensions.slice(0, 2).map((tone) => tone.pitchClass) ?? []),
      ...keyScale,
    ]
    const pitchClass =
      index === grid.onsets.length - 1
        ? plan.targetPitchClass
        : palette[(index + rng.intBetween(0, Math.max(0, palette.length - 1))) % Math.max(1, palette.length)] ?? 0
    return {
      id: `decoration:${seed}:${index}`,
      startBeat,
      durationBeats: Math.min(
        grid.durations[index],
        Math.max(0.125, input.totalBeats - startBeat),
      ),
      pitch: nearestPitchClass(pitchClass, pitchTargets[index], window),
      velocity: rng.intBetween(
        plan.character === "bell" ? 52 : 45,
        plan.character === "strings" ? 66 : 72,
      ),
      locks: [],
      plannedToneRole:
        index === grid.onsets.length - 1
          ? "chord-tone"
          : parsed?.tones.some((tone) => tone.pitchClass === pitchClass)
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
  const placementBeat =
    type === "decorative-fill"
      ? Math.max(0, Math.min(input.totalBeats - lengthBeats, Math.round(input.totalBeats * 0.5 / input.beatsPerBar) * input.beatsPerBar - lengthBeats / 2))
      : Math.max(0, input.totalBeats - lengthBeats)
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
  const pool = Array.from({ length: Math.max(24, finalCount * 2) }, (_, index) =>
    buildCandidate(input, index, fingerprint),
  )
    .filter((candidate) => candidate.quality.overallQuality >= 55)
    .sort((a, b) => b.quality.overallQuality - a.quality.overallQuality)
  const selected: ReactiveLayerCandidate[] = []
  while (selected.length < finalCount && selected.length < pool.length) {
    if (selected.length === 0) {
      selected.push({ ...pool[0], selectionReason: "highest-quality" })
      continue
    }
    const next = pool
      .filter((candidate) => !selected.some((item) => item.id === candidate.id))
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
