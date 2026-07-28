import type { MelodyNote } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import type {
  ReactiveLayerCandidate,
  ReactiveLayerCollisionSummary,
  ReactiveLayerCompatibility,
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
