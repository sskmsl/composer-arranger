import type {
  MelodyNote,
  MelodyOpeningPlan,
  MelodySimilarityBreakdown,
  PhrasePlan,
  PlannedToneRole,
} from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { isChordTone, isTensionTone } from "@/core/chord"
import { pitchClass } from "@/core/note"
import { openingSimilarity } from "./openingIntent"

export const MELODY_SIMILARITY_WEIGHTS = {
  opening: 0.15,
  interval: 0.2,
  rhythm: 0.15,
  contour: 0.15,
  phrase: 0.1,
  climax: 0.1,
  cadence: 0.05,
  harmonicResponse: 0.1,
} as const

export interface MelodySimilarityFeatures {
  absolutePitches: number[]
  intervals: number[]
  contour: number[]
  repeatedPattern: number[]
  onsetIntervals: number[]
  durations: number[]
  restGaps: number[]
  densityCurve: number[]
  phraseLengths: number[]
  phraseBoundaries: number[]
  sustainBoundaries: number[]
  climaxPosition: number
  highestNotePosition: number
  cadenceIntervals: number[]
  cadenceDurations: number[]
  finalPitch: number
  harmonicResponses: string[]
  motifRecurrence: number[]
}

export interface MelodySimilarityCandidate {
  notes: MelodyNote[]
  plans: PhrasePlan[]
  openingPlan?: MelodyOpeningPlan
}

function sortedNotes(notes: MelodyNote[]): MelodyNote[] {
  return [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

function numericSequenceSimilarity(a: number[], b: number[], tolerance: number): number {
  const rows = a.length + 1
  const cols = b.length + 1
  if (rows === 1 && cols === 1) return 1
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) dp[i][0] = i
  for (let j = 0; j < cols; j++) dp[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const substitution = Math.min(1, Math.abs(a[i - 1] - b[j - 1]) / Math.max(tolerance, 1e-6))
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + substitution)
    }
  }
  return clamp01(1 - dp[a.length][b.length] / Math.max(a.length, b.length, 1))
}

function tokenSequenceSimilarity(a: string[], b: string[]): number {
  const vocabulary = new Map<string, number>()
  const encode = (value: string): number => {
    const existing = vocabulary.get(value)
    if (existing !== undefined) return existing
    const next = vocabulary.size
    vocabulary.set(value, next)
    return next
  }
  return numericSequenceSimilarity(a.map(encode), b.map(encode), 0.5)
}

function positionsOfPhraseBoundaries(plans: PhrasePlan[]): number[] {
  return plans.slice(1).map((p) => p.phraseStartBeat)
}

function densityCurve(notes: MelodyNote[], totalBeats: number): number[] {
  const binSize = 4
  const binCount = Math.max(1, Math.ceil(totalBeats / binSize))
  const bins = Array<number>(binCount).fill(0)
  for (const note of notes) bins[Math.min(binCount - 1, Math.floor(note.startBeat / binSize))]++
  const max = Math.max(...bins, 1)
  return bins.map((n) => n / max)
}

function sustainBoundaries(notes: MelodyNote[], harmonicMap: HarmonicMapEntry[]): number[] {
  return harmonicMap.slice(1).map((entry) => {
    const boundary = entry.chord.startBeat
    return notes.some((n) => n.startBeat < boundary && n.startBeat + n.durationBeats > boundary + 1e-6) ? 1 : 0
  })
}

function inferredHarmonicRole(note: MelodyNote, map: HarmonicMapEntry[]): PlannedToneRole {
  if (note.plannedToneRole) return note.plannedToneRole
  const entry = chordAtBeat(map, note.startBeat)
  if (!entry) return "unresolved-conflict"
  const pc = pitchClass(note.pitch)
  if (isChordTone(entry.parsed, pc)) return "chord-tone"
  if (isTensionTone(entry.parsed, pc)) return "tension-hold"
  return "unresolved-conflict"
}

function motifRecurrence(intervals: number[]): number[] {
  const cellLength = Math.min(4, Math.max(2, Math.floor(intervals.length / 4)))
  if (intervals.length < cellLength * 2) return []
  const motif = intervals.slice(0, cellLength)
  const recurrence: number[] = []
  for (let i = cellLength; i + cellLength <= intervals.length; i += cellLength) {
    recurrence.push(numericSequenceSimilarity(motif, intervals.slice(i, i + cellLength), 2))
  }
  return recurrence
}

