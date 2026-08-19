import type { MelodyNote } from "@/core/melody"
import { parseChordSymbol } from "@/core/chord"
import type { ChordEvent, ComposerProject } from "@/core/project"
import type {
  CounterOpportunityKind,
  ReactiveLayerCandidate,
  ReactiveLayerActiveContextFit,
  ReactiveLayerCollisionSummary,
  ReactiveLayerCompatibility,
  ReactiveLayerNegativeSpaceFit,
  ReactiveLayerRoleComplementarityFit,
  ReactiveLayerQualityBreakdown,
} from "@/core/reactiveLayer"

export type ProtectedMomentReason =
  | "highest-note"
  | "long-note"
  | "leap-landing"
  | "non-chord-resolution"

export interface ProtectedMoment {
  startBeat: number
  endBeat: number
  pitch: number
  reasons: ProtectedMomentReason[]
}

export function assessReactiveActiveContextFit(
  existingNotes: readonly MelodyNote[],
  candidateNotes: readonly MelodyNote[],
): ReactiveLayerActiveContextFit {
  let samePitchOverlapBeats = 0
  let minorSecondOverlapBeats = 0
  let simultaneousAttackCount = 0
  for (const existing of existingNotes) {
    for (const candidate of candidateNotes) {
      const overlap = overlapDuration(existing, candidate)
      if (overlap > 0.03) {
        const interval = Math.abs(existing.pitch - candidate.pitch)
        if (interval === 0) samePitchOverlapBeats += overlap
        if (interval === 1) minorSecondOverlapBeats += overlap
      }
      if (Math.abs(existing.startBeat - candidate.startBeat) <= 0.08) {
        simultaneousAttackCount += 1
      }
    }
  }
  samePitchOverlapBeats = Math.round(samePitchOverlapBeats * 100) / 100
  minorSecondOverlapBeats = Math.round(minorSecondOverlapBeats * 100) / 100
  const fitScore = Math.max(
    0,
    Math.round(
      100 -
      samePitchOverlapBeats * 32 -
      minorSecondOverlapBeats * 38 -
      simultaneousAttackCount * 2,
    ),
  )
  return {
    samePitchOverlapBeats,
    minorSecondOverlapBeats,
    simultaneousAttackCount,
    fitScore,
    hasBlockingConflict:
      samePitchOverlapBeats > 0.75 || minorSecondOverlapBeats > 0.5,
  }
}

