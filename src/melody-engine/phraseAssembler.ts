import type { SeededRandom } from "@/core/rng"
import type {
  CandidateMelodyDNA,
  MelodyNote,
  MelodyOpeningPlan,
  PhrasePlan,
  PhraseContour,
  PitchCorrectionDiagnostic,
  PlannedResolution,
  PlannedToneDiagnostic,
  PlannedToneRole,
} from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import type { GenerationParams, RangeSetting, Density } from "./generationParams"
import type { MotifCore, MotifEvent } from "./motifCore"
import { generateRhythmMotif, generatePitchMotif } from "./motifCore"
import { applyDevelopmentOp, weightedDevelopmentOp } from "./motifDevelopment"
import { chordAtBeat } from "./harmonicMap"
import { allUsablePitchClasses, chordTonePitchClasses, isChordTone, isTensionTone } from "@/core/chord"
import { nearestAllowedPitch, withKeyBias } from "./pitchUtils"
import { pitchClass } from "@/core/note"

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

export interface PlacementDiagnostics {
  plannedTones: PlannedToneDiagnostic[]
  changedPitchCount: number
  corrections: PitchCorrectionDiagnostic[]
}

export function createPlacementDiagnostics(): PlacementDiagnostics {
  return { plannedTones: [], changedPitchCount: 0, corrections: [] }
}

export interface PlaceSegmentContext {
  /** 最初のSegmentだけに渡し、Opening suspension等を明示的な役割として保持する。 */
  opening?: MelodyOpeningPlan
  diagnostics?: PlacementDiagnostics
}

interface SoundingEvent {
  event: MotifEvent
  rawPitch: number
  beat: number
}

interface ClassifiedTone {
  role: PlannedToneRole
  resolution?: PlannedResolution
}

function normalizedPc(pitch: number): number {
  return ((Math.round(pitch) % 12) + 12) % 12
}

/** 同じpitch classを保ったオクターブ移動だけでレンジへ入れる。無理な場合だけhard clampする。 */
function fitPlannedPitchToRange(rawPitch: number, range: RangeSetting): { pitch: number; reason?: "range-octave-adjustment" | "midi-range-clamp" } {
  const midiLow = Math.max(0, range.low)
  const midiHigh = Math.min(127, range.high)
  let pitch = Math.round(rawPitch)
  while (pitch < midiLow && pitch + 12 <= midiHigh) pitch += 12
  while (pitch > midiHigh && pitch - 12 >= midiLow) pitch -= 12
  if (pitch >= midiLow && pitch <= midiHigh) {
    return { pitch, reason: pitch === Math.round(rawPitch) ? undefined : "range-octave-adjustment" }
  }
  return { pitch: Math.max(midiLow, Math.min(midiHigh, pitch)), reason: "midi-range-clamp" }
}

function isStrongBeat(beat: number, entry: HarmonicMapEntry | undefined): boolean {
  return Math.abs(beat - Math.round(beat)) < 0.01 || Math.abs(beat - (entry?.chord.startBeat ?? Number.NaN)) < 0.01
}

function resolutionTo(
  targetPitch: number,
  targetBeat: number,
  currentBeat: number,
  maximumDelayBeats = 2,
): PlannedResolution | undefined {
  const delay = targetBeat - currentBeat
  if (delay <= 0 || delay > maximumDelayBeats + 1e-6) return undefined
  return { targetPitchClass: normalizedPc(targetPitch), targetBeat, maximumDelayBeats }
}

/**
 * 変換後(sequence/inversion等)のplanned pitch列を、実際の配置先和声と前後関係から分類する。
 * 役割が説明できる音は保持し、unresolved-conflictだけを補正対象にする。
 */
