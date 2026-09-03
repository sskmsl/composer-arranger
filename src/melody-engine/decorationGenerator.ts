import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent, SongProfileId } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import type { SectionRole } from "@/core/section"
import {
  pickTechniquePreference,
  techniquePreferenceWeight,
  type ResolvedComposerRules,
} from "@/composer-intelligence"
import type {
  DecorationCharacter,
  DecorationGestureRole,
  DecorationNeedLevel,
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
  assessReactiveActiveContextFit,
  assessReactiveNegativeSpaceFit,
  assessReactiveRoleComplementarity,
  evaluateReactiveLayerQuality,
} from "./reactiveLayerAnalysis"
import { enforceHarmonicIntegrity } from "./harmonicIntegrity"

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
  /** 現在鳴っているAccompaniment / Counter。候補選抜時の衝突回避に使う。 */
  existingSupportNotes?: MelodyNote[]
  existingReactiveLayers?: Pick<
    ReactiveLayerCandidate,
    "kind" | "role" | "notes"
  >[]
  previousSectionRole?: SectionRole
  nextSectionRole?: SectionRole
  nextSectionFirstChord?: string
  isLastSection: boolean
  candidateCount?: number
  arrangementContext?: DecorationArrangementContext
  preferenceProfile?: DecorationPreferenceProfile
  composerRules?: ResolvedComposerRules
  /** A/B実験時だけ有効にする、候補選抜におけるTechnique Fitの補助比率。 */
  techniqueFitSelectionWeight?: number
}

export interface DecorationArrangementContext {
  previousSectionNoteCount: number
  currentSectionNoteCount: number
  nextSectionNoteCount: number
}

export interface DecorationPreferenceProfile {
  favoriteCharacters: DecorationCharacter[]
  favoriteShapes: DecorationShape[]
  favoriteRhythms: DecorationRhythmStyle[]
  rejectedCharacters: DecorationCharacter[]
  rejectedShapes: DecorationShape[]
  rejectedRhythms: DecorationRhythmStyle[]
}

export interface DecorationNeedAssessment {
  level: DecorationNeedLevel
  score: number
  reason: string
}

interface PhraseBoundary {
  beat: number
  strength: number
  kind: "breath" | "long-note-release" | "section-ending"
}

function phraseBoundaries(
  melodyNotes: MelodyNote[],
  totalBeats: number,
): PhraseBoundary[] {
  if (melodyNotes.length === 0) {
    return [{ beat: totalBeats, strength: 70, kind: "section-ending" }]
  }
  const sorted = [...melodyNotes].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const boundaries: PhraseBoundary[] = []
  sorted.forEach((note, index) => {
    const noteEnd = Math.min(
      totalBeats,
      note.startBeat + note.durationBeats,
    )
    const next = sorted[index + 1]
    const gap = next ? next.startBeat - noteEnd : totalBeats - noteEnd
    if (gap >= 0.5) {
      boundaries.push({
        beat: noteEnd,
        strength: Math.min(100, 55 + gap * 18),
        kind: "breath",
      })
    }
    if (note.durationBeats >= 1.5) {
      boundaries.push({
        beat: noteEnd,
        strength: Math.min(92, 62 + note.durationBeats * 8),
        kind: "long-note-release",
      })
    }
  })
  const lastEnd = Math.min(
    totalBeats,
    sorted.at(-1)!.startBeat + sorted.at(-1)!.durationBeats,
  )
  boundaries.push({
    beat: Math.max(lastEnd, totalBeats - 0.5),
    strength: 82,
    kind: "section-ending",
  })
  return boundaries
    .sort((left, right) => right.strength - left.strength)
    .filter(
      (boundary, index, all) =>
        all.findIndex(
          (other) => Math.abs(other.beat - boundary.beat) <= 0.125,
        ) === index,
    )
}

export function assessDecorationNeed(
  input: GenerateDecorationInput,
): DecorationNeedAssessment {
  const analysis = analyzeMelodyActivity(
    input.melodyNotes ?? [],
    input.totalBeats,
  )
  const context = input.arrangementContext ?? {
    previousSectionNoteCount: 0,
    currentSectionNoteCount: 0,
    nextSectionNoteCount: 0,
  }
  const transitionImportance =
    input.nextSectionRole === "chorus" ||
    input.nextSectionRole === "grand-chorus" ||
    input.sectionRole === "pre-chorus"
      ? 22
      : input.nextSectionRole
        ? 10
        : 0
  const endingImportance =
    input.isLastSection || input.sectionRole === "outro" ? 18 : 0
  const gapOpportunity = Math.min(
    18,
    analysis.gaps.reduce(
      (sum, gap) => sum + Math.min(2, gap.durationBeats) * 3,
      0,
    ),
  )
  const densityPenalty =
    analysis.melodyDensity * 24 +
    Math.min(
      28,
      (context.currentSectionNoteCount / Math.max(1, input.totalBeats)) *
        18,
    )
  const surroundingPenalty =
    Math.min(
      10,
      (context.previousSectionNoteCount + context.nextSectionNoteCount) /
        Math.max(4, input.totalBeats),
    )
  const score = Math.max(
    0,
    Math.min(
      100,
      44 +
        transitionImportance +
        endingImportance +
        gapOpportunity -
        densityPenalty -
        surroundingPenalty,
    ),
  )
  if (score < 36) {
    return {
      level: "silence",
      score,
      reason:
        "主旋律と既存レイヤーの密度が高いため、装飾なしを第一候補にします。",
    }
  }
  if (score < 58) {
    return {
      level: "optional",
      score,
      reason:
        "装飾は必須ではありません。余白を保つ案と短いGestureを比較してください。",
    }
  }
  return {
    level: "recommended",
    score,
    reason:
      "Phrase BoundaryとSection推移に装飾の有効な役割があります。",
  }
}

const CHARACTERS: DecorationCharacter[] = ["strings", "bell", "piano", "generic"]

const SHAPES_BY_TYPE: Record<DecorationType, DecorationShape[]> = {
  "decorative-fill": [
    "turn",
    "neighbor-motion",
    "arpeggiated-fill",
    "repeated-sequence",
    "sparse-accent",
  ],
  "transition-fill": [
    "rising",
    "sequence",
    "repeated-sequence",
    "suspense",
    "arpeggiated-fill",
  ],
  "ending-fill": [
    "falling",
    "turn",
    "neighbor-motion",
    "suspense",
    "sparse-accent",
  ],
}