export function extractMelodySimilarityFeatures(
  candidate: Pick<MelodySimilarityCandidate, "notes" | "plans">,
  harmonicMap: HarmonicMapEntry[],
): MelodySimilarityFeatures {
  const notes = sortedNotes(candidate.notes)
  const pitches = notes.map((n) => n.pitch)
  const intervals = pitches.slice(1).map((pitch, index) => pitch - pitches[index])
  const contour = intervals.map(Math.sign)
  const repeatedPattern = intervals.map((interval) => (interval === 0 ? 1 : 0))
  const onsetIntervals = notes.slice(1).map((note, index) => note.startBeat - notes[index].startBeat)
  const durations = notes.map((note) => note.durationBeats)
  const restGaps = notes.slice(1).map((note, index) => Math.max(0, note.startBeat - (notes[index].startBeat + notes[index].durationBeats)))
  const totalBeats = Math.max(
    ...candidate.plans.map((p) => p.phraseStartBeat + p.phraseLengthBeats),
    ...notes.map((n) => n.startBeat + n.durationBeats),
    1,
  )
  const highest = pitches.length ? Math.max(...pitches) : 0
  const highestIndex = pitches.indexOf(highest)
  const highestNotePosition = highestIndex >= 0 ? notes[highestIndex].startBeat / totalBeats : 0
  const plannedClimax = candidate.plans[0]?.climaxBeat ?? notes[highestIndex]?.startBeat ?? 0
  const cadenceNotes = notes.slice(-5)
  const cadencePitches = cadenceNotes.map((n) => n.pitch)

  return {
    absolutePitches: pitches,
    intervals,
    contour,
    repeatedPattern,
    onsetIntervals,
    durations,
    restGaps,
    densityCurve: densityCurve(notes, totalBeats),
    phraseLengths: candidate.plans.map((p) => p.phraseLengthBeats),
    phraseBoundaries: positionsOfPhraseBoundaries(candidate.plans),
    sustainBoundaries: sustainBoundaries(notes, harmonicMap),
    climaxPosition: plannedClimax / totalBeats,
    highestNotePosition,
    cadenceIntervals: cadencePitches.slice(1).map((pitch, index) => pitch - cadencePitches[index]),
    cadenceDurations: cadenceNotes.map((n) => n.durationBeats),
    finalPitch: pitches[pitches.length - 1] ?? 0,
    harmonicResponses: notes.map((note) => inferredHarmonicRole(note, harmonicMap)),
    motifRecurrence: motifRecurrence(intervals),
  }
}

export function melodySimilarity(
  a: MelodySimilarityCandidate,
  b: MelodySimilarityCandidate,
  harmonicMap: HarmonicMapEntry[],
): MelodySimilarityBreakdown {
  const fa = extractMelodySimilarityFeatures(a, harmonicMap)
  const fb = extractMelodySimilarityFeatures(b, harmonicMap)

  const opening = openingSimilarity(
    { notes: a.notes, plan: a.openingPlan },
    { notes: b.notes, plan: b.openingPlan },
  )
  const transpositionInvariant = numericSequenceSimilarity(fa.intervals, fb.intervals, 3)
  const absolutePitch = numericSequenceSimilarity(fa.absolutePitches, fb.absolutePitches, 7)
  const motif = numericSequenceSimilarity(fa.motifRecurrence, fb.motifRecurrence, 0.35)
  const repeated = numericSequenceSimilarity(fa.repeatedPattern, fb.repeatedPattern, 0.5)
  const interval = transpositionInvariant * 0.65 + absolutePitch * 0.15 + motif * 0.1 + repeated * 0.1

  const onset = numericSequenceSimilarity(fa.onsetIntervals, fb.onsetIntervals, 0.5)
  const duration = numericSequenceSimilarity(fa.durations, fb.durations, 0.5)
  const rests = numericSequenceSimilarity(fa.restGaps, fb.restGaps, 0.25)
  const density = numericSequenceSimilarity(fa.densityCurve, fb.densityCurve, 0.25)
  const rhythm = onset * 0.35 + duration * 0.3 + rests * 0.2 + density * 0.15

  const contour = numericSequenceSimilarity(fa.contour, fb.contour, 0.5)
  const phrase =
    numericSequenceSimilarity(fa.phraseLengths, fb.phraseLengths, 2) * 0.45 +
    numericSequenceSimilarity(fa.phraseBoundaries, fb.phraseBoundaries, 1) * 0.35 +
    numericSequenceSimilarity(fa.sustainBoundaries, fb.sustainBoundaries, 0.5) * 0.2
  const climax =
    (1 - Math.min(1, Math.abs(fa.climaxPosition - fb.climaxPosition) / 0.35)) * 0.45 +
    (1 - Math.min(1, Math.abs(fa.highestNotePosition - fb.highestNotePosition) / 0.35)) * 0.55
  const cadence =
    numericSequenceSimilarity(fa.cadenceIntervals, fb.cadenceIntervals, 2) * 0.55 +
    numericSequenceSimilarity(fa.cadenceDurations, fb.cadenceDurations, 0.5) * 0.25 +
    (1 - Math.min(1, Math.abs(fa.finalPitch - fb.finalPitch) / 12)) * 0.2
  const harmonic =
    tokenSequenceSimilarity(fa.harmonicResponses, fb.harmonicResponses) * 0.75 +
    numericSequenceSimilarity(fa.sustainBoundaries, fb.sustainBoundaries, 0.5) * 0.25

  const overall =
    opening * MELODY_SIMILARITY_WEIGHTS.opening +
    interval * MELODY_SIMILARITY_WEIGHTS.interval +
    rhythm * MELODY_SIMILARITY_WEIGHTS.rhythm +
    contour * MELODY_SIMILARITY_WEIGHTS.contour +
    phrase * MELODY_SIMILARITY_WEIGHTS.phrase +
    climax * MELODY_SIMILARITY_WEIGHTS.climax +
    cadence * MELODY_SIMILARITY_WEIGHTS.cadence +
    harmonic * MELODY_SIMILARITY_WEIGHTS.harmonicResponse

  return {
    openingSimilarity: clamp01(opening),
    intervalSimilarity: clamp01(interval),
    rhythmSimilarity: clamp01(rhythm),
    contourSimilarity: clamp01(contour),
    phraseSimilarity: clamp01(phrase),
    climaxSimilarity: clamp01(climax),
    cadenceSimilarity: clamp01(cadence),
    harmonicResponseSimilarity: clamp01(harmonic),
    overallSimilarity: clamp01(overall),
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
