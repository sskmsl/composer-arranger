import { SeededRandom } from "@/core/rng"
import type { MelodyNote } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import type { GenerationParams, RangeSetting } from "./generationParams"
import type { MotifCore, MotifEvent } from "./motifCore"
import { growSegments, placeSegment, eventsLength } from "./phraseAssembler"
import { applyDevelopmentOp } from "./motifDevelopment"
import { nearestAllowedPitch } from "./pitchUtils"
import { chordAtBeat } from "./harmonicMap"
import { chordTonePitchClasses } from "@/core/chord"

export type SeedOperation = "continue" | "variation-rhythm" | "variation-pitch" | "answer-phrase" | "expand" | "lift" | "restrain"

export function extractMotifCore(notes: MelodyNote[]): MotifCore {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const base = sorted[0]?.startBeat ?? 0
  const events: MotifEvent[] = []
  let cursor = base
  for (const n of sorted) {
    if (n.startBeat > cursor + 0.01) {
      events.push({ offsetBeats: cursor - base, durationBeats: n.startBeat - cursor, isRest: true })
    }
    events.push({ offsetBeats: n.startBeat - base, durationBeats: n.durationBeats, isRest: false })
    cursor = n.startBeat + n.durationBeats
  }
  return { events, pitches: sorted.map((n) => n.pitch), lengthBeats: cursor - base }
}

export interface IdentityMatch {
  contourMatch: number
  rhythmMatch: number
  startMatch: boolean
  preserved: boolean
}

/** 5.2 識別性の判定基準: 3項目のうち2項目以上で一致していれば識別性を保持しているとみなす */
export function evaluateIdentity(original: MelodyNote[], developed: MelodyNote[]): IdentityMatch {
  const a = [...original].sort((x, y) => x.startBeat - y.startBeat)
  const b = [...developed].sort((x, y) => x.startBeat - y.startBeat)
  const len = Math.min(a.length, b.length)

  let contourAgree = 0
  for (let i = 1; i < len; i++) {
    const da = Math.sign(a[i].pitch - a[i - 1].pitch)
    const db = Math.sign(b[i].pitch - b[i - 1].pitch)
    if (da === db) contourAgree++
  }
  const contourMatch = len > 1 ? contourAgree / (len - 1) : 1

  let rhythmAgree = 0
  for (let i = 0; i < len; i++) {
    if (Math.abs(a[i].durationBeats - b[i].durationBeats) < 0.05) rhythmAgree++
  }
  const rhythmMatch = len > 0 ? rhythmAgree / len : 1

  const startMatch = len > 0 && Math.abs(a[0].pitch - b[0].pitch) <= 1

  const highMatches = [contourMatch >= 0.7, rhythmMatch >= 0.7, startMatch].filter(Boolean).length
  return { contourMatch, rhythmMatch, startMatch, preserved: highMatches >= 2 }
}

/** Continue: 続きを生成する。入力モチーフ自体は一切変更しない */
export function seedContinue(
  seed: MelodyNote[],
  continuationBeats: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  seedValue: number,
): MelodyNote[] {
  const rng = new SeededRandom(seedValue)
  const core = extractMotifCore(seed)
  const seedEnd = Math.max(...seed.map((n) => n.startBeat + n.durationBeats))
  const segments = growSegments(rng, core.events, core.pitches, seedEnd, seedEnd + continuationBeats, params, false, false)
  const continuation = segments.flatMap((s) => placeSegment(s.events, s.pitches, s.startBeat, harmonicMap, range, params, rng))
  return [...seed, ...continuation]
}

/**
 * Expand: 2小節を4/8小節などへ発展させる(Continueのターゲット長指定版)。
 * targetTotalBeatsはSeed自体の長さ(モチーフの拍数)を指す。セクション先頭からの
 * 絶対位置ではないため、Seedの開始位置(seedStart)を差し引かずに使うと、セクション
 * 途中にあるSeedほど短くしか展開できない不具合になる。
 */
export function seedExpand(
  seed: MelodyNote[],
  targetTotalBeats: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  seedValue: number,
): MelodyNote[] {
  const seedStart = Math.min(...seed.map((n) => n.startBeat))
  const seedEnd = Math.max(...seed.map((n) => n.startBeat + n.durationBeats))
  const seedLength = seedEnd - seedStart
  return seedContinue(seed, Math.max(0, targetTotalBeats - seedLength), harmonicMap, range, params, seedValue)
}