function occupiedWithinGap(
  notes: readonly MelodyNote[],
  gap: MelodyGap,
): number {
  const ranges = notes
    .map((note) => ({
      start: Math.max(gap.startBeat, note.startBeat),
      end: Math.min(gap.endBeat, note.startBeat + note.durationBeats),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start)
  if (ranges.length === 0) return 0
  let occupied = 0
  let start = ranges[0].start
  let end = ranges[0].end
  for (const range of ranges.slice(1)) {
    if (range.start <= end + 0.001) {
      end = Math.max(end, range.end)
    } else {
      occupied += end - start
      start = range.start
      end = range.end
    }
  }
  return occupied + end - start
}

export function assessReactiveNegativeSpaceFit(
  melodyNotes: readonly MelodyNote[],
  existingSupportNotes: readonly MelodyNote[],
  candidateNotes: readonly MelodyNote[],
  totalBeats: number,
): ReactiveLayerNegativeSpaceFit {
  const gaps = analyzeMelodyActivity([...melodyNotes], totalBeats).gaps
  const melodyGapBeats = gaps.reduce(
    (sum, gap) => sum + gap.durationBeats,
    0,
  )
  if (melodyGapBeats <= 0) {
    return {
      melodyGapBeats: 0,
      baselineAvailableBeats: 0,
      remainingBreathBeats: 0,
      consumedAvailableRatio: 0,
      newlyFilledGapCount: 0,
      fitScore: 100,
      hasBlockingConflict: false,
    }
  }
  const combined = [...existingSupportNotes, ...candidateNotes]
  const baselineOccupied = gaps.reduce(
    (sum, gap) => sum + occupiedWithinGap(existingSupportNotes, gap),
    0,
  )
  const combinedOccupied = gaps.reduce(
    (sum, gap) => sum + occupiedWithinGap(combined, gap),
    0,
  )
  const baselineAvailableBeats = Math.max(
    0,
    melodyGapBeats - baselineOccupied,
  )
  const remainingBreathBeats = Math.max(
    0,
    melodyGapBeats - combinedOccupied,
  )
  const consumedBeats = Math.max(
    0,
    baselineAvailableBeats - remainingBreathBeats,
  )
  const consumedAvailableRatio = baselineAvailableBeats > 0
    ? Math.min(1, consumedBeats / baselineAvailableBeats)
    : 0
  const newlyFilledGapCount = gaps.filter((gap) => {
    const duration = Math.max(0.001, gap.durationBeats)
    const before = occupiedWithinGap(existingSupportNotes, gap) / duration
    const after = occupiedWithinGap(combined, gap) / duration
    return before < 0.8 && after >= 0.8
  }).length
  const remainingRatio = remainingBreathBeats / melodyGapBeats
  const fitScore = Math.max(
    0,
    Math.round(
      100 - consumedAvailableRatio * 55 - newlyFilledGapCount * 8,
    ),
  )
  return {
    melodyGapBeats: Math.round(melodyGapBeats * 100) / 100,
    baselineAvailableBeats:
      Math.round(baselineAvailableBeats * 100) / 100,
    remainingBreathBeats:
      Math.round(remainingBreathBeats * 100) / 100,
    consumedAvailableRatio:
      Math.round(consumedAvailableRatio * 1000) / 1000,
    newlyFilledGapCount,
    fitScore,
    hasBlockingConflict:
      (baselineAvailableBeats >= 1 && consumedAvailableRatio > 0.85) ||
      (remainingRatio < 0.08 && consumedBeats > 0.5),
  }
}

type ComplementarityLayer = Pick<
  ReactiveLayerCandidate,
  "kind" | "role" | "notes"
>

function attackSimilarity(
  left: readonly MelodyNote[],
  right: readonly MelodyNote[],
): number {
  if (left.length === 0 || right.length === 0) return 0
  const matches = left.filter((leftNote) =>
    right.some(
      (rightNote) =>
        Math.abs(leftNote.startBeat - rightNote.startBeat) <= 0.08,
    ),
  ).length
  return matches / Math.max(1, Math.min(left.length, right.length))
}

function temporalOverlapRatio(
  left: readonly MelodyNote[],
  right: readonly MelodyNote[],
): number {
  const leftDuration = left.reduce(
    (sum, note) => sum + note.durationBeats,
    0,
  )
  const rightDuration = right.reduce(
    (sum, note) => sum + note.durationBeats,
    0,
  )
  if (leftDuration <= 0 || rightDuration <= 0) return 0
  const overlap = left.reduce(
    (sum, leftNote) =>
      sum + right.reduce(
        (inner, rightNote) => inner + overlapDuration(leftNote, rightNote),
        0,
      ),
    0,
  )
  return Math.min(1, overlap / Math.min(leftDuration, rightDuration))
}

function averagePitch(notes: readonly MelodyNote[]): number | null {
  if (notes.length === 0) return null
  return notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length
}

export function assessReactiveRoleComplementarity(
  existingLayers: readonly ComplementarityLayer[],
  candidate: ComplementarityLayer,
): ReactiveLayerRoleComplementarityFit {
  if (existingLayers.length === 0) {
    return {
      duplicateRoleCount: 0,
      maximumAttackSimilarity: 0,
      maximumTemporalOverlapRatio: 0,
      minimumRegisterDistance: 24,
      fitScore: 100,
      hasBlockingConflict: false,
    }
  }
  const candidateCenter = averagePitch(candidate.notes)
  const comparisons = existingLayers.map((existing) => {
    const existingCenter = averagePitch(existing.notes)
    return {
      duplicateRole: existing.role === candidate.role,
      attack: attackSimilarity(existing.notes, candidate.notes),
      temporal: temporalOverlapRatio(existing.notes, candidate.notes),
      registerDistance:
        candidateCenter === null || existingCenter === null
          ? 24
          : Math.abs(candidateCenter - existingCenter),
    }
  })
  const duplicateRoleCount = comparisons.filter(
    (comparison) => comparison.duplicateRole,
  ).length
  const maximumAttackSimilarity = Math.max(
    0,
    ...comparisons.map((comparison) => comparison.attack),
  )
  const maximumTemporalOverlapRatio = Math.max(
    0,
    ...comparisons.map((comparison) => comparison.temporal),
  )
  const minimumRegisterDistance = Math.min(
    24,
    ...comparisons.map((comparison) => comparison.registerDistance),
  )
  const closeRegisterPenalty = minimumRegisterDistance < 5
    ? maximumTemporalOverlapRatio * 22
    : minimumRegisterDistance < 9
      ? maximumTemporalOverlapRatio * 10
      : 0
  const fitScore = Math.max(
    0,
    Math.round(
      100 -
      duplicateRoleCount * 24 -
      maximumAttackSimilarity * 28 -
      closeRegisterPenalty,
    ),
  )
  const hasBlockingConflict = comparisons.some(
    (comparison) =>
      (comparison.duplicateRole && comparison.attack > 0.6) ||
      (comparison.attack > 0.85 && comparison.registerDistance < 5) ||
      (comparison.temporal > 0.8 && comparison.registerDistance < 3),
  )
  return {
    duplicateRoleCount,
    maximumAttackSimilarity:
      Math.round(maximumAttackSimilarity * 1000) / 1000,
    maximumTemporalOverlapRatio:
      Math.round(maximumTemporalOverlapRatio * 1000) / 1000,
    minimumRegisterDistance:
      Math.round(minimumRegisterDistance * 10) / 10,
    fitScore,
    hasBlockingConflict,
  }
}

export interface MelodyGap {
  startBeat: number
  endBeat: number
  durationBeats: number
}

export interface ReactiveRegisterBudget {
  preferredSide: "below" | "above"
  low: number
  high: number
  melodyLow: number
  melodyHigh: number
}

export interface MelodyActivityAnalysis {
  gaps: MelodyGap[]
  protectedMoments: ProtectedMoment[]
  registerBudget: ReactiveRegisterBudget
  /** セクション全体に許容するReactive Layerの最大発音数。 */
  maximumNoteCount: number
  melodyDensity: number
}

export interface HarmonicCounterRegion {
  startBeat: number
  endBeat: number
  chordSymbol: string
  chordTonePitchClasses: number[]
  guideTonePitchClasses: number[]
  tensionPitchClasses: number[]
  commonTonePitchClasses: number[]
  harmonicTension: number
  rootMotion: number
}

export interface MelodyPhraseAnalysis {
  startBeat: number
  endBeat: number
  direction: -1 | 0 | 1
  density: number
  motifPitches: number[]
  motifDurations: number[]
  motifOnsetGaps: number[]
  endingPitch: number
}

export interface CounterOpportunity extends MelodyGap {
  kind: CounterOpportunityKind
  needScore: number
  preferredMotion: "contrary" | "oblique" | "independent"
  sourceMotifPitches: number[]
  sourceMotifDurations: number[]
  sourceMotifOnsetGaps: number[]
  targetTonePitchClasses: number[]
  avoidAttackBeats: number[]
  rationale: string
}

export interface CounterContextAnalysis extends MelodyActivityAnalysis {
  harmonicRegions: HarmonicCounterRegion[]
  melodyPhrases: MelodyPhraseAnalysis[]
  opportunities: CounterOpportunity[]
  counterNeedScore: number
  silenceRecommended: boolean
}

function overlapDuration(
  a: Pick<MelodyNote, "startBeat" | "durationBeats">,
  b: Pick<MelodyNote, "startBeat" | "durationBeats">,
): number {
  return Math.max(
    0,
    Math.min(a.startBeat + a.durationBeats, b.startBeat + b.durationBeats) -
      Math.max(a.startBeat, b.startBeat),
  )
}
function mergeOccupiedRanges(notes: MelodyNote[], totalBeats: number): { start: number; end: number }[] {
  const ranges = notes
    .map((note) => ({
      start: Math.max(0, note.startBeat),
      end: Math.min(totalBeats, note.startBeat + note.durationBeats),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end + 0.0625) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

function findGaps(notes: MelodyNote[], totalBeats: number, minimumGapBeats: number): MelodyGap[] {
  const occupied = mergeOccupiedRanges(notes, totalBeats)
  const gaps: MelodyGap[] = []
  let cursor = 0
  for (const range of occupied) {
    if (range.start - cursor >= minimumGapBeats) {
      gaps.push({ startBeat: cursor, endBeat: range.start, durationBeats: range.start - cursor })
    }
    cursor = Math.max(cursor, range.end)
  }
  if (totalBeats - cursor >= minimumGapBeats) {
    gaps.push({ startBeat: cursor, endBeat: totalBeats, durationBeats: totalBeats - cursor })
  }
  return gaps
}

function protectedMoments(notes: MelodyNote[]): ProtectedMoment[] {
  if (notes.length === 0) return []
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const highestPitch = Math.max(...sorted.map((note) => note.pitch))
  const moments = new Map<string, ProtectedMoment>()
  const protect = (note: MelodyNote, reason: ProtectedMomentReason) => {
    const key = `${note.startBeat}:${note.durationBeats}:${note.pitch}`
    const existing = moments.get(key)
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
      return
    }
    moments.set(key, {
      startBeat: note.startBeat,
      endBeat: note.startBeat + note.durationBeats,
      pitch: note.pitch,
      reasons: [reason],
    })
  }

  sorted.forEach((note, index) => {
    if (note.pitch === highestPitch) protect(note, "highest-note")
    if (note.durationBeats >= 1.5) protect(note, "long-note")
    if (index > 0 && Math.abs(note.pitch - sorted[index - 1].pitch) >= 5) {
      protect(note, "leap-landing")
    }
    if (
      note.plannedResolution ||
      note.plannedToneRole === "appoggiatura" ||
      note.plannedToneRole === "suspension" ||
      note.plannedToneRole === "approach-tone"
    ) {
      protect(note, "non-chord-resolution")
    }
  })
  return [...moments.values()].sort((a, b) => a.startBeat - b.startBeat)
}

function registerBudget(notes: MelodyNote[]): ReactiveRegisterBudget {
  const melodyLow = notes.length > 0 ? Math.min(...notes.map((note) => note.pitch)) : 60
  const melodyHigh = notes.length > 0 ? Math.max(...notes.map((note) => note.pitch)) : 72
  const roomBelow = melodyLow - 36
  const roomAbove = 96 - melodyHigh
  if (roomBelow >= roomAbove) {
    return {
      preferredSide: "below",
      low: Math.max(36, melodyLow - 19),
      high: Math.max(36, melodyLow - 5),
      melodyLow,
      melodyHigh,
    }
  }
  return {
    preferredSide: "above",
    low: Math.min(96, melodyHigh + 5),
    high: Math.min(96, melodyHigh + 19),
    melodyLow,
    melodyHigh,
  }
}

/** Active Melodyから、Reactive Layerが使ってよい時間・音域・密度を抽出する。 */
export function analyzeMelodyActivity(
  melodyNotes: MelodyNote[],
  totalBeats: number,
  minimumGapBeats = 0.5,
): MelodyActivityAnalysis {
  const notes = [...melodyNotes].sort((a, b) => a.startBeat - b.startBeat)
  const occupied = notes.reduce(
    (sum, note) =>
      sum +
      Math.max(
        0,
        Math.min(totalBeats, note.startBeat + note.durationBeats) -
          Math.max(0, note.startBeat),
      ),
    0,
  )
  const melodyDensity = totalBeats > 0 ? Math.min(1, occupied / totalBeats) : 0
  const availableRatio = Math.max(0.15, 1 - melodyDensity)
  return {
    gaps: findGaps(notes, totalBeats, minimumGapBeats),
    protectedMoments: protectedMoments(notes),
    registerBudget: registerBudget(notes),
    maximumNoteCount: Math.max(2, Math.floor(totalBeats * availableRatio * 0.75)),
    melodyDensity,
  }
}

function normalizedPitchClass(pitch: number): number {
  return ((pitch % 12) + 12) % 12
}

function signedRootMotion(from: number, to: number): number {
  const upward = (to - from + 12) % 12
  return upward > 6 ? upward - 12 : upward
}

function analyzeHarmonyForCounter(chords: ChordEvent[]): HarmonicCounterRegion[] {
  const ordered = [...chords].sort((left, right) => left.startBeat - right.startBeat)
  return ordered.map((chord, index) => {
    const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    const nextChord = ordered[index + 1]
    const nextParsed = nextChord
      ? parseChordSymbol(nextChord.symbol, nextChord.bass ?? undefined)
      : null
    const chordTonePitchClasses = parsed?.tones.map((tone) => tone.pitchClass) ?? []
    const tensionPitchClasses = parsed?.tensions.map((tone) => tone.pitchClass) ?? []
    const guideTonePitchClasses = parsed
      ? [
          ...parsed.tones.filter(
            (tone) => tone.role === "third" || tone.role === "seventh",
          ),
          ...parsed.tensions,
        ].map((tone) => tone.pitchClass)
      : []
    const nextPitchClasses = new Set(
      nextParsed
        ? [...nextParsed.tones, ...nextParsed.tensions].map(
            (tone) => tone.pitchClass,
          )
        : chordTonePitchClasses,
    )
    return {
      startBeat: chord.startBeat,
      endBeat: chord.startBeat + chord.durationBeats,
      chordSymbol: chord.symbol,
      chordTonePitchClasses,
      guideTonePitchClasses,
      tensionPitchClasses,
      commonTonePitchClasses: chordTonePitchClasses.filter((pitchClass) =>
        nextPitchClasses.has(pitchClass),
      ),
      harmonicTension: Math.min(
        100,
        (parsed?.isDominant ? 36 : 0) +
          (parsed?.isDiminished ? 32 : 0) +
          tensionPitchClasses.length * 12 +
          (parsed?.isSus ? 12 : 0) +
          24,
      ),
      rootMotion:
        parsed && nextParsed
          ? signedRootMotion(parsed.rootPc, nextParsed.rootPc)
          : 0,
    }
  })
}

function analyzeMelodyPhrases(
  notes: MelodyNote[],
  totalBeats: number,
): MelodyPhraseAnalysis[] {
  const ordered = [...notes].sort((left, right) => left.startBeat - right.startBeat)
  if (ordered.length === 0) return []
  const groups: MelodyNote[][] = []
  for (const note of ordered) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    if (
      !group ||
      !previous ||
      note.startBeat - (previous.startBeat + previous.durationBeats) >= 0.75
    ) {
      groups.push([note])
    } else {
      group.push(note)
    }
  }
  return groups.map((group) => {
    const first = group[0]
    const last = group.at(-1)!
    const startBeat = first.startBeat
    const endBeat = Math.min(
      totalBeats,
      last.startBeat + last.durationBeats,
    )
    const sounded = group.reduce(
      (sum, note) => sum + note.durationBeats,
      0,
    )
    return {
      startBeat,
      endBeat,
      direction: Math.sign(last.pitch - first.pitch) as -1 | 0 | 1,
      density: Math.min(1, sounded / Math.max(0.25, endBeat - startBeat)),
      motifPitches: group.slice(-4).map((note) => note.pitch),
      motifDurations: group.slice(-4).map((note) => note.durationBeats),
      motifOnsetGaps: group
        .slice(-4)
        .slice(1)
        .map((note, index) =>
          note.startBeat - group.slice(-4)[index].startBeat,
        ),
      endingPitch: last.pitch,
    }
  })
}

function harmonicRegionAt(
  regions: HarmonicCounterRegion[],
  beat: number,
): HarmonicCounterRegion | undefined {
  return (
    regions.find(
      (region) => beat >= region.startBeat && beat < region.endBeat,
    ) ?? regions.at(-1)
  )
}

function targetPitchClassesForOpportunity(
  regions: HarmonicCounterRegion[],
  startBeat: number,
  endBeat: number,
): number[] {
  const start = harmonicRegionAt(regions, startBeat)
  const end = harmonicRegionAt(regions, Math.max(startBeat, endBeat - 0.01))
  const ordered = [
    ...(start?.commonTonePitchClasses ?? []),
    ...(end?.guideTonePitchClasses ?? []),
    ...(start?.guideTonePitchClasses ?? []),
    ...(end?.chordTonePitchClasses ?? []),
    ...(start?.tensionPitchClasses ?? []),
    ...(start?.chordTonePitchClasses ?? []),
  ]
  return [...new Set(ordered)].slice(0, 6)
}

/**
 * コード進行とActive Melodyを同じ時間軸で読み、Counterを置く理由・場所・
 * target toneを先に決める。Genreや候補番号には依存しない。
 */
export function analyzeCounterContext(
  melodyNotes: MelodyNote[],
  chords: ChordEvent[],
  totalBeats: number,
): CounterContextAnalysis {
  const activity = analyzeMelodyActivity(melodyNotes, totalBeats)
  const orderedNotes = [...melodyNotes].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const harmonicRegions = analyzeHarmonyForCounter(chords)
  const melodyPhrases = analyzeMelodyPhrases(orderedNotes, totalBeats)
  const phraseForBeat = (beat: number) =>
    [...melodyPhrases]
      .reverse()
      .find((phrase) => phrase.endBeat <= beat + 0.001) ?? melodyPhrases[0]
  const chordBoundaries = harmonicRegions.slice(1).map((region) => region.startBeat)
  const melodyAttacks = orderedNotes.map((note) => note.startBeat)

  const gapOpportunities: CounterOpportunity[] = activity.gaps.map((gap) => {
    const preceding = phraseForBeat(gap.startBeat)
    const boundary = chordBoundaries.find(
      (beat) => beat >= gap.startBeat && beat <= gap.endBeat,
    )
    const region = harmonicRegionAt(harmonicRegions, gap.startBeat)
    const isEnding = gap.endBeat >= totalBeats - 0.01
    const kind: CounterOpportunityKind = boundary
      ? "transition-support"
      : isEnding
        ? "continuation-needed"
        : (preceding?.motifPitches.length ?? 0) >= 2
          ? "answer-needed"
          : (region?.harmonicTension ?? 0) >= 58
            ? "tension-support"
            : "harmonic-colour-needed"
    const phraseDirection = preceding?.direction ?? 0
    const needScore = Math.min(
      100,
      52 +
        Math.min(22, gap.durationBeats * 9) +
        (boundary ? 12 : 0) +
        ((region?.harmonicTension ?? 0) >= 58 ? 8 : 0) -
        (isEnding && preceding?.density && preceding.density > 0.8 ? 8 : 0),
    )
    return {
      ...gap,
      kind,
      needScore,
      preferredMotion: phraseDirection === 0 ? "oblique" : "contrary",
      sourceMotifPitches: preceding?.motifPitches ?? [],
      sourceMotifDurations: preceding?.motifDurations ?? [],
      sourceMotifOnsetGaps: preceding?.motifOnsetGaps ?? [],
      targetTonePitchClasses: targetPitchClassesForOpportunity(
        harmonicRegions,
        gap.startBeat,
        gap.endBeat,
      ),
      avoidAttackBeats: melodyAttacks.filter(
        (beat) => beat >= gap.startBeat - 0.25 && beat <= gap.endBeat + 0.25,
      ),
      rationale: boundary
        ? "コード境界を含むメロディ休符を次の和声へ接続する"
        : isEnding
          ? "主旋律終端の余韻を次へ渡す"
          : "直前の旋律発言へ独立した応答を返す",
    }
  })

  const highestPitch = orderedNotes.length > 0
    ? Math.max(...orderedNotes.map((note) => note.pitch))
    : 0
  const sustainedOpportunities: CounterOpportunity[] = orderedNotes
    .filter(
      (note) =>
        note.durationBeats >= 1.75 &&
        note.pitch < highestPitch &&
        !note.plannedResolution,
    )
    .map((note) => {
      const startBeat = note.startBeat + Math.min(0.75, note.durationBeats * 0.4)
      const endBeat = Math.min(
        totalBeats,
        note.startBeat + note.durationBeats - 0.25,
      )
      const region = harmonicRegionAt(harmonicRegions, startBeat)
      return {
        startBeat,
        endBeat,
        durationBeats: endBeat - startBeat,
        kind:
          (region?.harmonicTension ?? 0) >= 58
            ? "tension-support" as const
            : "harmonic-colour-needed" as const,
        needScore: Math.min(
          92,
          54 + note.durationBeats * 7 + (region?.harmonicTension ?? 0) * 0.12,
        ),
        preferredMotion: "oblique" as const,
        sourceMotifPitches: [note.pitch],
        sourceMotifDurations: [note.durationBeats],
        sourceMotifOnsetGaps: [],
        targetTonePitchClasses: targetPitchClassesForOpportunity(
          harmonicRegions,
          startBeat,
          endBeat,
        ).filter((pitchClass) => pitchClass !== normalizedPitchClass(note.pitch)),
        avoidAttackBeats: melodyAttacks.filter(
          (beat) => beat >= startBeat - 0.25 && beat <= endBeat + 0.25,
        ),
        rationale: "主旋律の長音下で和声の内声を動かす",
      }
    })
    .filter((opportunity) => opportunity.durationBeats >= 0.75)

  const opportunities = [...gapOpportunities, ...sustainedOpportunities]
    .sort(
      (left, right) =>
        right.needScore - left.needScore || left.startBeat - right.startBeat,
    )
    .filter(
      (opportunity, index, all) =>
        all.findIndex(
          (other) =>
            Math.abs(other.startBeat - opportunity.startBeat) <= 0.125 &&
            Math.abs(other.endBeat - opportunity.endBeat) <= 0.125,
        ) === index,
    )
  const counterNeedScore = Math.round(
    Math.max(0, ...opportunities.map((opportunity) => opportunity.needScore)),
  )
  return {
    ...activity,
    harmonicRegions,
    melodyPhrases,
    opportunities,
    counterNeedScore,
    silenceRecommended:
      opportunities.length === 0 ||
      (activity.melodyDensity >= 0.88 && counterNeedScore < 72),
  }
}

function noteInsideGap(note: MelodyNote, gaps: MelodyGap[]): number {
  return Math.max(
    0,
    ...gaps.map((gap) =>
      Math.max(
        0,
        Math.min(note.startBeat + note.durationBeats, gap.endBeat) -
          Math.max(note.startBeat, gap.startBeat),
      ),
    ),
  )
}

export function assessReactiveLayerCollisions(
  melodyNotes: MelodyNote[],
  candidateNotes: MelodyNote[],
  analysis: MelodyActivityAnalysis,
): ReactiveLayerCollisionSummary {
  let samePitchOverlapBeats = 0
  let minorSecondOverlapBeats = 0
  let protectedMomentOverlapBeats = 0
  let voiceCrossingCount = 0
  let simultaneousAttackCount = 0
  let parallelLargeLeapCount = 0
  const melodyCenter =
    melodyNotes.length === 0
      ? 66
      : melodyNotes.reduce((sum, note) => sum + note.pitch, 0) /
        melodyNotes.length
  const candidateCenter =
    candidateNotes.length === 0
      ? melodyCenter
      : candidateNotes.reduce((sum, note) => sum + note.pitch, 0) /
        candidateNotes.length
  const candidateSide = candidateCenter < melodyCenter ? "below" : "above"

  for (const candidate of candidateNotes) {
    for (const melody of melodyNotes) {
      const overlap = overlapDuration(candidate, melody)
      if (overlap <= 0) continue
      const interval = Math.abs(candidate.pitch - melody.pitch)
      if (interval === 0) samePitchOverlapBeats += overlap
      if (interval === 1) minorSecondOverlapBeats += overlap
      if (Math.abs(candidate.startBeat - melody.startBeat) <= 0.08) simultaneousAttackCount++
      if (
        (candidateSide === "below" && candidate.pitch >= melody.pitch) ||
        (candidateSide === "above" && candidate.pitch <= melody.pitch)
      ) {
        voiceCrossingCount++
      }
    }
    for (const moment of analysis.protectedMoments) {
      const protectedEnd =
        moment.reasons.every(
          (reason) =>
            reason === "long-note" ||
            reason === "leap-landing",
        )
          ? Math.min(moment.endBeat, moment.startBeat + 0.5)
          : moment.endBeat
      protectedMomentOverlapBeats += Math.max(
        0,
        Math.min(candidate.startBeat + candidate.durationBeats, protectedEnd) -
          Math.max(candidate.startBeat, moment.startBeat),
      )
    }
  }

  const sortedMelody = [...melodyNotes].sort((a, b) => a.startBeat - b.startBeat)
  const sortedCandidate = [...candidateNotes].sort((a, b) => a.startBeat - b.startBeat)
  for (let candidateIndex = 1; candidateIndex < sortedCandidate.length; candidateIndex++) {
    const previousCandidate = sortedCandidate[candidateIndex - 1]
    const candidate = sortedCandidate[candidateIndex]
    const candidateLeap = candidate.pitch - previousCandidate.pitch
    if (Math.abs(candidateLeap) < 5) continue
    for (let melodyIndex = 1; melodyIndex < sortedMelody.length; melodyIndex++) {
      const previousMelody = sortedMelody[melodyIndex - 1]
      const melody = sortedMelody[melodyIndex]
      const melodyLeap = melody.pitch - previousMelody.pitch
      if (
        Math.abs(melodyLeap) >= 5 &&
        Math.sign(melodyLeap) === Math.sign(candidateLeap) &&
        Math.abs(melody.startBeat - candidate.startBeat) <= 0.5
      ) {
        parallelLargeLeapCount++
        break
      }
    }
  }

  return {
    samePitchOverlapBeats,
    minorSecondOverlapBeats,
    protectedMomentOverlapBeats,
    voiceCrossingCount,
    simultaneousAttackCount,
    parallelLargeLeapCount,
    hasBlockingCollision:
      samePitchOverlapBeats > 0.5 ||
      minorSecondOverlapBeats > 0.5 ||
      protectedMomentOverlapBeats > 1 ||
      voiceCrossingCount >= 3 ||
      parallelLargeLeapCount >= 2,
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/** 共通品質評価。Generator固有の音楽性は各Generator側の追加scoreで補う。 */
export function evaluateReactiveLayerQuality(
  melodyNotes: MelodyNote[],
  candidateNotes: MelodyNote[],
  analysis: MelodyActivityAnalysis,
  inputs: {
    harmonicFit?: number
    motifRelationship?: number
    sectionFit?: number
    transitionValue?: number
  } = {},
): { quality: ReactiveLayerQualityBreakdown; collisions: ReactiveLayerCollisionSummary } {
  const collisions = assessReactiveLayerCollisions(melodyNotes, candidateNotes, analysis)
  const totalDuration = candidateNotes.reduce((sum, note) => sum + note.durationBeats, 0)
  const durationInGaps = candidateNotes.reduce(
    (sum, note) => sum + noteInsideGap(note, analysis.gaps),
    0,
  )
  const averageRegisterDistance =
    candidateNotes.length === 0
      ? 0
      : candidateNotes.reduce((sum, note) => {
          const melodyCenter =
            analysis.registerBudget.melodyLow +
            (analysis.registerBudget.melodyHigh -
              analysis.registerBudget.melodyLow) /
              2
          const candidateCenter =
            candidateNotes.reduce(
              (candidateSum, candidate) =>
                candidateSum + candidate.pitch,
              0,
            ) / candidateNotes.length
          const candidateSide =
            candidateCenter < melodyCenter ? "below" : "above"
          const distance =
            candidateSide === "below"
              ? analysis.registerBudget.melodyLow - note.pitch
              : note.pitch - analysis.registerBudget.melodyHigh
          return sum + Math.max(0, distance)
        }, 0) / candidateNotes.length
  const melodyRespect = clampScore(
    100 -
      collisions.samePitchOverlapBeats * 35 -
      collisions.minorSecondOverlapBeats * 45 -
      collisions.protectedMomentOverlapBeats * 22 -
      collisions.voiceCrossingCount * 8 -
      (collisions.parallelLargeLeapCount ?? 0) * 12 -
      Math.max(0, candidateNotes.length - analysis.maximumNoteCount) * 7,
  )
  const gapUsage = totalDuration > 0 ? clampScore((durationInGaps / totalDuration) * 100) : 0
  const registerSeparation = clampScore(100 - Math.abs(averageRegisterDistance - 8) * 8)
  const harmonicFit = clampScore(inputs.harmonicFit ?? 75)
  const motifRelationship = clampScore(inputs.motifRelationship ?? 70)
  const sectionFit = clampScore(inputs.sectionFit ?? 75)
  const transitionValue = clampScore(inputs.transitionValue ?? 65)
  const overallQuality =
    melodyRespect * 0.3 +
    harmonicFit * 0.15 +
    gapUsage * 0.2 +
    registerSeparation * 0.12 +
    motifRelationship * 0.08 +
    sectionFit * 0.1 +
    transitionValue * 0.05
  return {
    quality: {
      melodyRespect,
      harmonicFit,
      gapUsage,
      registerSeparation,
      motifRelationship,
      sectionFit,
      transitionValue,
      overallQuality,
    },
    collisions,
  }
}

export function isReactiveLayerStale(
  project: ComposerProject,
  candidate: ReactiveLayerCandidate,
): boolean {
  if (candidate.kind === "decoration") return false
  return (
    project.sectionMelodyAssignments[candidate.sectionId] !==
    candidate.targetMelodyVariantId
  )
}

const RESOLUTION_REQUIRED_ROLES = new Set([
  "approach-tone",
  "passing-tone",
  "neighbor-tone",
  "appoggiatura",
  "suspension",
  "anticipation",
])

/** 意図的なtension-holdを除き、非和声音が保存済み計画どおり実音へ解決するか検証する。 */
export function unresolvedReactiveToneNoteIds(notes: MelodyNote[]): string[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  return sorted
    .filter((note) => {
      if (!note.plannedToneRole || !RESOLUTION_REQUIRED_ROLES.has(note.plannedToneRole)) {
        return false
      }
      const resolution = note.plannedResolution
      if (!resolution) return true
      const latestBeat = resolution.targetBeat + resolution.maximumDelayBeats
      return !sorted.some((target) => {
        const targetPc = ((target.pitch % 12) + 12) % 12
        return (
          target.id !== note.id &&
          target.startBeat >= resolution.targetBeat - 0.0625 &&
          target.startBeat <= latestBeat + 0.0625 &&
          targetPc === resolution.targetPitchClass
        )
      })
    })
    .map((note) => note.id)
}

/**
 * CounterとDecorationを同時採用するときの共通安全判定。
 * 個別候補が良くても、重ねた結果の短2度・同音・総密度が過剰なら採用を止める。
 */
export function evaluateReactiveLayerCompatibility(
  melodyNotes: MelodyNote[],
  candidates: ReactiveLayerCandidate[],
  totalBeats: number,
): ReactiveLayerCompatibility {
  const analysis = analyzeMelodyActivity(melodyNotes, totalBeats)
  const maximumNoteCount =
    analysis.maximumNoteCount + Math.max(3, Math.floor(totalBeats * 0.25))
  const combinedNoteCount = candidates.reduce(
    (sum, candidate) => sum + candidate.notes.length,
    0,
  )
  let samePitchOverlapBeats = 0
  let minorSecondOverlapBeats = 0
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex++) {
      for (const left of candidates[leftIndex].notes) {
        for (const right of candidates[rightIndex].notes) {
          const overlap = overlapDuration(left, right)
          if (overlap <= 0) continue
          const interval = Math.abs(left.pitch - right.pitch)
          if (interval === 0) samePitchOverlapBeats += overlap
          if (interval === 1) minorSecondOverlapBeats += overlap
        }
      }
    }
  }
  const unresolvedToneNoteIds = candidates.flatMap((candidate) =>
    unresolvedReactiveToneNoteIds(candidate.notes),
  )
  const reasons: string[] = []
  if (candidates.some((candidate) => candidate.collisions.hasBlockingCollision)) {
    reasons.push("Active MelodyとのBlocking Collisionがあります")
  }
  if (combinedNoteCount > maximumNoteCount) {
    reasons.push(
      `Counter / Decorationの総密度が上限を超えています(${combinedNoteCount}/${maximumNoteCount}音)`,
    )
  }
  if (samePitchOverlapBeats > 0.5) {
    reasons.push("Counter / Decoration間で同音が長時間重なっています")
  }
  if (minorSecondOverlapBeats > 0.5) {
    reasons.push("Counter / Decoration間で短2度が長時間重なっています")
  }
  if (unresolvedToneNoteIds.length > 0) {
    reasons.push("解決計画を満たさない非和声音があります")
  }
  return {
    combinedNoteCount,
    maximumNoteCount,
    samePitchOverlapBeats,
    minorSecondOverlapBeats,
    unresolvedToneNoteIds,
    hasBlockingConflict: reasons.length > 0,
    reasons,
  }
}
