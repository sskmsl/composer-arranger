import type { MelodyNote, PhraseContour } from "@/core/melody"

export interface DiversitySignature {
  rhythmKey: string
  contour: PhraseContour
  startPosition: number
  highestNote: number
  restKey: string
  landingPoint: number
  leapBucket: number
}

export function buildSignature(notes: MelodyNote[], contour: PhraseContour): DiversitySignature {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const rhythmKey = sorted.map((n) => n.durationBeats.toFixed(2)).join(",")
  const restKey = sorted.map((n) => Math.round(n.startBeat * 4)).join(",")
  const leaps = sorted.slice(1).map((n, i) => Math.abs(n.pitch - sorted[i].pitch))
  const avgLeap = leaps.length ? leaps.reduce((a, b) => a + b, 0) / leaps.length : 0
  return {
    rhythmKey,
    contour,
    startPosition: sorted[0]?.startBeat ?? 0,
    highestNote: Math.max(...sorted.map((n) => n.pitch), 0),
    restKey,
    landingPoint: sorted[sorted.length - 1]?.pitch ?? 0,
    leapBucket: Math.round(avgLeap / 2),
  }
}

/** 2つの候補が何項目で異なるか(9.7の判定に使う7項目のうち該当分) */
export function differenceCount(a: DiversitySignature, b: DiversitySignature): number {
  let count = 0
  if (a.rhythmKey !== b.rhythmKey) count++
  if (a.contour !== b.contour) count++
  if (Math.abs(a.startPosition - b.startPosition) > 0.4) count++
  if (Math.abs(a.highestNote - b.highestNote) >= 2) count++
  if (a.restKey !== b.restKey) count++
  if (Math.abs(a.landingPoint - b.landingPoint) >= 2) count++
  if (a.leapBucket !== b.leapBucket) count++
  return count
}

/** signatures[i]が他の全候補と2項目以上異なっていればtrue */
export function isDistinctFromAll(signatures: DiversitySignature[], index: number): boolean {
  for (let j = 0; j < signatures.length; j++) {
    if (j === index) continue
    if (differenceCount(signatures[index], signatures[j]) < 2) return false
  }
  return true
}

export function countDistinctCandidates(signatures: DiversitySignature[]): number {
  let n = 0
  for (let i = 0; i < signatures.length; i++) if (isDistinctFromAll(signatures, i)) n++
  return n
}
