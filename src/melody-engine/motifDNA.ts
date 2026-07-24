/**
 * Song Motif DNA(Producer-Level Integration Requirements: Cross-Section Coherence)
 *
 * 完全実装は今回のスコープ外だが、生成処理をProfileごとに完全分断せず、
 * セクション間でモチーフ情報を共有できる構造として最小限を用意する。
 */
import type { MelodyNote, SongMotifDNA } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { pitchClass } from "@/core/note"
import type { GenerationParams } from "./generationParams"

/** 既存(または他セクションで採用済みの)メロディからSong Motif DNAを抽出する */
export function extractMotifDNA(notes: MelodyNote[], harmonicMap: HarmonicMapEntry[]): SongMotifDNA | null {
  if (notes.length < 2) return null
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const pitches = sorted.map((n) => n.pitch)
  const intervals = pitches.slice(1).map((p, i) => p - pitches[i])

  const intervalCells = topByFrequency(intervals, 5)
  const rhythmCells = topByFrequency(
    sorted.map((n) => n.durationBeats),
    5,
  )

  const repeatedNoteTendency = intervals.filter((iv) => iv === 0).length / Math.max(1, intervals.length)

  let approachCount = 0
  for (let i = 1; i < sorted.length; i++) {
    const entry = chordAtBeat(harmonicMap, sorted[i].startBeat)
    if (!entry) continue
    const pc = pitchClass(sorted[i].pitch)
    const isChordTone = entry.parsed.tones.some((t) => t.pitchClass === pc)
    const stepIn = Math.abs(intervals[i - 1]) <= 2 && intervals[i - 1] !== 0
    if (isChordTone && stepIn) approachCount++
  }
  const approachNoteTendency = approachCount / Math.max(1, sorted.length - 1)

  const contourTendency = Math.max(-1, Math.min(1, (pitches[pitches.length - 1] - pitches[0]) / 12))

  const last = sorted[sorted.length - 1]
  const lastEntry = chordAtBeat(harmonicMap, last.startBeat)
  const phraseEndingTendency = lastEntry && pitchClass(last.pitch) === lastEntry.parsed.rootPc ? 0.2 : 0.8

  const rests: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].startBeat - (sorted[i].startBeat + sorted[i].durationBeats)
    if (gap > 0.2) rests.push(Math.round(gap * 4) / 4)
  }
  const characteristicRests = topByFrequency(rests, 3)

  const maxPitch = Math.max(...pitches)
  const climaxIdx = pitches.indexOf(maxPitch)
  const climaxDirection: SongMotifDNA["climaxDirection"] = climaxIdx < pitches.length / 2 ? "descending" : "ascending"

  return {
    intervalCells,
    rhythmCells,
    repeatedNoteTendency,
    approachNoteTendency,
    contourTendency,
    phraseEndingTendency,
    characteristicRests,
    climaxDirection,
  }
}

function topByFrequency(values: number[], count: number): number[] {
  const freq = new Map<number, number>()
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1)
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([v]) => v)
}

/** DNAを、他セクション生成時のGenerationParamsへ軽く反映する(強く上書きはしない) */
export function applyMotifDNA(params: GenerationParams, dna: SongMotifDNA | undefined, weight = 0.15): GenerationParams {
  if (!dna) return params
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const contourNudge = dna.contourTendency > 0 ? "ascending" : "descending"
  return {
    ...params,
    motifRepeatTarget: lerp(params.motifRepeatTarget, dna.repeatedNoteTendency, weight),
    endTensionBias: lerp(params.endTensionBias, dna.phraseEndingTendency, weight),
    contourWeights: {
      ...params.contourWeights,
      [contourNudge]: params.contourWeights[contourNudge] * (1 + weight),
    },
  }
}