/** Answer Phrase: 応答フレーズをモチーフの直後に生成する */
export function seedAnswerPhrase(
  seed: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  seedValue: number,
): MelodyNote[] {
  const rng = new SeededRandom(seedValue)
  const core = extractMotifCore(seed)
  const seedEnd = Math.max(...seed.map((n) => n.startBeat + n.durationBeats))
  const answered = applyDevelopmentOp("answerPhrase", core, rng)
  const segments = growSegments(rng, answered.events, answered.pitches, seedEnd, seedEnd + eventsLength(core.events), params, true, true)
  const answerNotes = segments.flatMap((s) => placeSegment(s.events, s.pitches, s.startBeat, harmonicMap, range, params, rng))
  return [...seed, ...answerNotes]
}

/** Variation: リズムまたは音程のどちらかだけを変奏する(同じ長さのまま置き換え) */
export function seedVariation(
  seed: MelodyNote[],
  mode: "rhythm" | "pitch",
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  seedValue: number,
): MelodyNote[] {
  const rng = new SeededRandom(seedValue)
  const core = extractMotifCore(seed)
  const seedStart = seed[0]?.startBeat ?? 0
  const seedLength = eventsLength(core.events)

  if (mode === "pitch") {
    const jittered = core.pitches.map((p) => p + (rng.chance(0.6) ? rng.jitter() * 2 : 0))
    const notes = placeSegment(core.events, jittered, seedStart, harmonicMap, range, params, rng)
    return notes
  }

  // rhythm: 変奏を試み、長さが元と一致すればそれを採用。ずれる場合は元の長さへ切り詰める
  for (let attempt = 0; attempt < 3; attempt++) {
    const varied = applyDevelopmentOp("rhythmicVariation", core, rng)
    if (Math.abs(eventsLength(varied.events) - seedLength) < 0.05) {
      return placeSegment(varied.events, varied.pitches, seedStart, harmonicMap, range, params, rng)
    }
  }
  return placeSegment(core.events, core.pitches, seedStart, harmonicMap, range, params, rng)
}

/** Lift: サビ向けに音域とエネルギーを上げる */
export function seedLift(seed: MelodyNote[], harmonicMap: HarmonicMapEntry[], range: RangeSetting): MelodyNote[] {
  const avg = seed.reduce((s, n) => s + n.pitch, 0) / seed.length
  const targetMid = range.high - 4
  const shift = Math.max(0, Math.min(12, Math.round(targetMid - avg)))
  return seed.map((n) => {
    const entry = chordAtBeat(harmonicMap, n.startBeat)
    const tones = entry ? chordTonePitchClasses(entry.parsed) : [n.pitch % 12]
    const raw = n.pitch + shift
    return { ...n, pitch: nearestAllowedPitch(raw, tones, range), velocity: Math.min(127, n.velocity + 10) }
  })
}

/** Restrain: Aメロ向けに音数と音域を抑える */
export function seedRestrain(seed: MelodyNote[], harmonicMap: HarmonicMapEntry[], range: RangeSetting): MelodyNote[] {
  const sorted = [...seed].sort((a, b) => a.startBeat - b.startBeat)
  const thinned: MelodyNote[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && i < sorted.length - 1 && i % 2 === 1 && sorted.length > 3) {
      // 弱起の経過音を間引き、直前ノートを延長する
      const prev = thinned[thinned.length - 1]
      if (prev) prev.durationBeats += sorted[i].durationBeats
      continue
    }
    thinned.push({ ...sorted[i] })
  }
  const mid = Math.round((range.low + range.high) / 2)
  return thinned.map((n) => {
    const entry = chordAtBeat(harmonicMap, n.startBeat)
    const tones = entry ? chordTonePitchClasses(entry.parsed) : [n.pitch % 12]
    const pulled = n.pitch + Math.sign(mid - n.pitch) * Math.min(2, Math.abs(mid - n.pitch) > 6 ? 3 : 0)
    return { ...n, pitch: nearestAllowedPitch(pulled, tones, range), velocity: Math.max(1, n.velocity - 8) }
  })
}