const RHYTHMS_BY_CHARACTER: Record<
  DecorationCharacter,
  DecorationRhythmStyle[]
> = {
  strings: ["legato", "dotted", "syncopation"],
  bell: ["dotted", "syncopation", "staccato"],
  piano: ["eighth", "sixteenth", "triplet", "syncopation"],
  generic: ["eighth", "syncopation", "dotted", "legato"],
}

const SHAPES_BY_CHARACTER: Partial<
  Record<DecorationCharacter, DecorationShape[]>
> = {
  strings: ["suspense", "falling", "rising", "neighbor-motion"],
  bell: ["sparse-accent", "turn", "rising", "falling"],
  piano: [
    "turn",
    "neighbor-motion",
    "arpeggiated-fill",
    "repeated-sequence",
  ],
}

function resolveShape(
  type: DecorationType,
  character: DecorationCharacter,
  poolIndex: number,
  rng: SeededRandom,
): DecorationShape {
  const typeShapes = SHAPES_BY_TYPE[type]
  const preferred = SHAPES_BY_CHARACTER[character]?.filter((shape) =>
    typeShapes.includes(shape),
  )
  const source = preferred && preferred.length > 0 ? preferred : typeShapes
  return source[
    (poolIndex + rng.intBetween(0, source.length - 1)) % source.length
  ]
}

function resolveRhythmStyle(
  type: DecorationType,
  character: DecorationCharacter,
  poolIndex: number,
  rng: SeededRandom,
): DecorationRhythmStyle {
  const compatible = RHYTHMS_BY_CHARACTER[character].filter((style) => {
    if (type === "ending-fill") return style !== "sixteenth"
    if (type === "transition-fill" && character === "strings") {
      return style === "legato" || style === "dotted" || style === "syncopation"
    }
    return true
  })
  return compatible[
    (poolIndex * 2 + rng.intBetween(0, compatible.length - 1)) %
      compatible.length
  ]
}

const GESTURES_BY_TYPE: Record<
  DecorationType,
  DecorationGestureRole[]
> = {
  "decorative-fill": ["response", "pedal", "swell", "pickup"],
  "transition-fill": ["pickup", "transition", "swell", "response"],
  "ending-fill": ["ending", "pedal", "response", "swell"],
}

const SHAPES_BY_GESTURE: Record<
  DecorationGestureRole,
  DecorationShape[]
> = {
  response: ["turn", "neighbor-motion", "repeated-sequence"],
  transition: ["rising", "sequence", "suspense"],
  ending: ["falling", "turn", "suspense"],
  swell: ["suspense", "rising", "falling"],
  pedal: ["sparse-accent", "suspense"],
  pickup: ["rising", "arpeggiated-fill", "sequence"],
}

const RHYTHMS_BY_GESTURE: Record<
  DecorationGestureRole,
  DecorationRhythmStyle[]
> = {
  response: ["eighth", "syncopation", "dotted", "triplet"],
  transition: ["syncopation", "dotted", "legato"],
  ending: ["dotted", "legato", "eighth"],
  swell: ["legato", "dotted"],
  pedal: ["legato", "dotted"],
  pickup: ["eighth", "sixteenth", "triplet", "syncopation"],
}

function resolveGestureRole(
  type: DecorationType,
  needLevel: DecorationNeedLevel,
  poolIndex: number,
  rng: SeededRandom,
  composerRules?: ResolvedComposerRules,
): DecorationGestureRole {
  const roles = GESTURES_BY_TYPE[type]
  const gestureIndex = Math.floor(poolIndex / 3)
  if (needLevel === "silence") {
    const restrained = roles.filter(
      (role) => role === "pedal" || role === "swell" || role === "response",
    )
    if (restrained.length > 0) {
      return pickTechniquePreference(
        rng,
        composerRules,
        "decorationGestureRole",
        restrained,
        restrained[gestureIndex % restrained.length],
      )
    }
  }
  return pickTechniquePreference(
    rng,
    composerRules,
    "decorationGestureRole",
    roles,
    roles[gestureIndex % roles.length],
  )
}

function resolvePlanDensity(
  setting: DecorationDensitySetting,
  role: DecorationGestureRole,
  poolIndex: number,
  rng: SeededRandom,
  composerRules?: ResolvedComposerRules,
): DecorationDensitySetting {
  if (setting !== "normal") return setting
  const fallback: DecorationDensitySetting =
    role === "pedal" || role === "swell"
      ? "sparse"
      : (role === "response" || role === "ending") &&
          poolIndex % 2 === 0
        ? "sparse"
        : (role === "pickup" || role === "transition") &&
            poolIndex % 5 === 4
          ? "rich"
          : "normal"
  return pickTechniquePreference(
    rng,
    composerRules,
    "phraseDensity",
    ["sparse", "normal", "rich"],
    fallback,
  )
}

function preferenceMatch(
  input: GenerateDecorationInput,
  character: DecorationCharacter,
  shape: DecorationShape,
  rhythm: DecorationRhythmStyle,
): number {
  const profile = input.preferenceProfile
  if (!profile) return 50
  let score = 50
  if (profile.favoriteCharacters.includes(character)) score += 16
  if (profile.favoriteShapes.includes(shape)) score += 18
  if (profile.favoriteRhythms.includes(rhythm)) score += 16
  if (profile.rejectedCharacters.includes(character)) score -= 18
  if (profile.rejectedShapes.includes(shape)) score -= 20
  if (profile.rejectedRhythms.includes(rhythm)) score -= 18
  return Math.max(0, Math.min(100, score))
}

function preferredValue<T>(
  generated: T,
  favorites: T[] | undefined,
  rejected: T[] | undefined,
  compatible: (value: T) => boolean,
  poolIndex: number,
): T {
  if (
    favorites &&
    favorites.length > 0 &&
    poolIndex % 3 === 0
  ) {
    const favorite = favorites.find(compatible)
    if (favorite !== undefined) return favorite
  }
  if (rejected?.includes(generated)) {
    const alternative = favorites?.find(compatible)
    if (alternative !== undefined) return alternative
  }
  return generated
}

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

