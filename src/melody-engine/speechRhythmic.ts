/**
 * Speech-Rhythmic Generator Profile (Melody Candidate Diversity v1.2 §4)
 *
 * 生成順序: Rhythm Skeleton → Accent Map → Pitch Anchor → Pitch Assignment
 * (Rhythmicのパラメータ変更版として実装しない。音高より先にリズムと
 * アクセントを確定し、その後にピッチを割り当てる専用パイプライン)
 */
import type { SeededRandom } from "@/core/rng"
import type { MelodyNote, MelodyOpeningPlan, ProsodyPlan, ProsodySlot } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { chordTonePitchClasses } from "@/core/chord"
import { nearestAllowedPitch } from "./pitchUtils"
import { openingStartMidi } from "./openingIntent"
import type { RangeSetting } from "./generationParams"

/** 非対称フレーズ長の候補(小節を均等に割らない。1.5/2.5小節相当を含む) */
const PHRASE_UNIT_CANDIDATES = [6, 8, 10, 12]

const SHORT_DURATIONS = [0.25, 0.5, 0.5, 0.5, 0.75, 1]

export interface SpeechRhythmicPatternPlan {
  unitLengths: number[]
  pickupAmount: number
  syncopationAmount: number
  finalMelodicLift: number
}

function pickUnitLength(rng: SeededRandom, remaining: number, phraseAsymmetry: number): number {
  const candidates = PHRASE_UNIT_CANDIDATES.filter((c) => c <= remaining + 2)
  if (candidates.length === 0) return Math.min(remaining, 6)
  const asymmetric = candidates.filter((c) => c % 4 !== 0)
  const symmetric = candidates.filter((c) => c % 4 === 0)
  if (asymmetric.length > 0 && rng.chance(phraseAsymmetry)) return rng.pick(asymmetric)
  return rng.pick(symmetric.length > 0 ? symmetric : candidates)
}

/** Step 1: Rhythm Skeleton — 音高より先にオンセットのタイミングだけを決める */
function buildRhythmSkeleton(
  rng: SeededRandom,
  unitStart: number,
  unitLength: number,
  syncopationAmount: number,
  pickupAmount: number,
  opening?: MelodyOpeningPlan,
): { beat: number; duration: number }[] {
  const events: { beat: number; duration: number }[] = []
  let cursor = unitStart

  if (opening) {
    // 冒頭設計: 入りのタイミングと最初の音価を計画で固定する
    cursor = unitStart + opening.startBeatOffset
    let firstDur = opening.firstNoteDuration
    if (cursor + firstDur > unitStart + unitLength) firstDur = unitStart + unitLength - cursor
    if (firstDur >= 0.2) {
      events.push({ beat: cursor, duration: firstDur })
      cursor += firstDur
      // repeated-note入口は2音目も同じ音価で刻む
      if (opening.openingContour === "repeated-note" && cursor + firstDur <= unitStart + unitLength) {
        events.push({ beat: cursor, duration: firstDur })
        cursor += firstDur
      }
    }
  } else if (rng.chance(pickupAmount * 0.5)) {
    // 弱起: フレーズ先頭を半拍/1拍遅らせ、食い込みを作る
    cursor += rng.pick([0.5, 1])
  }

  while (cursor < unitStart + unitLength - 0.2) {
    // シンコペーション: オフビート開始を許容する(0.5拍だけ「遅らせる」方向のみ。
    // 前の音より手前へずらすと単旋律なのに重なってしまうため、正方向のみ許容する)
    const startsOffbeat = rng.chance(syncopationAmount * 0.4)
    const beat = startsOffbeat ? cursor + 0.5 : cursor

    let duration = rng.pick(SHORT_DURATIONS)
    if (beat + duration > unitStart + unitLength) duration = unitStart + unitLength - beat
    if (duration < 0.2) break

    events.push({ beat, duration })
    cursor = beat + duration

    // 発話の間: 短い休符でまとまりを作る
    if (rng.chance(0.18)) cursor += rng.pick([0.25, 0.5])
  }
  return events
}

/** Step 2: Accent Map — 周期的な強拍と、シンコペーション位置にアクセントを割り当てる */
function buildAccentMap(events: { beat: number; duration: number }[], unitStart: number): ("primary" | "secondary" | "none")[] {
  return events.map((e, i) => {
    const isOnBeat = Math.abs((e.beat - unitStart) % 1) < 0.05
    const isPhraseEdge = i === 0 || i === events.length - 1
    if (isPhraseEdge || (isOnBeat && (e.beat - unitStart) % 2 < 0.05)) return "primary"
    if (isOnBeat) return "secondary"
    return "none"
  })
}

/** Step 3: Pitch Anchor — コード区間ごとに1〜2個の主要ピッチクラスを決める */
function pitchAnchorsFor(entry: HarmonicMapEntry | undefined): number[] {
  if (!entry) return [0, 7]
  const tones = chordTonePitchClasses(entry.parsed)
  return [entry.parsed.rootPc, tones[Math.min(2, tones.length - 1)] ?? entry.parsed.rootPc]
}

