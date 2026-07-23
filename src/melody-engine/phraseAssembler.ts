import type { SeededRandom } from "@/core/rng"
import type { MelodyNote, PhrasePlan, PhraseContour } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import type { GenerationParams, RangeSetting, Density } from "./generationParams"
import type { MotifCore, MotifEvent } from "./motifCore"
import { generateRhythmMotif, generatePitchMotif } from "./motifCore"
import { applyDevelopmentOp, weightedDevelopmentOp } from "./motifDevelopment"
import { chordAtBeat } from "./harmonicMap"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { nearestAllowedPitch } from "./pitchUtils"

export function eventsLength(events: MotifEvent[]): number {
  if (events.length === 0) return 0
  const last = events[events.length - 1]
  return last.offsetBeats + last.durationBeats
}

function countEventsFittingNotes(events: MotifEvent[], maxLengthBeats: number): number {
  let noteCount = 0
  for (const e of events) {
    if (e.offsetBeats + e.durationBeats > maxLengthBeats) break
    if (!e.isRest) noteCount++
  }
  return Math.max(1, noteCount)
}

/** 生成済みピッチを、配置先の和声コンテキストへ再スナップする(輪郭は保ったまま) */
export function placeSegment(
  events: MotifEvent[],
  pitches: number[],
  segmentStartBeat: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  rng: SeededRandom,
): MelodyNote[] {
  const effectiveHigh = range.high - params.peakHeadroomSemitones
  const effectiveRange = { low: range.low, high: Math.max(range.low + 4, effectiveHigh) }
  const notes: MelodyNote[] = []
  let pitchIdx = 0
  for (const event of events) {
    if (event.isRest) continue
    const beat = segmentStartBeat + event.offsetBeats
    const entry = chordAtBeat(harmonicMap, beat)
    const chordTones = entry ? chordTonePitchClasses(entry.parsed) : [0, 4, 7]
    const usable = entry ? allUsablePitchClasses(entry.parsed) : chordTones
    const useTension = rng.chance(params.tensionUsageTarget * 0.6)
    const allowed = useTension ? usable : chordTones
    const raw = pitches[pitchIdx] ?? effectiveRange.low
    const snapped = nearestAllowedPitch(raw, allowed, effectiveRange)
    notes.push({
      id: crypto.randomUUID(),
      startBeat: beat,
      durationBeats: event.durationBeats,
      pitch: snapped,
      velocity: 76 + rng.intBetween(-4, 6),
      locks: [],
    })
    pitchIdx++
  }
  return notes
}

function contourFromParams(rng: SeededRandom, params: GenerationParams): PhraseContour {
  const contours = Object.keys(params.contourWeights) as PhraseContour[]
  const weights = contours.map((c) => params.contourWeights[c])
  return rng.weightedPick(contours, weights)
}

export interface PhraseResult {
  notes: MelodyNote[]
  plan: PhrasePlan
  firstMotifCore: MotifCore
}

export interface Segment {
  events: MotifEvent[]
  pitches: number[]
  startBeat: number
}

/**
 * firstEvents/firstPitchesを起点に、9.5の展開操作を繰り返してendBeatまで埋める。
 * Generate from Chords(セクション全体)とDevelop a Seed(続きを生成)の両方から使う。
 */
export function growSegments(
  rng: SeededRandom,
  firstEvents: MotifEvent[],
  firstPitches: number[],
  startCursor: number,
  endBeat: number,
  params: GenerationParams,
  isAnswerPhrase = false,
  includeFirst = true,
): Segment[] {
  const segments: Segment[] = []
  let cursor = startCursor
  if (includeFirst) {
    segments.push({ events: firstEvents, pitches: firstPitches, startBeat: cursor })
    cursor += eventsLength(firstEvents)
  }

  let guard = 0
  while (cursor < endBeat - 0.25 && guard < 12) {
    guard++
    const remaining = endBeat - cursor
    const op = weightedDevelopmentOp(rng, params.motifRepeatTarget, params.noveltyWeight, isAnswerPhrase && segments.length === 0)
    let dev = applyDevelopmentOp(op, { events: firstEvents, pitches: firstPitches }, rng)
    if (eventsLength(dev.events) > remaining) {
      const keep = countEventsFittingNotes(dev.events, remaining)
      dev = applyDevelopmentOp("truncation", dev, rng, keep)
    }
    if (dev.events.length === 0) break
    segments.push({ events: dev.events, pitches: dev.pitches, startBeat: cursor })
    cursor += eventsLength(dev.events)
  }
  return segments
}

/**
 * 9.2 Phrase Plan 〜 9.5 Motif Development をまとめ、1フレーズ分のノートを生成する。
 * motifCoreOverrideを渡すと、そのモチーフを起点に展開する(モチーフの回収・Develop a Seedで使用)。
 */
export function assemblePhrase(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  phraseStartBeat: number,
  phraseLengthBeats: number,
  range: RangeSetting,
  params: GenerationParams,
  density: Density,
  motifCoreOverride?: MotifCore,
  isAnswerPhrase = false,
): PhraseResult {
  const contour = contourFromParams(rng, params)

  let firstEvents: MotifEvent[]
  let firstPitches: number[]
  if (motifCoreOverride) {
    firstEvents = motifCoreOverride.events
    firstPitches = motifCoreOverride.pitches
  } else {
    firstEvents = generateRhythmMotif(rng, density, params)
    firstPitches = generatePitchMotif(rng, firstEvents, phraseStartBeat, harmonicMap, range, params)
  }
  const firstMotifCore: MotifCore = { events: firstEvents, pitches: firstPitches, lengthBeats: eventsLength(firstEvents) }

  const phraseEnd = phraseStartBeat + phraseLengthBeats
  const segments = growSegments(rng, firstEvents, firstPitches, phraseStartBeat, phraseEnd, params, isAnswerPhrase)

  const notes: MelodyNote[] = []
  for (const seg of segments) {
    notes.push(...placeSegment(seg.events, seg.pitches, seg.startBeat, harmonicMap, range, params, rng))
  }

  // クライマックス配置(9.2): climaxBiasに応じた対象区間の最高音を、フレーズ全体の頂点にする
  if (notes.length > 0) {
    const targetIdx =
      params.climaxBias === "early" ? 0 : params.climaxBias === "end" ? notes.length - 1 : Math.floor(notes.length * 0.7)
    const overallMax = Math.max(...notes.map((n) => n.pitch))
    const nearTarget = notes[Math.min(targetIdx, notes.length - 1)]
    if (nearTarget.pitch < overallMax) {
      const effectiveHigh = range.high - params.peakHeadroomSemitones
      const boosted = nearestAllowedPitch(nearTarget.pitch + 12, [nearTarget.pitch % 12], {
        low: range.low,
        high: Math.max(range.low + 4, effectiveHigh),
      })
      nearTarget.pitch = boosted
    }
  }

  const climaxNote = notes.reduce((a, b) => (b.pitch > a.pitch ? b : a), notes[0])
  const restBeats: number[] = []
  let expected = phraseStartBeat
  for (const n of notes) {
    if (n.startBeat > expected) restBeats.push(expected)
    expected = n.startBeat + n.durationBeats
  }

  const plan: PhrasePlan = {
    phraseStartBeat,
    phraseLengthBeats,
    climaxBeat: climaxNote?.startBeat ?? phraseStartBeat,
    contour,
    restBeats,
    endTension: params.endTensionBias,
  }

  return { notes, plan, firstMotifCore }
}
