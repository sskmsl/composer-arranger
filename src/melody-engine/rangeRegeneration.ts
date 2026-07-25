import type {
  MelodyGeneratorProfile,
  MelodyNote,
  PhrasePlan,
  RangeRegenerationLocks,
} from "@/core/melody"
import { parseTimeSignature } from "@/core/section"
import { computeMelodyFeatures } from "./features"
import type { Density, GenerationParams, RangeSetting } from "./generationParams"
import type { HarmonicMapEntry } from "./harmonicMap"
import { CANDIDATE_SELECTION_CONFIG, PROFILE_MINIMUM_QUALITY, selectDiverseCandidates } from "./candidateSelection"
import { regenerateSelection } from "./regenerateSelection"
import { scoreCandidate } from "./scoring"

export interface RangeRegenerationCandidate {
  notes: MelodyNote[]
  candidatePoolIndex: number
  seed: number
  qualityScore: number
  profileFitScore: number
  plans: PhrasePlan[]
}

export interface RangeRegenerationResult {
  candidates: RangeRegenerationCandidate[]
  rejectedBelowQuality: number
  overConstrained: boolean
}

export interface GenerateRangeRegenerationInput {
  sourceNotes: MelodyNote[]
  phrasePlans: PhrasePlan[]
  lockedBars: number[]
  timeSignature: string
  startBeat: number
  endBeat: number
  totalBeats: number
  harmonicMap: HarmonicMapEntry[]
  range: RangeSetting
  params: GenerationParams
  density: Density
  profile: MelodyGeneratorProfile
  locks: RangeRegenerationLocks
  seed: number
}

function noteOverlaps(note: MelodyNote, start: number, end: number): boolean {
  return note.startBeat < end && note.startBeat + note.durationBeats > start
}

function proportionalIndex(index: number, targetLength: number, sourceLength: number): number {
  if (sourceLength <= 1 || targetLength <= 1) return 0
  return Math.min(sourceLength - 1, Math.round((index / (targetLength - 1)) * (sourceLength - 1)))
}

function applyDimensionLocks(
  sourceNotes: MelodyNote[],
  regenerated: MelodyNote[],
  startBeat: number,
  endBeat: number,
  locks: RangeRegenerationLocks,
  permanentlyProtectedIds: Set<string>,
): MelodyNote[] {
  const sourceInside = sourceNotes
    .filter((note) => noteOverlaps(note, startBeat, endBeat) && !permanentlyProtectedIds.has(note.id))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const generatedInside = regenerated
    .filter((note) => noteOverlaps(note, startBeat, endBeat) && !permanentlyProtectedIds.has(note.id))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const outsideAndProtected = regenerated.filter(
    (note) => !noteOverlaps(note, startBeat, endBeat) || permanentlyProtectedIds.has(note.id),
  )

  if ((locks.pitch || locks.motif) && locks.rhythm) {
    return [...outsideAndProtected, ...sourceInside].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  }

  if (locks.rhythm) {
    const rhythmLocked = sourceInside.map((source, index) => {
      const generated = generatedInside[proportionalIndex(index, sourceInside.length, generatedInside.length)]
      return generated
        ? {
            ...source,
            pitch: generated.pitch,
            velocity: generated.velocity,
            plannedToneRole: generated.plannedToneRole,
            plannedResolution: generated.plannedResolution,
          }
        : source
    })
    return [...outsideAndProtected, ...rhythmLocked].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  }

  if (locks.pitch || locks.motif) {
    const pitchLocked = generatedInside.map((generated, index) => {
      const source = sourceInside[proportionalIndex(index, generatedInside.length, sourceInside.length)]
      return source ? { ...generated, pitch: source.pitch } : generated
    })
    return [...outsideAndProtected, ...pitchLocked].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  }

  return regenerated
}

function protectedByElementLock(
  note: MelodyNote,
  locks: RangeRegenerationLocks,
  openingEndBeat: number,
  endingStartBeat: number,
): boolean {
  return (
    (locks.opening && note.startBeat < openingEndBeat) ||
    (locks.ending && note.startBeat >= endingStartBeat)
  )
}