function classifyTone(
  sounding: SoundingEvent[],
  index: number,
  harmonicMap: HarmonicMapEntry[],
  opening?: MelodyOpeningPlan,
): ClassifiedTone {
  const current = sounding[index]
  const previous = sounding[index - 1]
  const next = sounding[index + 1]
  const entry = chordAtBeat(harmonicMap, current.beat)
  if (!entry) return { role: "chord-tone" }

  const pc = normalizedPc(current.rawPitch)
  const currentIsChordTone = isChordTone(entry.parsed, pc)
  const entryIndex = harmonicMap.indexOf(entry)
  const nextEntry = harmonicMap[entryIndex + 1]
  const boundaryBeat = entry.chord.startBeat + entry.chord.durationBeats
  const crossesBoundary = Boolean(nextEntry && current.beat < boundaryBeat && current.beat + current.event.durationBeats > boundaryBeat + 1e-6)
  const nextPc = next ? normalizedPc(next.rawPitch) : null

  if (nextEntry && crossesBoundary) {
    if (currentIsChordTone && isChordTone(nextEntry.parsed, pc)) return { role: "common-tone" }
    if (currentIsChordTone && !isChordTone(nextEntry.parsed, pc) && next && next.beat >= boundaryBeat && isChordTone(nextEntry.parsed, nextPc!)) {
      const resolution = resolutionTo(next.rawPitch, next.beat, boundaryBeat, 2)
      if (resolution && Math.abs(next.rawPitch - current.rawPitch) <= 2) return { role: "suspension", resolution }
    }
    if (!currentIsChordTone && isChordTone(nextEntry.parsed, pc)) {
      return {
        role: "anticipation",
        resolution: resolutionTo(current.rawPitch, boundaryBeat, current.beat, Math.max(2, boundaryBeat - current.beat)),
      }
    }
  }

  if (
    index === 0 &&
    opening?.openingContour === "suspension-entry" &&
    next &&
    isChordTone(entry.parsed, nextPc!)
  ) {
    const resolution = resolutionTo(next.rawPitch, next.beat, current.beat, 2)
    if (resolution && Math.abs(next.rawPitch - current.rawPitch) <= 2) return { role: "suspension", resolution }
  }

  if (currentIsChordTone) return { role: "chord-tone" }

  if (
    nextEntry &&
    current.beat <= boundaryBeat &&
    boundaryBeat - current.beat <= 1 &&
    isChordTone(nextEntry.parsed, pc)
  ) {
    return {
      role: "anticipation",
      resolution: resolutionTo(current.rawPitch, boundaryBeat, current.beat, 1),
    }
  }

  if (isTensionTone(entry.parsed, pc)) return { role: "tension-hold" }

  if (next && isChordTone(entry.parsed, nextPc!)) {
    const resolution = resolutionTo(next.rawPitch, next.beat, current.beat, 2)
    const step = Math.abs(next.rawPitch - current.rawPitch)
    if (resolution && step <= 2) {
      if (previous && normalizedPc(previous.rawPitch) === nextPc && Math.abs(previous.rawPitch - current.rawPitch) <= 2) {
        return { role: "neighbor-tone", resolution }
      }
      if (previous) {
        const into = current.rawPitch - previous.rawPitch
        const out = next.rawPitch - current.rawPitch
        if (Math.sign(into) === Math.sign(out) && Math.abs(into) <= 2) return { role: "passing-tone", resolution }
      }
      return { role: isStrongBeat(current.beat, entry) ? "appoggiatura" : "approach-tone", resolution }
    }
  }

  return { role: "unresolved-conflict" }
}

function contourPreservingCorrection(
  rawPitch: number,
  allowedPitchClasses: readonly number[],
  range: RangeSetting,
  previousPitch?: number,
  nextPitch?: number,
): number {
  const candidates: number[] = []
  for (let pitch = Math.max(0, range.low); pitch <= Math.min(127, range.high); pitch++) {
    if (allowedPitchClasses.includes(pitchClass(pitch))) candidates.push(pitch)
  }
  if (candidates.length === 0) return nearestAllowedPitch(rawPitch, allowedPitchClasses, range)
  const plannedIn = previousPitch === undefined ? 0 : Math.sign(rawPitch - previousPitch)
  const plannedOut = nextPitch === undefined ? 0 : Math.sign(nextPitch - rawPitch)
  return candidates.reduce((best, candidate) => {
    const directionPenalty =
      (previousPitch !== undefined && plannedIn !== 0 && Math.sign(candidate - previousPitch) !== plannedIn ? 3 : 0) +
      (nextPitch !== undefined && plannedOut !== 0 && Math.sign(nextPitch - candidate) !== plannedOut ? 3 : 0)
    const score = Math.abs(candidate - rawPitch) + directionPenalty
    const bestDirectionPenalty =
      (previousPitch !== undefined && plannedIn !== 0 && Math.sign(best - previousPitch) !== plannedIn ? 3 : 0) +
      (nextPitch !== undefined && plannedOut !== 0 && Math.sign(nextPitch - best) !== plannedOut ? 3 : 0)
    const bestScore = Math.abs(best - rawPitch) + bestDirectionPenalty
    return score < bestScore ? candidate : best
  }, candidates[0])
}

/**
 * 生成済みplanned pitchを原則保持し、説明できない強い衝突または範囲違反だけを局所補正する。
 * 旧実装のように全音を確率的にコードトーンへ再スナップしない。
 */
