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

/**
 * イベント列をmaxLengthBeatsに収まるよう切り詰める(拍単位で正確にクリップする)。
 * 休符・ノートを問わず、区間を越える最初のイベントで打ち切る。1音も収まらなければ空を返す
 * (以前はcountEventsFittingNotesがMath.max(1,...)で最低1音を強制していたため、
 * その1音がフレーズ/セクション終端をはみ出す不具合があった)。
 */
function clipEventsToLength(
  events: MotifEvent[],
  pitches: number[],
  maxLengthBeats: number,
): { events: MotifEvent[]; pitches: number[] } {
  const outEvents: MotifEvent[] = []
  const outPitches: number[] = []
  let pitchIdx = 0
  for (const e of events) {
    if (e.offsetBeats >= maxLengthBeats - 1e-6) break
    const clippedDuration = Math.min(e.durationBeats, maxLengthBeats - e.offsetBeats)
    if (clippedDuration <= 0.01) break
    outEvents.push({ ...e, durationBeats: clippedDuration })
    if (!e.isRest) {
      outPitches.push(pitches[pitchIdx])
      pitchIdx++
    }
  }
  return { events: outEvents, pitches: outPitches }
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

  // 区間(endBeat)を越える分は必ずここでクリップしてから積む。
  // 最初のモチーフ核自体がendBeatをはみ出す場合もここで防ぐ(9.5展開後の追加区間だけでなく
  // 最初の1区間もはみ出し得るため、区別せず同じ経路でクリップする)。
  const pushClipped = (events: MotifEvent[], pitches: number[]): boolean => {
    const remaining = endBeat - cursor
    if (remaining <= 0.01) return false
    const clipped = eventsLength(events) > remaining ? clipEventsToLength(events, pitches, remaining) : { events, pitches }
    if (clipped.events.length === 0) return false
    segments.push({ events: clipped.events, pitches: clipped.pitches, startBeat: cursor })
    cursor += eventsLength(clipped.events)
    return true
  }

  if (includeFirst) {
    pushClipped(firstEvents, firstPitches)
  }

  let guard = 0
  while (cursor < endBeat - 0.25 && guard < 12) {
    guard++
    const op = weightedDevelopmentOp(rng, params.motifRepeatTarget, params.noveltyWeight, isAnswerPhrase && segments.length === 0)
    const dev = applyDevelopmentOp(op, { events: firstEvents, pitches: firstPitches }, rng)
    if (!pushClipped(dev.events, dev.pitches)) break
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
