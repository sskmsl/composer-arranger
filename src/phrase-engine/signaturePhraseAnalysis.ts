import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import type {
  SignatureCompositionContext,
  SignatureOpportunityKind,
  SignatureTargetTone,
} from "@/core/signaturePhrase"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"

export interface SignatureOpportunityAnalysis {
  kind: SignatureOpportunityKind
  score: number
  rationale: string
  preferredRegisterRelation: "below" | "above" | "independent"
}

export interface SignaturePhraseContextAnalysis {
  source: "chords-and-melody" | "chords-only"
  opportunities: SignatureOpportunityAnalysis[]
  targetTonePath: SignatureTargetTone[]
  referenceMotifIntervals: number[]
  referenceRhythmGaps: number[]
  referenceRegisterCenter?: number
  referenceDensity: number
  harmonicTensionCurve: number[]
}

function mean(values: readonly number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function motifWindowScore(notes: readonly MelodyNote[]): number {
  if (notes.length < 3) return 0
  const intervals = notes.slice(1).map(
    (note, index) => note.pitch - notes[index].pitch,
  )
  const gaps = notes.slice(1).map(
    (note, index) => note.startBeat - notes[index].startBeat,
  )
  const directions = intervals.map(Math.sign).filter(Boolean)
  const directionChanges = directions.slice(1).filter(
    (direction, index) => direction !== directions[index],
  ).length
  return (
    new Set(intervals).size * 8 +
    new Set(gaps.map((gap) => Math.round(gap * 4))).size * 6 +
    Math.min(14, Math.max(...intervals.map(Math.abs), 0) * 2) +
    directionChanges * 5 -
    (intervals.every((interval) => interval === 0) ? 30 : 0)
  )
}

function extractReferenceMotif(notes: readonly MelodyNote[]): MelodyNote[] {
  const ordered = [...notes].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const windows: MelodyNote[][] = []
  for (let size = 3; size <= 5; size++) {
    for (let index = 0; index + size <= ordered.length; index++) {
      const window = ordered.slice(index, index + size)
      if (
        window.at(-1)!.startBeat - window[0].startBeat <= 8 &&
        window.slice(1).every(
          (note, noteIndex) =>
            note.startBeat -
              (window[noteIndex].startBeat +
                window[noteIndex].durationBeats) <=
            2,
        )
      ) {
        windows.push(window)
      }
    }
  }
  return windows.sort(
    (left, right) => motifWindowScore(right) - motifWindowScore(left),
  )[0] ?? ordered.slice(0, 5)
}

function buildTargetTonePath(chords: readonly ChordEvent[]): SignatureTargetTone[] {
  const map = buildHarmonicMap([...chords])
  return map.map((entry, index) => {
    const next = map[index + 1]
    const currentPitchClasses = new Set(
      [...entry.parsed.tones, ...entry.parsed.tensions].map(
        (tone) => tone.pitchClass,
      ),
    )
    const nextPitchClasses = new Set(
      next
        ? [...next.parsed.tones, ...next.parsed.tensions].map(
            (tone) => tone.pitchClass,
          )
        : entry.resolutionPitchClasses,
    )
    const common = [...currentPitchClasses].filter((value) =>
      nextPitchClasses.has(value),
    )
    const guides = entry.parsed.tones
      .filter((tone) => tone.role === "third" || tone.role === "seventh")
      .map((tone) => tone.pitchClass)
    const tensions = entry.parsed.tensions.map((tone) => tone.pitchClass)
    const isFinal = index === map.length - 1
    const pitchClasses = isFinal
      ? [entry.parsed.rootPc, ...guides]
      : common.length > 0
        ? [...common, ...guides]
        : tensions.length > 0
          ? [...tensions, ...guides]
          : [...guides, ...entry.resolutionPitchClasses]
    return {
      beat: entry.chord.startBeat,
      pitchClasses: [...new Set(pitchClasses)].slice(0, 4),
      function: isFinal
        ? "arrival" as const
        : common.length > 0
          ? "common-tone" as const
          : tensions.length > 0
            ? "tension" as const
            : "guide-tone" as const,
    }
  })
}

/**
 * コードの長期的な色とActive MelodyのIdentity Cellを解析し、Signatureが
 * 「何を予告し、何を対比し、どこへ向かうか」を音符生成より先に決める。
 */
export function analyzeSignaturePhraseContext(input: {
  chords: ChordEvent[]
  referenceMelody?: MelodyNote[]
  totalBeats: number
}): SignaturePhraseContextAnalysis {
  const reference = [...(input.referenceMelody ?? [])]
    .filter(
      (note) =>
        note.startBeat >= 0 &&
        note.startBeat < input.totalBeats,
    )
    .sort((left, right) => left.startBeat - right.startBeat)
  const motif = extractReferenceMotif(reference)
  const referenceMotifIntervals = motif.slice(1).map(
    (note, index) => note.pitch - motif[index].pitch,
  )
  const referenceRhythmGaps = motif.slice(1).map(
    (note, index) =>
      Math.round((note.startBeat - motif[index].startBeat) * 4) / 4,
  )
  const sounded = reference.reduce(
    (sum, note) => sum + note.durationBeats,
    0,
  )
  const referenceDensity = Math.min(
    1,
    sounded / Math.max(1, input.totalBeats),
  )
  const referenceRegisterCenter = reference.length > 0
    ? mean(reference.map((note) => note.pitch))
    : undefined
  const map = buildHarmonicMap(input.chords)
  const harmonicTensionCurve = map.map((entry) =>
    Math.min(
      100,
      24 +
        entry.parsed.tensions.length * 14 +
        (entry.parsed.isDominant ? 30 : 0) +
        (entry.parsed.isDiminished ? 28 : 0) +
        (entry.parsed.isSus ? 10 : 0) -
        entry.commonTonesWithNext * 3,
    ),
  )
  const averageCommonTones = mean(
    map.map((entry) => entry.commonTonesWithNext),
  )
  const opportunities: SignatureOpportunityAnalysis[] = [
    {
      kind: "harmonic-identity",
      score: Math.min(94, 70 + averageCommonTones * 6),
      rationale: "コード間の共通音とguide toneを曲の識別音として定着させる",
      preferredRegisterRelation: "independent",
    },
    {
      kind: "tension-premonition",
      score: Math.min(94, 58 + Math.max(0, ...harmonicTensionCurve) * 0.36),
      rationale: "後続和声の緊張音を先に提示し、曲の行き先を予告する",
      preferredRegisterRelation: "above",
    },
    {
      kind: "section-threshold",
      score: 66,
      rationale: "セクション冒頭に固有のリズムと余白を置き、入口を成立させる",
      preferredRegisterRelation: "independent",
    },
  ]
  if (motif.length >= 3) {
    opportunities.push(
      {
        kind: "motif-foreshadowing",
        score: Math.min(98, 82 + motifWindowScore(motif) * 0.18),
        rationale: "Active MelodyのIdentity Cellを反転・圧縮し、複製せず予告する",
        preferredRegisterRelation: "independent",
      },
      {
        kind: "rhythmic-counter-identity",
        score: Math.min(
          94,
          72 + referenceDensity * 12 + new Set(referenceRhythmGaps).size * 3,
        ),
        rationale: "Active Melodyとは異なるAccent Mapで、曲を識別できる第二の顔を作る",
        preferredRegisterRelation: "independent",
      },
      {
        kind: "register-contrast",
        score: 72,
        rationale: "Active Melodyと異なる音域から始め、後の旋律が入る空間を残す",
        preferredRegisterRelation:
          (referenceRegisterCenter ?? 66) >= 66 ? "below" : "above",
      },
    )
  }
  return {
    source: motif.length >= 3 ? "chords-and-melody" : "chords-only",
    opportunities: opportunities.sort(
      (left, right) => right.score - left.score,
    ),
    targetTonePath: buildTargetTonePath(input.chords),
    referenceMotifIntervals,
    referenceRhythmGaps,
    referenceRegisterCenter,
    referenceDensity,
    harmonicTensionCurve,
  }
}

export function signatureCompositionContextFor(
  analysis: SignaturePhraseContextAnalysis,
  poolIndex: number,
  seed: number,
): SignatureCompositionContext {
  const opportunity =
    analysis.opportunities[
      (poolIndex + ((seed >>> 16) % analysis.opportunities.length)) %
        analysis.opportunities.length
    ]
  return {
    source: analysis.source,
    opportunity: opportunity.kind,
    opportunityScore: opportunity.score,
    rationale: opportunity.rationale,
    targetTonePath: analysis.targetTonePath,
    referenceMotifIntervals: analysis.referenceMotifIntervals,
    referenceRhythmGaps: analysis.referenceRhythmGaps,
    referenceRegisterCenter: analysis.referenceRegisterCenter,
    preferredRegisterRelation: opportunity.preferredRegisterRelation,
  }
}
