import type { MelodyNote, MelodyFeatures } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { isChordTone, isTensionTone } from "@/core/chord"
import { pitchClass } from "@/core/note"

/** 3.3 客観的特徴量の算出。類似度スコアの代わりにユーザーへ提示する数値。 */
export function computeMelodyFeatures(
  notes: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  phraseStartBeat: number,
  phraseLengthBeats: number,
): MelodyFeatures {
  if (notes.length === 0) {
    return {
      rangeLow: 60,
      rangeHigh: 60,
      maxLeap: 0,
      avgLeap: 0,
      restRatio: 1,
      repeatedNoteRatio: 0,
      tensionUsageRatio: 0,
      chordToneUsageRatio: 0,
      syncopationRatio: 0,
      motifRepeatRatio: 0,
      peakPosition: 0,
      leapRecoveryRatio: 1,
    }
  }

  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const pitches = sorted.map((n) => n.pitch)

  const leaps: number[] = []
  const signedIntervals: number[] = []
  let repeated = 0
  for (let i = 1; i < pitches.length; i++) {
    const signed = pitches[i] - pitches[i - 1]
    const interval = Math.abs(signed)
    leaps.push(interval)
    signedIntervals.push(signed)
    if (interval === 0) repeated++
  }

  // Issue #64: 跳躍(5半音以上)の直後が反行かつ順次進行(3半音以内)で回収されているか
  const bigLeaps = signedIntervals
    .map((interval, index) => ({ interval, index }))
    .filter(({ interval }) => Math.abs(interval) >= 5)
  const recoveredLeaps = bigLeaps.filter(({ interval, index }) => {
    const next = signedIntervals[index + 1]
    return next !== undefined && Math.sign(next) === -Math.sign(interval) && Math.abs(next) <= 3
  })
  const leapRecoveryRatio = bigLeaps.length > 0 ? recoveredLeaps.length / bigLeaps.length : 1

  const soundedBeats = sorted.reduce((sum, n) => sum + n.durationBeats, 0)
  const restRatio = Math.max(0, Math.min(1, 1 - soundedBeats / Math.max(phraseLengthBeats, 0.01)))

  let tensionCount = 0
  let chordToneCount = 0
  let syncopated = 0
  for (const n of sorted) {
    const entry: HarmonicMapEntry | undefined = chordAtBeat(harmonicMap, n.startBeat)
    if (entry) {
      const pc = pitchClass(n.pitch)
      if (isChordTone(entry.parsed, pc)) chordToneCount++
      else if (isTensionTone(entry.parsed, pc)) tensionCount++
    }
    const offsetInBeat = n.startBeat - Math.floor(n.startBeat)
    if (Math.abs(offsetInBeat - 0.5) < 0.01) syncopated++
  }

  const highest = Math.max(...pitches)
  const peakIdx = pitches.indexOf(highest)
  const peakNote = sorted[peakIdx]
  const peakPosition = phraseLengthBeats > 0 ? (peakNote.startBeat - phraseStartBeat) / phraseLengthBeats : 0

  // モチーフ反復率: 先頭2〜4音の音程輪郭パターンが、以降にどれだけ再出現するか
  const motifLen = Math.min(4, Math.max(2, Math.floor(pitches.length / 2)))
  const motifShape = directionShape(pitches.slice(0, motifLen))
  let matches = 0
  let windows = 0
  for (let i = motifLen; i + motifLen <= pitches.length; i += motifLen) {
    windows++
    const shape = directionShape(pitches.slice(i, i + motifLen))
    if (shapesSimilar(motifShape, shape)) matches++
  }
  const motifRepeatRatio = windows > 0 ? matches / windows : 0

  return {
    rangeLow: Math.min(...pitches),
    rangeHigh: highest,
    maxLeap: leaps.length ? Math.max(...leaps) : 0,
    avgLeap: leaps.length ? leaps.reduce((a, b) => a + b, 0) / leaps.length : 0,
    restRatio,
    repeatedNoteRatio: pitches.length > 1 ? repeated / (pitches.length - 1) : 0,
    tensionUsageRatio: tensionCount / sorted.length,
    chordToneUsageRatio: chordToneCount / sorted.length,
    syncopationRatio: syncopated / sorted.length,
    motifRepeatRatio,
    peakPosition: Math.max(0, Math.min(1, peakPosition)),
    leapRecoveryRatio,
  }
}

function directionShape(pitches: number[]): number[] {
  const shape: number[] = []
  for (let i = 1; i < pitches.length; i++) {
    const d = pitches[i] - pitches[i - 1]
    shape.push(d > 0 ? 1 : d < 0 ? -1 : 0)
  }
  return shape
}

function shapesSimilar(a: number[], b: number[]): boolean {
  const len = Math.min(a.length, b.length)
  if (len === 0) return false
  let match = 0
  for (let i = 0; i < len; i++) if (a[i] === b[i]) match++
  return match / len >= 0.6
}