function refreshPhrasePlans(plans: PhrasePlan[], notes: MelodyNote[]): PhrasePlan[] {
  return plans.map((plan) => {
    const phraseEnd = plan.phraseStartBeat + plan.phraseLengthBeats
    const phraseNotes = notes
      .filter((note) => note.startBeat >= plan.phraseStartBeat && note.startBeat < phraseEnd)
      .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
    if (phraseNotes.length === 0) return plan
    const climax = phraseNotes.reduce((highest, note) => (note.pitch > highest.pitch ? note : highest), phraseNotes[0])
    const restBeats = phraseNotes
      .slice(1)
      .filter((note, index) => note.startBeat - (phraseNotes[index].startBeat + phraseNotes[index].durationBeats) >= 0.25)
      .map((note) => note.startBeat)
    return { ...plan, climaxBeat: climax.startBeat, restBeats }
  })
}

export function generateRangeRegenerationCandidates(
  input: GenerateRangeRegenerationInput,
): RangeRegenerationResult {
  const startBeat = Math.max(0, Math.min(input.startBeat, input.totalBeats))
  const endBeat = Math.max(startBeat, Math.min(input.endBeat, input.totalBeats))
  const openingEndBeat = Math.min(
    input.totalBeats,
    input.phrasePlans[0]?.phraseStartBeat + input.phrasePlans[0]?.phraseLengthBeats || Math.min(8, input.totalBeats / 2),
  )
  const lastPlan = input.phrasePlans[input.phrasePlans.length - 1]
  const endingStartBeat = lastPlan?.phraseStartBeat ?? Math.max(0, input.totalBeats - 4)
  const { beatsPerBar } = parseTimeSignature(input.timeSignature)
  const lockedBarSet = new Set(input.lockedBars)
  const permanentlyProtectedIds = new Set(
    input.sourceNotes
      .filter(
        (note) =>
          note.locks.length > 0 ||
          lockedBarSet.has(Math.floor(note.startBeat / beatsPerBar) + 1) ||
          protectedByElementLock(note, input.locks, openingEndBeat, endingStartBeat),
      )
      .map((note) => note.id),
  )
  const protectedSource = input.sourceNotes.map((note) =>
    permanentlyProtectedIds.has(note.id) && note.locks.length === 0
      ? { ...note, locks: ["pitch" as const] }
      : note,
  )
  const sourceById = new Map(input.sourceNotes.map((note) => [note.id, note]))
  const overConstrained =
    (input.locks.pitch || input.locks.motif) &&
    input.locks.rhythm &&
    input.sourceNotes.some(
      (note) => noteOverlaps(note, startBeat, endBeat) && !permanentlyProtectedIds.has(note.id),
    )

  const pool: RangeRegenerationCandidate[] = []
  for (let index = 0; index < CANDIDATE_SELECTION_CONFIG.candidatePoolSize; index++) {
    const candidateSeed = input.seed + index * 7919
    const raw = regenerateSelection(
      protectedSource,
      input.lockedBars,
      input.timeSignature,
      startBeat,
      endBeat,
      input.harmonicMap,
      input.range,
      input.params,
      input.density,
      candidateSeed,
    )
    const cleaned = raw.map((note) => {
      const source = sourceById.get(note.id)
      return source ? { ...note, locks: source.locks } : note
    })
    const notes = applyDimensionLocks(
      input.sourceNotes,
      cleaned,
      startBeat,
      endBeat,
      input.locks,
      permanentlyProtectedIds,
    )
    const features = computeMelodyFeatures(notes, input.harmonicMap, 0, input.totalBeats)
    const qualityScore = scoreCandidate(features, input.params)
    pool.push({
      notes,
      candidatePoolIndex: index,
      seed: candidateSeed,
      qualityScore,
      profileFitScore: qualityScore,
      plans: refreshPhrasePlans(input.phrasePlans, notes),
    })
  }

  const selection = selectDiverseCandidates(
    pool,
    input.harmonicMap,
    PROFILE_MINIMUM_QUALITY[input.profile],
    CANDIDATE_SELECTION_CONFIG.finalCandidateCount,
  )
  return {
    candidates: selection.selected.map((item) => item.candidate),
    rejectedBelowQuality: selection.belowQualityFloor.length,
    overConstrained,
  }
}