/**
 * poolIndexだけで方向を決めると、resolveTypeのpoolIndex % Nによる型振り分けと剰余が
 * 一致し(例: pre-chorus→chorusのtransitionWeight=3では decorative-fill が常に
 * poolIndex % 3 === 0のスロットに固定される)、Auto方向が実質rising/falling固定に
 * 潰れてしまう回帰があった。型振り分けと相関しないよう、rng(poolIndexごとに
 * 個別seed化済み)から選ぶ。
 */
function resolveDirection(
  rng: SeededRandom,
  setting: DecorationDirectionSetting,
  type: DecorationType,
  composerRules?: ResolvedComposerRules,
): DecorationPlan["direction"] {
  if (setting !== "auto") return setting
  const fallback =
    type === "transition-fill"
      ? rng.chance(0.35)
        ? "mixed"
        : "rising"
      : type === "ending-fill"
        ? rng.chance(0.35)
          ? "mixed"
          : "falling"
        : rng.pick(["rising", "falling", "mixed"] as const)
  const preferred = pickTechniquePreference(
    rng,
    composerRules,
    "melodicDirection",
    ["ascending", "descending", "mixed", "stable"],
    fallback === "rising"
      ? "ascending"
      : fallback === "falling"
        ? "descending"
        : "mixed",
  )
  return preferred === "ascending"
    ? "rising"
    : preferred === "descending"
      ? "falling"
      : "mixed"
}

/**
 * decorative-fillはresolveTypeのpoolIndex % 3(pre-chorus→chorus等)と分母を共有する
 * ことがあり、その剰余に固定されたスロットではpoolIndex % 3が常に同じ値になって
 * lowレジスターが一切選ばれない回帰があった。resolveDirectionと同じくrngから選ぶ。
 */
function resolveRegister(
  rng: SeededRandom,
  type: DecorationType,
  character: DecorationCharacter,
  poolIndex: number,
  composerRules?: ResolvedComposerRules,
): DecorationPlan["register"] {
  if (character === "bell") return "high"
  const options = ["middle", "high", "low"] as const
  const fallback =
    type === "ending-fill"
      ? poolIndex % 2 === 0
        ? "middle"
        : "low"
      : rng.pick(options)
  return pickTechniquePreference(
    rng,
    composerRules,
    "register",
    options,
    fallback,
  )
}

function registerWindow(register: DecorationPlan["register"]): { low: number; high: number } {
  if (register === "low") return { low: 43, high: 60 }
  if (register === "high") return { low: 72, high: 91 }
  return { low: 58, high: 77 }
}

/**
 * 長いGestureはMelody Gapだけへ押し込まず、主旋律の外側の音域を使って共存させる。
 * 1拍前後の短いResponseはGap内で鳴るため、元のCharacter音域を維持する。
 */
function registerWindowForPlan(
  input: GenerateDecorationInput,
  plan: DecorationPlan,
): { low: number; high: number } {
  const base = registerWindow(plan.register)
  const melodyNotes = input.melodyNotes ?? []
  if (melodyNotes.length === 0 || plan.lengthBeats <= 1.25) {
    return base
  }
  const budget = analyzeMelodyActivity(
    melodyNotes,
    input.totalBeats,
  ).registerBudget
  if (plan.register === "low") {
    const separated = {
      low: Math.max(36, Math.min(base.low, budget.low)),
      high: Math.min(base.high, budget.melodyLow - 3),
    }
    if (separated.low <= separated.high) return separated
  }
  if (plan.register === "high") {
    const separated = {
      low: Math.max(base.low, budget.melodyHigh + 3),
      high: Math.min(96, Math.max(base.high, budget.high)),
    }
    if (separated.low <= separated.high) return separated
  }
  return {
    low: budget.low,
    high: budget.high,
  }
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
  const minimumSpacing =
    density === "sparse" ? 0.75 : density === "rich" ? 0.25 : 0.5
  // 短いMelody Gapへ4拍分の音数を圧縮しない。長さに応じた発音上限を先に設ける。
  const lengthCapacity = Math.max(
    1,
    Math.floor((lengthBeats + 0.001) / minimumSpacing),
  )
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
  const count = Math.min(densityCount, scaled.length, lengthCapacity)
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

function gestureVelocity(
  plan: DecorationPlan,
  index: number,
  count: number,
  rng: SeededRandom,
): number {
  const ranges: Record<DecorationCharacter, readonly [number, number]> = {
    strings: [42, 62],
    bell: [50, 70],
    piano: [48, 72],
    generic: [46, 68],
  }
  const [low, high] = ranges[plan.character]
  const progress = count <= 1 ? 1 : index / (count - 1)
  const expressiveProgress =
    plan.type === "transition-fill"
      ? progress
      : plan.type === "ending-fill"
        ? 1 - progress * 0.7
        : 1 - Math.abs(progress - 0.55) * 1.4
  return Math.max(
    1,
    Math.min(
      127,
      Math.round(
        low + (high - low) * expressiveProgress + rng.intBetween(-2, 2),
      ),
    ),
  )
}

function applyGestureArrival(
  notes: MelodyNote[],
  input: GenerateDecorationInput,
  plan: DecorationPlan,
  window: { low: number; high: number },
): MelodyNote[] {
  if (notes.length === 0) return notes
  const result = notes.map((note) => ({ ...note }))
  const arrivalIndex = result.length - 1
  const arrival = result[arrivalIndex]
  const desiredArrivalDuration =
    plan.type === "ending-fill"
      ? 1
      : plan.type === "transition-fill"
        ? 0.75
        : 0.5
  const gestureEnd = Math.min(
    input.totalBeats,
    plan.placementBeat + plan.lengthBeats,
  )
  const preferredArrivalStart = gestureEnd - desiredArrivalDuration
  const arrivalApproach = result[arrivalIndex - 1]
  if (
    arrivalApproach &&
    arrivalApproach.startBeat >= preferredArrivalStart
  ) {
    const previousNote = result[arrivalIndex - 2]
    arrivalApproach.startBeat = Math.max(
      previousNote
        ? previousNote.startBeat + 0.125
        : plan.placementBeat,
      preferredArrivalStart - 0.25,
    )
  }
  const minimumArrivalStart =
    result[arrivalIndex - 1]?.startBeat === undefined
      ? plan.placementBeat
      : result[arrivalIndex - 1].startBeat + 0.125
  arrival.startBeat = Math.max(
    minimumArrivalStart,
    Math.min(arrival.startBeat, preferredArrivalStart),
  )
  arrival.plannedToneRole =
    plan.type === "transition-fill" ? "tension-hold" : "chord-tone"
  arrival.durationBeats = Math.min(
    Math.max(arrival.durationBeats, desiredArrivalDuration),
    Math.max(0.125, gestureEnd - arrival.startBeat),
  )
  if (arrivalIndex === 0) return result

  const approachIndex = arrivalIndex - 1
  const approach = result[approachIndex]
  approach.durationBeats = Math.min(
    approach.durationBeats,
    Math.max(0.125, arrival.startBeat - approach.startBeat),
  )
  const scalePitches = pitchLadder(
    [...keyScalePitchClasses(input.key), plan.targetPitchClass],
    window,
  )
  const arrivalLadderIndex = scalePitches.reduce(
    (best, pitch, index) =>
      Math.abs(pitch - arrival.pitch) <
      Math.abs(scalePitches[best] - arrival.pitch)
        ? index
        : best,
    0,
  )
  const approachDirection =
    plan.direction === "falling" || plan.type === "ending-fill" ? 1 : -1
  const adjacentIndex = Math.max(
    0,
    Math.min(
      scalePitches.length - 1,
      arrivalLadderIndex + approachDirection,
    ),
  )
  const chromaticApproach =
    arrival.pitch + (approachDirection > 0 ? 1 : -1)
  approach.pitch =
    plan.shape === "suspense" &&
    chromaticApproach >= window.low &&
    chromaticApproach <= window.high
      ? chromaticApproach
      : scalePitches[adjacentIndex]
  approach.plannedToneRole = "approach-tone"
  return result
}

function commonTonePitchClass(
  input: GenerateDecorationInput,
  plan: DecorationPlan,
): number {
  const relevantChords = input.chords.filter((chord) => {
    const endBeat = plan.placementBeat + plan.lengthBeats
    return (
      chord.startBeat < endBeat &&
      chord.startBeat + chord.durationBeats > plan.placementBeat
    )
  })
  const counts = new Map<number, number>()
  for (const chord of relevantChords) {
    const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    for (const tone of parsed?.tones ?? []) {
      counts.set(tone.pitchClass, (counts.get(tone.pitchClass) ?? 0) + 1)
    }
  }
  return (
    [...counts.entries()].sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0] ?? plan.targetPitchClass
  )
}