export function placeSegment(
  events: MotifEvent[],
  pitches: number[],
  segmentStartBeat: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  rng: SeededRandom,
  context: PlaceSegmentContext = {},
): MelodyNote[] {
  const effectiveHigh = range.high - params.peakHeadroomSemitones
  const effectiveRange = { low: range.low, high: Math.max(range.low + 4, effectiveHigh) }
  const notes: MelodyNote[] = []
  const sounding: SoundingEvent[] = []
  let rawIndex = 0
  for (const event of events) {
    if (event.isRest) continue
    sounding.push({ event, rawPitch: pitches[rawIndex] ?? effectiveRange.low, beat: segmentStartBeat + event.offsetBeats })
    rawIndex++
  }

  sounding.forEach((item, index) => {
    const beat = item.beat
    const entry = chordAtBeat(harmonicMap, beat)
    const chordTones = entry ? chordTonePitchClasses(entry.parsed) : [0, 4, 7]
    const classified = classifyTone(sounding, index, harmonicMap, context.opening)
    const fitted = fitPlannedPitchToRange(item.rawPitch, effectiveRange)
    let placedPitch = fitted.pitch
    let correctionReason: PitchCorrectionDiagnostic["reason"] | undefined = fitted.reason

    if (classified.role === "unresolved-conflict") {
      const usable = entry ? withKeyBias(allUsablePitchClasses(entry.parsed), params.keyScalePitchClasses) : chordTones
      const allowed = isStrongBeat(beat, entry) ? chordTones : usable
      placedPitch = contourPreservingCorrection(
        fitted.pitch,
        allowed,
        effectiveRange,
        notes[notes.length - 1]?.pitch,
        sounding[index + 1]?.rawPitch,
      )
      correctionReason = isStrongBeat(beat, entry) ? "unresolved-strong-beat-conflict" : "unresolved-harmonic-conflict"
    }

    const changed = placedPitch !== Math.round(item.rawPitch)
    if (changed && context.diagnostics) context.diagnostics.changedPitchCount++
    if (changed && correctionReason) {
      context.diagnostics?.corrections.push({
        beat,
        rawPitch: item.rawPitch,
        placedPitch,
        role: classified.role,
        reason: correctionReason,
      })
    }
    context.diagnostics?.plannedTones.push({
      beat,
      durationBeats: item.event.durationBeats,
      rawPitch: item.rawPitch,
      placedPitch,
      role: classified.role,
      resolution: classified.resolution,
    })

    // 旧実装のuseTension抽選と同じ1回分を消費し、配置方式の変更が後続フレーズの乱数列まで
    // 不必要にずらさない。値そのものはplanned toneの保持判定には使わない。
    rng.next()
    notes.push({
      id: crypto.randomUUID(),
      startBeat: beat,
      durationBeats: item.event.durationBeats,
      pitch: placedPitch,
      velocity: 76 + rng.intBetween(-4, 6),
      locks: [],
      plannedToneRole: classified.role,
      plannedResolution: classified.resolution,
    })
  })
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
  developmentStrategy?: CandidateMelodyDNA["developmentStrategy"],
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
    const op = weightedDevelopmentOp(
      rng,
      params.motifRepeatTarget,
      params.noveltyWeight,
      isAnswerPhrase && segments.length === 0,
      developmentStrategy,
      segments.length,
    )
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
  opening?: MelodyOpeningPlan,
  placementDiagnostics?: PlacementDiagnostics,
  candidateDNA?: CandidateMelodyDNA,
): PhraseResult {
  const contour = contourFromParams(rng, params)

  let firstEvents: MotifEvent[]
  let firstPitches: number[]
  if (motifCoreOverride) {
    firstEvents = motifCoreOverride.events
    firstPitches = motifCoreOverride.pitches
  } else {
    firstEvents = generateRhythmMotif(rng, density, params, opening)
    firstPitches = generatePitchMotif(rng, firstEvents, phraseStartBeat, harmonicMap, range, params, opening)
  }
  const firstMotifCore: MotifCore = { events: firstEvents, pitches: firstPitches, lengthBeats: eventsLength(firstEvents) }

  const phraseEnd = phraseStartBeat + phraseLengthBeats
  const segments = growSegments(
    rng,
    firstEvents,
    firstPitches,
    phraseStartBeat,
    phraseEnd,
    params,
    isAnswerPhrase,
    true,
    candidateDNA?.developmentStrategy,
  )

  const notes: MelodyNote[] = []
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const seg = segments[segmentIndex]
    notes.push(
      ...placeSegment(seg.events, seg.pitches, seg.startBeat, harmonicMap, range, params, rng, {
        opening: segmentIndex === 0 ? opening : undefined,
        diagnostics: placementDiagnostics,
      }),
    )
  }

  // クライマックス配置(9.2): climaxBiasに応じた対象区間の最高音を、フレーズ全体の頂点にする
  if (notes.length > 0) {
    const targetFraction =
      candidateDNA?.climaxPlan.targetFraction ??
      (params.climaxBias === "early" ? 0 : params.climaxBias === "end" ? 1 : 0.7)
    const targetBeat = phraseStartBeat + phraseLengthBeats * targetFraction
    const targetIdx = notes.reduce(
      (best, note, index) =>
        Math.abs(note.startBeat - targetBeat) < Math.abs(notes[best].startBeat - targetBeat) ? index : best,
      0,
    )
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