/** Step 4: Pitch Assignment — 同音反復を基本に、アクセント位置とコード変化点だけ音高を動かす */
function assignPitches(
  rng: SeededRandom,
  events: { beat: number; duration: number }[],
  accents: ("primary" | "secondary" | "none")[],
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  repeatedNoteAmount: number,
  finalMelodicLift: number,
  opening?: MelodyOpeningPlan,
): number[] {
  // 冒頭設計がある場合は狭い音域帯を開始音の周辺に置く(Speech-Rhythmicの狭音域性を保ちつつ、
  // 計画したregisterで始められるようにする)。無い場合は従来どおりレンジ中央に置く。
  const narrowCenter = opening ? openingStartMidi(opening, range) : Math.round((range.low + range.high) / 2)
  const narrowRange = {
    low: Math.max(range.low, narrowCenter - 4),
    high: Math.min(range.high, narrowCenter + 4),
  }
  const pitches: number[] = []
  let prevPitch = Math.round((narrowRange.low + narrowRange.high) / 2)
  let prevChordIdx = -1

  events.forEach((e, i) => {
    // 冒頭設計: 最初の1音は計画した音域・開始音へ固定する(発話的な同音反復の起点になる)
    if (i === 0 && opening) {
      const startPitch = openingStartMidi(opening, range)
      pitches.push(startPitch)
      prevPitch = startPitch
      prevChordIdx = harmonicMap.indexOf(chordAtBeat(harmonicMap, e.beat) as HarmonicMapEntry)
      return
    }
    const entry = chordAtBeat(harmonicMap, e.beat)
    const chordIdx = harmonicMap.indexOf(entry as HarmonicMapEntry)
    const chordChanged = chordIdx !== prevChordIdx
    const isLast = i === events.length - 1
    const accent = accents[i]

    let pitch: number
    if (isLast && rng.chance(finalMelodicLift)) {
      // フレーズ末のみ音程幅を広げ、語りから歌唱へ移行する
      const anchors = pitchAnchorsFor(entry)
      pitch = nearestAllowedPitch(prevPitch + rng.pick([4, 5, 7]), anchors, range)
    } else if ((accent === "primary" || chordChanged) && !rng.chance(repeatedNoteAmount * 0.6)) {
      const anchors = pitchAnchorsFor(entry)
      pitch = nearestAllowedPitch(prevPitch, anchors, narrowRange)
    } else if (rng.chance(repeatedNoteAmount)) {
      pitch = prevPitch
    } else {
      pitch = nearestAllowedPitch(prevPitch + rng.jitter(), pitchAnchorsFor(entry), narrowRange)
    }

    pitches.push(pitch)
    prevPitch = pitch
    prevChordIdx = chordIdx
  })

  return pitches
}

export function generateSpeechRhythmicPattern(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  intensity: number,
  repeatedNoteAmount: number,
  syncopationAmount: number,
  pickupAmount: number,
  phraseAsymmetry: number,
  opening?: MelodyOpeningPlan,
): { notes: MelodyNote[]; prosodyPlan: ProsodyPlan; plan: SpeechRhythmicPatternPlan } {
  const finalMelodicLift = 0.4 + rng.next() * 0.3 * intensity
  const unitLengths: number[] = []
  const allEvents: { beat: number; duration: number }[] = []
  const allAccents: ("primary" | "secondary" | "none")[] = []

  let cursor = 0
  let firstUnit = true
  while (cursor < totalBeats - 1) {
    const unitLength =
      firstUnit && opening
        ? Math.min(Math.max(1, opening.openingPhraseLengthBeats), totalBeats - cursor)
        : pickUnitLength(rng, totalBeats - cursor, phraseAsymmetry)
    unitLengths.push(unitLength)
    // 冒頭設計は最初のフレーズ単位にのみ適用する
    const events = buildRhythmSkeleton(rng, cursor, unitLength, syncopationAmount, pickupAmount, firstUnit ? opening : undefined)
    const accents = buildAccentMap(events, cursor)
    allEvents.push(...events)
    allAccents.push(...accents)
    cursor += unitLength
    firstUnit = false
  }

  const pitches = assignPitches(rng, allEvents, allAccents, harmonicMap, range, repeatedNoteAmount, finalMelodicLift, opening)

  const notes: MelodyNote[] = allEvents
    .filter((e) => e.beat < totalBeats)
    .map((e, i) => ({
      id: crypto.randomUUID(),
      startBeat: e.beat,
      durationBeats: Math.min(e.duration, totalBeats - e.beat),
      pitch: pitches[i],
      velocity: 70 + rng.intBetween(0, 10),
      locks: [],
    }))
    .filter((n) => n.durationBeats > 0.05)

  const breathPositions: number[] = []
  let expected = 0
  for (const n of notes) {
    if (n.startBeat > expected + 0.2) breathPositions.push(expected)
    expected = n.startBeat + n.durationBeats
  }

  const syllableSlots: ProsodySlot[] = notes.map((n, i) => ({
    beat: n.startBeat,
    durationBeats: n.durationBeats,
    accent: allAccents[i] ?? "none",
  }))

  return { notes, prosodyPlan: { syllableSlots, breathPositions }, plan: { unitLengths, pickupAmount, syncopationAmount, finalMelodicLift } }
}