function notesForPedal(
  input: GenerateDecorationInput,
  plan: DecorationPlan,
  seed: number,
): MelodyNote[] {
  const rng = new SeededRandom(seed)
  const window = registerWindowForPlan(input, plan)
  const pitchClass = commonTonePitchClass(input, plan)
  const pitch = nearestPitchClass(
    pitchClass,
    (window.low + window.high) / 2,
    window,
  )
  return [
    {
      id: `decoration:${seed}:pedal`,
      startBeat: plan.placementBeat,
      durationBeats: Math.min(
        plan.lengthBeats,
        input.totalBeats - plan.placementBeat,
      ),
      pitch,
      velocity: rng.intBetween(42, 54),
      locks: [],
      plannedToneRole: "common-tone",
    },
  ]
}

function notesForSwell(
  input: GenerateDecorationInput,
  plan: DecorationPlan,
  seed: number,
): MelodyNote[] {
  const rng = new SeededRandom(seed)
  const window = registerWindowForPlan(input, plan)
  const keyPitches = pitchLadder(keyScalePitchClasses(input.key), window)
  const centerIndex = Math.max(
    0,
    Math.min(
      keyPitches.length - 1,
      Math.floor(keyPitches.length / 2),
    ),
  )
  const count = plan.lengthBeats >= 3 ? 3 : 2
  const slot = plan.lengthBeats / count
  const notes: MelodyNote[] = Array.from(
    { length: count },
    (_, index) => {
      const direction = plan.direction === "falling" ? -1 : 1
      const pitchIndex = Math.max(
        0,
        Math.min(
          keyPitches.length - 1,
          centerIndex + direction * index,
        ),
      )
      return {
        id: `decoration:${seed}:swell:${index}`,
        startBeat: plan.placementBeat + index * slot,
        durationBeats: Math.max(0.5, slot),
        pitch: keyPitches[pitchIndex],
        velocity: gestureVelocity(plan, index, count, rng),
        locks: [],
        plannedToneRole: "tension-hold" as const,
      }
    },
  )
  if (
    plan.type === "transition-fill" ||
    plan.type === "ending-fill"
  ) {
    const final = notes.at(-1)!
    const targetPitch = nearestPitchClass(
      plan.targetPitchClass,
      final.pitch,
      window,
    )
    final.pitch = targetPitch
    final.plannedToneRole =
      plan.type === "transition-fill"
        ? "tension-hold"
        : "chord-tone"
    const approach = notes.at(-2)
    if (approach) {
      const direction = plan.direction === "falling" ? 1 : -1
      const scalePitches = pitchLadder(
        [...keyScalePitchClasses(input.key), plan.targetPitchClass],
        window,
      )
      const targetIndex = scalePitches.reduce(
        (best, pitch, index) =>
          Math.abs(pitch - targetPitch) <
          Math.abs(scalePitches[best] - targetPitch)
            ? index
            : best,
        0,
      )
      const approachIndex = Math.max(
        0,
        Math.min(scalePitches.length - 1, targetIndex + direction),
      )
      approach.pitch = scalePitches[approachIndex]
      approach.plannedToneRole = "approach-tone"
      approach.plannedResolution = {
        targetPitchClass: plan.targetPitchClass,
        targetBeat: final.startBeat,
        maximumDelayBeats: Math.max(
          0.25,
          final.startBeat - approach.startBeat,
        ),
      }
    }
  }
  return notes
}

