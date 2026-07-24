/** Melody Candidate Diversity v1.2 §6.2: Profile横断で比較できる追加メトリクス(すべて任意) */
import type { MelodyNote, AdvancedMelodyMetrics } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { pitchClass } from "@/core/note"

export function computeAdvancedMelodyMetrics(notes: MelodyNote[], harmonicMap: HarmonicMapEntry[]): AdvancedMelodyMetrics {
  if (notes.length < 2) return {}
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const pitches = sorted.map((n) => n.pitch)
  const absIntervals = pitches.slice(1).map((p, i) => Math.abs(p - pitches[i]))

  const stepwiseMotionRatio = absIntervals.filter((i) => i > 0 && i <= 2).length / Math.max(1, absIntervals.length)

  // appoggiatura proxy: 短い音価で隣接音へ跳び、直後に逆方向へ戻る「行って戻る」形
  let appoggiaturaCount = 0
  for (let i = 1; i < sorted.length - 1; i++) {
    const shortEnough = sorted[i].durationBeats <= 0.6
    const into = pitches[i] - pitches[i - 1]
    const out = pitches[i + 1] - pitches[i]
    if (shortEnough && Math.abs(into) <= 2 && into !== 0 && Math.sign(out) !== 0 && Math.sign(out) !== Math.sign(into)) {
      appoggiaturaCount++
    }
  }
  const appoggiaturaRatio = appoggiaturaCount / Math.max(1, sorted.length - 2)

  // delayed resolution proxy: フレーズ末(次音までの間が空く、または最終音)がルート以外
  let endingCount = 0
  let nonRootEndingCount = 0
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1]
    const gap = next ? next.startBeat - (sorted[i].startBeat + sorted[i].durationBeats) : Infinity
    if (gap > 0.3) {
      endingCount++
      const entry = chordAtBeat(harmonicMap, sorted[i].startBeat)
      if (entry && pitchClass(sorted[i].pitch) !== entry.parsed.rootPc) nonRootEndingCount++
    }
  }
  const delayedResolutionRatio = endingCount > 0 ? nonRootEndingCount / endingCount : 0

  const maxPitch = Math.max(...pitches)
  const climaxOccurrences = pitches.filter((p) => p === maxPitch).length
  const climaxUniqueness = 1 / climaxOccurrences

  const avgDuration = sorted.reduce((s, n) => s + n.durationBeats, 0) / sorted.length
  const phraseArcLength = Math.min(1, avgDuration / 2)

  const pickupRatio = sorted.filter((n) => Math.abs(n.startBeat - Math.round(n.startBeat)) > 0.2).length / sorted.length

  const segments: number[] = []
  let segStart = sorted[0].startBeat
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1]
    const gap = next ? next.startBeat - (sorted[i].startBeat + sorted[i].durationBeats) : Infinity
    if (gap > 0.3 || !next) {
      segments.push(sorted[i].startBeat + sorted[i].durationBeats - segStart)
      if (next) segStart = next.startBeat
    }
  }
  const segMean = segments.reduce((a, b) => a + b, 0) / Math.max(1, segments.length)
  const segVariance = segments.reduce((s, v) => s + (v - segMean) ** 2, 0) / Math.max(1, segments.length)
  const phraseAsymmetry = segMean > 0 ? Math.min(1, Math.sqrt(segVariance) / segMean) : 0

  const rangeSpan = Math.max(...pitches) - Math.min(...pitches)
  const speechContourAmount = Math.max(0, 1 - rangeSpan / 24)

  const finalMelodicLift = Math.min(1, Math.abs(pitches[pitches.length - 1] - pitches[pitches.length - 2]) / 7)

  return {
    stepwiseMotionRatio,
    appoggiaturaRatio,
    delayedResolutionRatio,
    climaxUniqueness,
    phraseArcLength,
    pickupRatio,
    phraseAsymmetry,
    speechContourAmount,
    finalMelodicLift,
  }
}