function notesForPlan(
  input: GenerateDecorationInput,
  plan: DecorationPlan,
  seed: number,
): MelodyNote[] {
  if (plan.gestureRole === "pedal") {
    return notesForPedal(input, plan, seed)
  }
  if (plan.gestureRole === "swell") {
    return notesForSwell(input, plan, seed)
  }
  const rng = new SeededRandom(seed)
  const grid = rhythmGrid(plan.rhythmStyle, plan.lengthBeats, plan.density)
  const window = registerWindowForPlan(input, plan)
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
      velocity: gestureVelocity(plan, index, grid.onsets.length, rng),
      locks: [],
      plannedToneRole:
        index === grid.onsets.length - 1
          ? plan.type === "transition-fill"
            ? "tension-hold"
            : "chord-tone"
          : chordPitchClasses.includes(pitchClass)
            ? "chord-tone"
            : "passing-tone",
    }
  })
  const resolvedGesture = applyGestureArrival(notes, input, plan, window)
  return resolvedGesture.map((note, index) => {
    if (
      note.plannedToneRole !== "passing-tone" &&
      note.plannedToneRole !== "approach-tone"
    ) {
      return note
    }
    const target = resolvedGesture[index + 1]
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
  if (plan.gestureRole === "pedal") {
    return last.durationBeats >= 1 ? 94 : 78
  }
  if (plan.gestureRole === "swell") {
    const first = notes[0]
    const dynamicDirection =
      plan.type === "ending-fill"
        ? first.velocity >= last.velocity
        : last.velocity >= first.velocity
    return dynamicDirection ? 92 : 70
  }
  const previous = notes.at(-2)
  const targetFit =
    ((last.pitch % 12) + 12) % 12 === plan.targetPitchClass ? 100 : 45
  const approachInterval = previous
    ? Math.abs(last.pitch - previous.pitch)
    : 12
  const approachFit =
    approachInterval <= 2 ? 100 : approachInterval <= 4 ? 82 : 52
  const arrivalWeight =
    last.durationBeats >= 0.75 ? 100 : last.durationBeats >= 0.5 ? 82 : 60
  if (plan.type === "transition-fill") {
    return targetFit * 0.5 + approachFit * 0.3 + arrivalWeight * 0.2
  }
  if (plan.type === "ending-fill") {
    return targetFit * 0.45 + approachFit * 0.25 + arrivalWeight * 0.3
  }
  return targetFit * 0.25 + approachFit * 0.35 + arrivalWeight * 0.4
}

function musicality(
  notes: MelodyNote[],
  plan: DecorationPlan,
): number {
  if (notes.length < 2) return 72
  const intervals = notes.slice(1).map((note, index) => Math.abs(note.pitch - notes[index].pitch))
  const largeLeaps = intervals.filter((interval) => interval > 9).length
  const repeated = intervals.filter((interval) => interval === 0).length
  const onsetIntervals = notes
    .slice(1)
    .map((note, index) =>
      Number((note.startBeat - notes[index].startBeat).toFixed(3)),
    )
  const rhythmVariety = new Set(onsetIntervals).size >= 2 ? 6 : 0
  const firstVelocity = notes[0].velocity
  const lastVelocity = notes.at(-1)?.velocity ?? firstVelocity
  const dynamicFit =
    plan.type === "transition-fill"
      ? lastVelocity >= firstVelocity
        ? 6
        : -6
      : plan.type === "ending-fill"
        ? lastVelocity <= firstVelocity
          ? 6
          : -6
        : 3
  return Math.max(
    45,
    Math.min(
      100,
      88 -
        largeLeaps * 14 -
        Math.max(0, repeated - 1) * 5 +
        rhythmVariety +
        dynamicFit,
    ),
  )
}

function melodyRelationship(
  melodyNotes: MelodyNote[],
  notes: MelodyNote[],
): number {
  if (melodyNotes.length < 2 || notes.length < 2) return 78
  const melodySource = [...melodyNotes]
    .sort((a, b) => a.startBeat - b.startBeat)
    .filter((note) => note.startBeat <= notes[0].startBeat + 0.001)
    .slice(-4)
  if (melodySource.length < 2) return 75
  const sourceIntervals = melodySource
    .slice(1)
    .map((note, index) => Math.abs(note.pitch - melodySource[index].pitch))
  const decorationIntervals = notes
    .slice(1)
    .map((note, index) => Math.abs(note.pitch - notes[index].pitch))
  const related = decorationIntervals.filter((interval) =>
    sourceIntervals.some(
      (sourceInterval) => Math.abs(sourceInterval - interval) <= 1,
    ),
  ).length
  const relationship =
    related / Math.max(1, decorationIntervals.length)
  const exactCopy =
    sourceIntervals.length === decorationIntervals.length &&
    sourceIntervals.every(
      (interval, index) => interval === decorationIntervals[index],
    )
  return Math.max(
    55,
    Math.min(96, 68 + relationship * 24 - (exactCopy ? 14 : 0)),
  )
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
    Number(planA.gestureRole === planB.gestureRole) +
    Number(planA.shape === planB.shape) +
    Number(planA.rhythmStyle === planB.rhythmStyle) +
    Number(planA.register === planB.register) +
    Number(planA.direction === planB.direction)
  const onsetsA = new Set(
    a.notes.map((note) =>
      Math.round((note.startBeat - planA.placementBeat) * 4),
    ),
  )
  const onsetsB = new Set(
    b.notes.map((note) =>
      Math.round((note.startBeat - planB.placementBeat) * 4),
    ),
  )
  const onsetMatch =
    [...onsetsA].filter((onset) => onsetsB.has(onset)).length /
    Math.max(1, Math.max(onsetsA.size, onsetsB.size))
  const intervalsA = a.notes
    .slice(1)
    .map((note, index) => note.pitch - a.notes[index].pitch)
  const intervalsB = b.notes
    .slice(1)
    .map((note, index) => note.pitch - b.notes[index].pitch)
  const intervalCount = Math.max(intervalsA.length, intervalsB.length)
  const intervalMatch =
    intervalCount === 0
      ? Number(intervalsA.length === intervalsB.length)
      : Array.from({ length: intervalCount }, (_, index) => {
          const left = intervalsA[index]
          const right = intervalsB[index]
          if (left === undefined || right === undefined) return 0
          const directionMatch =
            Math.sign(left) === Math.sign(right) ? 1 : 0
          const sizeMatch = Math.max(
            0,
            1 - Math.abs(Math.abs(left) - Math.abs(right)) / 7,
          )
          return directionMatch * 0.6 + sizeMatch * 0.4
        }).reduce((sum, value) => sum + value, 0) / intervalCount
  const lengthMatch =
    1 -
    Math.min(
      1,
      Math.abs(planA.lengthBeats - planB.lengthBeats) /
        Math.max(0.25, planA.lengthBeats, planB.lengthBeats),
    )
  const placementMatch =
    1 -
    Math.min(
      1,
      Math.abs(planA.placementBeat - planB.placementBeat) / 4,
    )
  const noteCountMatch =
    Math.min(a.notes.length, b.notes.length) /
    Math.max(1, a.notes.length, b.notes.length)
  return (
    (categorical / 6) * 0.35 +
    onsetMatch * 0.2 +
    intervalMatch * 0.2 +
    lengthMatch * 0.1 +
    placementMatch * 0.1 +
    noteCountMatch * 0.05
  )
}

function minimumGestureNotes(plan: DecorationPlan | undefined): number {
  if (plan?.gestureRole === "pedal") return 1
  if (plan?.gestureRole === "swell") return 2
  if ((plan?.lengthBeats ?? 4) <= 1) return 2
  if (plan?.density === "sparse") return 2
  return 3
}

function isBreathingDecoration(
  candidate: ReactiveLayerCandidate,
): boolean {
  const plan = candidate.decorationPlan
  if (!plan || candidate.notes.length === 0) return false
  if (
    plan.gestureRole === "pedal" ||
    plan.gestureRole === "swell" ||
    plan.density === "sparse"
  ) {
    return true
  }
  if (candidate.notes.length <= 2) return true
  const sorted = [...candidate.notes].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const onsetGaps = sorted
    .slice(1)
    .map((note, index) => note.startBeat - sorted[index].startBeat)
  const averageGap =
    onsetGaps.reduce((sum, gap) => sum + gap, 0) /
    Math.max(1, onsetGaps.length)
  const soundingBeats = sorted.reduce(
    (sum, note) => sum + note.durationBeats,
    0,
  )
  const restRatio = Math.max(
    0,
    1 - soundingBeats / Math.max(0.25, plan.lengthBeats),
  )
  return averageGap >= 0.85 || restRatio >= 0.35
}

function planFor(
  input: GenerateDecorationInput,
  poolIndex: number,
  rng: SeededRandom,
): DecorationPlan {
  const type = resolveType(input, poolIndex)
  const need = assessDecorationNeed(input)
  const gestureRole = resolveGestureRole(
    type,
    need.level,
    poolIndex,
    rng,
    input.composerRules,
  )
  const density = resolvePlanDensity(
    input.settings.density,
    gestureRole,
    poolIndex,
    rng,
    input.composerRules,
  )
  const generatedCharacter = resolveCharacter(
    input.settings.character,
    poolIndex,
  )
  const character =
    input.settings.character === "auto"
      ? preferredValue(
          generatedCharacter,
          input.preferenceProfile?.favoriteCharacters,
          input.preferenceProfile?.rejectedCharacters,
          () => true,
          poolIndex,
        )
      : generatedCharacter
  const direction = resolveDirection(
    rng,
    input.settings.direction,
    type,
    input.composerRules,
  )
  const requestedLengthBeats =
    input.settings.length === "bar" ? input.beatsPerBar : input.settings.length
  const generatedShape = resolveShape(type, character, poolIndex, rng)
  const characterShapes = SHAPES_BY_CHARACTER[character]
  const gestureShapes = SHAPES_BY_GESTURE[gestureRole].filter(
    (shape) =>
      SHAPES_BY_TYPE[type].includes(shape) &&
      (!characterShapes || characterShapes.includes(shape)),
  )
  const roleShape =
    gestureShapes.length > 0
      ? gestureShapes[poolIndex % gestureShapes.length]
      : generatedShape
  const preferredShape = preferredValue(
    roleShape,
    input.preferenceProfile?.favoriteShapes,
    input.preferenceProfile?.rejectedShapes,
    (value) =>
      SHAPES_BY_TYPE[type].includes(value) &&
      SHAPES_BY_GESTURE[gestureRole].includes(value) &&
      (!characterShapes || characterShapes.includes(value)),
    poolIndex,
  )
  const compatibleShapes = SHAPES_BY_GESTURE[gestureRole].filter(
    (value) =>
      SHAPES_BY_TYPE[type].includes(value) &&
      (!characterShapes || characterShapes.includes(value)),
  )
  const shape =
    input.composerRules?.preferences.decorationShape &&
    compatibleShapes.length > 0
      ? pickTechniquePreference(
          rng,
          input.composerRules,
          "decorationShape",
          compatibleShapes,
          preferredShape,
        )
      : preferredShape
  const generatedRhythm = resolveRhythmStyle(
    type,
    character,
    poolIndex,
    rng,
  )
  const gestureRhythms = RHYTHMS_BY_GESTURE[gestureRole].filter((rhythm) =>
    RHYTHMS_BY_CHARACTER[character].includes(rhythm),
  )
  const roleRhythm =
    gestureRhythms.length > 0
      ? gestureRhythms[poolIndex % gestureRhythms.length]
      : generatedRhythm
  const preferredRhythm = preferredValue(
    roleRhythm,
    input.preferenceProfile?.favoriteRhythms,
    input.preferenceProfile?.rejectedRhythms,
    (value) =>
      RHYTHMS_BY_CHARACTER[character].includes(value) &&
      RHYTHMS_BY_GESTURE[gestureRole].includes(value),
    poolIndex,
  )
  const compatibleRhythms = RHYTHMS_BY_GESTURE[
    gestureRole
  ].filter((value) =>
    RHYTHMS_BY_CHARACTER[character].includes(value),
  )
  const rhythmStyle =
    input.composerRules?.preferences.decorationRhythmStyle &&
    compatibleRhythms.length > 0
      ? pickTechniquePreference(
          rng,
          input.composerRules,
          "decorationRhythmStyle",
          compatibleRhythms,
          preferredRhythm,
        )
      : preferredRhythm
  const boundaries = phraseBoundaries(
    input.melodyNotes ?? [],
    input.totalBeats,
  )
  const boundaryPool =
    gestureRole === "transition" ||
    gestureRole === "pickup" ||
    gestureRole === "ending"
      ? [...boundaries].sort((left, right) => right.beat - left.beat)
      : boundaries
  const boundary =
    boundaryPool[poolIndex % Math.max(1, boundaryPool.length)] ??
    ({ beat: input.totalBeats, strength: 70, kind: "section-ending" } as const)
  const allMelodyGaps =
    input.melodyNotes && input.melodyNotes.length > 0
      ? analyzeMelodyActivity(input.melodyNotes, input.totalBeats).gaps
      : []
  const roleLengthBeats =
    gestureRole === "response" || gestureRole === "pickup"
      ? Math.min(2, requestedLengthBeats)
      : requestedLengthBeats
  const fullLengthGaps = allMelodyGaps.filter(
    (gap) => gap.durationBeats >= roleLengthBeats,
  )
  const mediumGaps = allMelodyGaps.filter(
    (gap) =>
      gap.durationBeats >= Math.min(2, roleLengthBeats) &&
      !fullLengthGaps.includes(gap),
  )
  const shortGaps = allMelodyGaps.filter(
    (gap) => gap.durationBeats >= Math.min(0.5, roleLengthBeats),
  )
  // Responseだけは短い旋律の隙間へ収める。Transition / Swell / Pedalまで
  // 同じGapへ縮めると、全候補が1拍・1〜2音へ収束してしまう。
  const melodyGaps =
    gestureRole === "response"
      ? fullLengthGaps.length > 0
        ? fullLengthGaps
        : mediumGaps.length > 0
          ? mediumGaps
          : shortGaps
      : gestureRole === "pickup"
        ? fullLengthGaps.length > 0
          ? fullLengthGaps
          : mediumGaps
        : []
  const preferredGaps =
    gestureRole === "response"
      ? melodyGaps
      : [...melodyGaps].sort((a, b) => b.startBeat - a.startBeat)
  const selectedGap =
    preferredGaps.length > 0
      ? preferredGaps[poolIndex % preferredGaps.length]
      : undefined
  const lengthBeats = selectedGap
    ? Math.min(roleLengthBeats, selectedGap.durationBeats)
    : roleLengthBeats
  const placementBeat =
    selectedGap?.startBeat ??
    (gestureRole === "response"
      ? Math.max(
          0,
          Math.min(input.totalBeats - lengthBeats, boundary.beat),
        )
      : gestureRole === "swell" || gestureRole === "pedal"
        ? Math.max(
            0,
            Math.min(
              input.totalBeats - lengthBeats,
              boundary.beat - lengthBeats / 2,
            ),
          )
        : Math.max(
            0,
            Math.min(
              input.totalBeats - lengthBeats,
              boundary.beat - lengthBeats,
            ),
          ))
  const intention =
    gestureRole === "pickup"
      ? `${rhythmStyle}の弱起から${input.nextSectionRole ?? "次Phrase"}へ導く`
      : gestureRole === "swell"
        ? `${character}の持続と強弱でPhrase Boundaryを持ち上げる`
        : gestureRole === "pedal"
          ? `共通音を保持し、Harmony変化の色だけを聴かせる`
          : type === "transition-fill"
      ? `${rhythmStyle}の推進から${shape}で${input.nextSectionRole ?? "次セクション"}を先取りする`
      : type === "ending-fill"
        ? `${shape}と減衰する強弱で${input.sectionRole}の終止後へ余韻を残す`
        : `${character}の${shape}を主旋律の空間へ短く応答させる`
  return {
    type,
    character,
    shape,
    rhythmStyle,
    direction,
    density,
    lengthBeats,
    register: resolveRegister(
      rng,
      type,
      character,
      poolIndex,
      input.composerRules,
    ),
    placementBeat,
    targetPitchClass: targetPitchClass(input, type, poolIndex),
    intention,
    gestureRole,
    phraseBoundaryBeat: boundary.beat,
    needLevel: need.level,
    preferenceMatch: preferenceMatch(
      input,
      character,
      shape,
      rhythmStyle,
    ),
  }
}

function normalizedDecorationPreferenceWeight(
  composerRules: ResolvedComposerRules | undefined,
  axis:
    | "decorationGestureRole"
    | "decorationShape"
    | "decorationRhythmStyle"
    | "phraseDensity",
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

export function decorationTechniqueFitScore(
  plan: DecorationPlan | undefined,
  composerRules?: ResolvedComposerRules,
): number | undefined {
  if (!plan) return undefined
  const pairs = [
    ["decorationGestureRole", plan.gestureRole],
    ["decorationShape", plan.shape],
    ["decorationRhythmStyle", plan.rhythmStyle],
    ["phraseDensity", plan.density],
  ] as const
  const values = pairs.flatMap(([axis, value]) => {
    if (!value) return []
    const score = normalizedDecorationPreferenceWeight(
      composerRules,
      axis,
      value,
    )
    return score === undefined ? [] : [score]
  })
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

function buildCandidate(
  input: GenerateDecorationInput,
  poolIndex: number,
  fingerprint: string,
): ReactiveLayerCandidate {
  const seed = (input.seed + (poolIndex + 1) * 104_729) >>> 0
  const rng = new SeededRandom(seed)
  const plan = planFor(input, poolIndex, rng)
  const rawNotes = notesForPlan(input, plan, seed)
  const notes = enforceHarmonicIntegrity(
    rawNotes,
    input.chords,
    undefined,
    { preserveTerminalTension: plan.type === "transition-fill" },
  ).notes
  const harmonic = harmonicFit(rawNotes, input.chords)
  const transition = transitionQuality(rawNotes, plan)
  const music = musicality(rawNotes, plan)
  const melodyNotes = input.melodyNotes ?? []
  const relationship = melodyRelationship(melodyNotes, rawNotes)
  const motifScore = music * 0.65 + relationship * 0.35
  const evaluated =
    melodyNotes.length > 0
      ? evaluateReactiveLayerQuality(
          melodyNotes,
          rawNotes,
          analyzeMelodyActivity(melodyNotes, input.totalBeats),
          {
            harmonicFit: harmonic,
            motifRelationship: motifScore,
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
            motifRelationship: motifScore,
            sectionFit: plan.type === "transition-fill" && input.nextSectionRole ? 92 : 82,
            transitionValue: transition,
            overallQuality:
              harmonic * 0.22 +
              transition * 0.3 +
              motifScore * 0.23 +
              82 * 0.15 +
              90 * 0.1,
          },
          collisions: zeroCollisions(),
        }
  const activeContextFit = assessReactiveActiveContextFit(
    input.existingSupportNotes ?? [],
    rawNotes,
  )
  const negativeSpaceFit = assessReactiveNegativeSpaceFit(
    melodyNotes,
    input.existingSupportNotes ?? [],
    rawNotes,
    input.totalBeats,
  )
  const candidateRole =
    plan.type === "transition-fill"
      ? "transition"
      : plan.type === "ending-fill"
        ? "cadential-fill"
        : "gap-fill"
  const roleComplementarityFit = assessReactiveRoleComplementarity(
    input.existingReactiveLayers ?? [],
    { kind: "decoration", role: candidateRole, notes },
  )
  return {
    id: `decoration-${seed}-${poolIndex}`,
    batchId: `decoration-batch-${input.seed}`,
    sectionId: input.sectionId,
    targetMelodyVariantId: null,
    kind: "decoration",
    role: candidateRole,
    decorationPlan: plan,
    structureFingerprint: fingerprint,
    name: `${plan.gestureRole ?? "gesture"} · ${plan.character} · ${plan.shape}`,
    notes,
    seed,
    quality: evaluated.quality,
    collisions: evaluated.collisions,
    activeContextFit,
    negativeSpaceFit,
    roleComplementarityFit,
    techniqueFitScore: decorationTechniqueFitScore(
      plan,
      input.composerRules,
    ),
    reviewState: null,
    createdAt: new Date(0).toISOString(),
  }
}

/** Gesture候補プールから、品質とType/Shape/Rhythm差を持つ10案を返す。 */
export function generateDecorationCandidates(
  input: GenerateDecorationInput,
): ReactiveLayerCandidate[] {
  const finalCount = input.candidateCount ?? 10
  const techniqueFitSelectionWeight =
    input.techniqueFitSelectionWeight ?? 0
  const structuralWeight = Math.max(
    0,
    1 - techniqueFitSelectionWeight,
  )
  const fingerprint = decorationFingerprintForInput(input)
  const poolWithDuplicates = Array.from(
    { length: Math.max(80, finalCount * 8) },
    (_, index) => buildCandidate(input, index, fingerprint),
  )
    .filter(
      (candidate) =>
        candidate.quality.overallQuality >= 68 &&
        candidate.quality.harmonicFit >= 72 &&
        candidate.quality.melodyRespect >= 78 &&
        candidate.quality.motifRelationship >= 70 &&
        candidate.quality.transitionValue >= 78 &&
        !candidate.activeContextFit?.hasBlockingConflict &&
        !candidate.negativeSpaceFit?.hasBlockingConflict &&
        !candidate.roleComplementarityFit?.hasBlockingConflict &&
        candidate.notes.length >=
          minimumGestureNotes(candidate.decorationPlan) &&
        !candidate.collisions.hasBlockingCollision,
    )
    .sort(
      (a, b) =>
        (b.quality.overallQuality * 0.76 +
          (b.activeContextFit?.fitScore ?? 100) * 0.08 +
          (b.negativeSpaceFit?.fitScore ?? 100) * 0.08 +
          (b.roleComplementarityFit?.fitScore ?? 100) * 0.08 +
          (b.decorationPlan?.preferenceMatch ?? 50) * 0.08) *
          structuralWeight +
          (b.techniqueFitScore ?? 0) *
            100 *
            techniqueFitSelectionWeight -
        ((a.quality.overallQuality * 0.76 +
          (a.activeContextFit?.fitScore ?? 100) * 0.08 +
          (a.negativeSpaceFit?.fitScore ?? 100) * 0.08 +
          (a.roleComplementarityFit?.fitScore ?? 100) * 0.08 +
          (a.decorationPlan?.preferenceMatch ?? 50) * 0.08) *
          structuralWeight +
          (a.techniqueFitScore ?? 0) *
            100 *
            techniqueFitSelectionWeight),
    )
  const pool = poolWithDuplicates.filter(
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
  const selected: ReactiveLayerCandidate[] = []
  while (selected.length < finalCount && selected.length < pool.length) {
    if (selected.length === 0) {
      selected.push({ ...pool[0], selectionReason: "highest-quality" })
      continue
    }
    const remaining = pool.filter(
      (candidate) =>
        !selected.some((item) => item.id === candidate.id),
    )
    const selectedRoles = new Set(
      selected.map((item) => item.decorationPlan?.gestureRole),
    )
    const newRoleCandidates = remaining.filter(
      (candidate) =>
        !selectedRoles.has(candidate.decorationPlan?.gestureRole),
    )
    const needsRoleDiversity =
      selectedRoles.size < Math.min(4, finalCount) &&
      newRoleCandidates.length > 0
    const rolePool = needsRoleDiversity
      ? newRoleCandidates
      : remaining
    const breathingTarget = Math.min(3, finalCount)
    const needsBreathingSpace =
      selected.filter(isBreathingDecoration).length < breathingTarget &&
      rolePool.some(isBreathingDecoration)
    const densityPool = needsBreathingSpace
      ? rolePool.filter(isBreathingDecoration)
      : rolePool
    const selectedShapes = new Set(
      selected.map((item) => item.decorationPlan?.shape),
    )
    const newShapeCandidates = densityPool.filter(
      (candidate) =>
        !selectedShapes.has(candidate.decorationPlan?.shape),
    )
    const needsShapeDiversity =
      selectedShapes.size < Math.min(4, finalCount) &&
      newShapeCandidates.length > 0
    const shapePool = needsShapeDiversity
      ? newShapeCandidates
      : densityPool
    const needsStepwise =
      !selected.some((item) => isStepwiseDecoration(item)) &&
      shapePool.some((item) => isStepwiseDecoration(item))
    const selectionPool = needsStepwise
      ? shapePool.filter((candidate) => isStepwiseDecoration(candidate))
      : shapePool
    const next = selectionPool
      .map((candidate) => {
        const maximumSimilarity = Math.max(
          ...selected.map((item) => similarity(candidate, item)),
        )
        return {
          candidate,
          score:
            (candidate.quality.overallQuality * 0.76 +
              (candidate.activeContextFit?.fitScore ?? 100) * 0.08 +
              (candidate.negativeSpaceFit?.fitScore ?? 100) * 0.08 +
              (candidate.roleComplementarityFit?.fitScore ?? 100) * 0.08) *
              0.55 *
              structuralWeight +
            (1 - maximumSimilarity) *
              100 *
              0.35 *
              structuralWeight +
            (candidate.decorationPlan?.preferenceMatch ?? 50) *
              0.1 *
              structuralWeight +
            (candidate.techniqueFitScore ?? 0) *
              100 *
              techniqueFitSelectionWeight,
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
