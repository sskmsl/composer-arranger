import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote, SongMotifDNA } from "@/core/melody"
import type { ChordEvent, SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import {
  AUTO_CONTENT_CANDIDATES,
  type ContentQualityBreakdown,
  type ContentSelectionDiagnostics,
  type ContentStructureFeatures,
  type ResolvedLeadContent,
  type SectionContentPlan,
} from "@/core/sectionContent"
import { contentSimilarity } from "./contentStructure"

export interface ContentQualityCandidate {
  content: ResolvedLeadContent
  plan: SectionContentPlan
  notes: MelodyNote[]
  features: ContentStructureFeatures
  problems: string[]
  quality?: ContentQualityBreakdown
  selection?: ContentSelectionDiagnostics
}

export interface ContentQualityContext {
  sectionRole: SectionRole
  songProfile: SongProfileId
  chords: ChordEvent[]
  totalBeats: number
  nextSectionRole?: SectionRole
  nextSectionFirstChord?: string
  songMotifDNA?: SongMotifDNA
}

const QUALITY_FLOOR: Record<ResolvedLeadContent, number> = {
  melody: 58,
  motif: 62,
  ostinato: 60,
  drone: 60,
  none: 55,
}

const PROFILE_PREFERENCES: Record<SongProfileId, Record<ResolvedLeadContent, number>> = {
  "dark-romantic": { melody: 88, motif: 92, ostinato: 70, drone: 86, none: 68 },
  "cinematic-french-pop": { melody: 90, motif: 86, ostinato: 76, drone: 82, none: 66 },
  "minimal-tension": { melody: 76, motif: 84, ostinato: 72, drone: 94, none: 90 },
  "dramatic-synth-pop": { melody: 90, motif: 82, ostinato: 92, drone: 68, none: 58 },
  "original-custom": { melody: 82, motif: 82, ostinato: 80, drone: 78, none: 72 },
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function sectionFit(content: ResolvedLeadContent, role: SectionRole): number {
  const allowed = AUTO_CONTENT_CANDIDATES[role] ?? ["melody"]
  const index = allowed.indexOf(content)
  if (index < 0) return 20
  return Math.max(60, 100 - index * 8)
}

function harmonicInterest(
  candidate: ContentQualityCandidate,
  chords: ChordEvent[],
): number {
  if (candidate.content === "none") return 72
  if (candidate.notes.length === 0) return 0
  const parsed = chords
    .map((chord) => parseChordSymbol(chord.symbol, chord.bass ?? undefined))
    .filter((chord): chord is NonNullable<typeof chord> => Boolean(chord))
  const colorPitchClasses = new Set(
    parsed.flatMap((chord) => [
      ...chord.tensions.map((tone) => tone.pitchClass),
      ...chord.tones
        .filter((tone) => tone.role === "seventh" || tone.role === "sixth")
        .map((tone) => tone.pitchClass),
    ]),
  )
  const colorUse =
    candidate.notes.filter((note) =>
      colorPitchClasses.has(((note.pitch % 12) + 12) % 12),
    ).length / candidate.notes.length
  const heldAcrossBoundary = candidate.notes.filter((note) =>
    chords.slice(1).some(
      (chord) =>
        note.startBeat < chord.startBeat &&
        note.startBeat + note.durationBeats > chord.startBeat,
    ),
  ).length
  const boundaryValue =
    candidate.plan.chordBoundaryResponse === "hold-through" ||
    candidate.plan.chordBoundaryResponse === "anticipate"
      ? 12
      : 4
  return clampScore(
    64 + colorUse * 20 + Math.min(12, heldAcrossBoundary * 4) + boundaryValue,
  )
}

function structuralClarity(candidate: ContentQualityCandidate): number {
  if (candidate.problems.length > 0) return Math.max(0, 45 - candidate.problems.length * 15)
  const features = candidate.features
  if (candidate.content === "motif") {
    return clampScore(70 + features.recurrenceStrength * 15 + features.restRatio * 20)
  }
  if (candidate.content === "ostinato") {
    return clampScore(60 + features.recurrenceStrength * 38)
  }
  if (candidate.content === "drone") {
    return clampScore(65 + features.sustainRatio * 35 - Math.max(0, features.pitchClassCardinality - 1) * 5)
  }
  if (candidate.content === "none") return candidate.notes.length === 0 ? 94 : 30
  return clampScore(78 + (1 - Math.abs(features.restRatio - 0.2)) * 18)
}

function nextSectionExpectation(
  candidate: ContentQualityCandidate,
  nextRole?: SectionRole,
  nextChord?: string,
): number {
  if (!nextRole) {
    return candidate.content === "drone" || candidate.content === "none" ? 82 : 72
  }
  let score = 68
  if (candidate.plan.pickupBeats > 0) score += 18
  if (candidate.plan.chordBoundaryResponse === "anticipate") score += 14
  if (
    (nextRole === "chorus" || nextRole === "grand-chorus") &&
    (candidate.content === "motif" || candidate.content === "none")
  ) {
    score += 10
  }
  if (nextRole === "outro" && (candidate.content === "drone" || candidate.content === "none")) {
    score += 12
  }
  if (nextChord && candidate.plan.pitchVocabulary.length > 0) {
    const parsed = parseChordSymbol(nextChord)
    if (
      parsed &&
      candidate.plan.pitchVocabulary.some((pc) =>
        parsed.tones.some((tone) => tone.pitchClass === pc),
      )
    ) {
      score += 6
    }
  }
  return clampScore(score)
}

function motifRelationship(
  candidate: ContentQualityCandidate,
  dna?: SongMotifDNA,
): number {
  if (!dna || dna.intervalCells.length === 0) return 72
  const intervals = candidate.features.intervalSequence
  if (intervals.length === 0) return candidate.content === "none" ? 68 : 55
  const comparable = intervals.slice(0, Math.min(6, intervals.length))
  const matched = comparable.filter((interval) =>
    dna.intervalCells.some((cell) => Math.abs(Math.abs(cell) - Math.abs(interval)) <= 1),
  ).length
  const contour =
    candidate.features.contour.length === 0
      ? 0
      : candidate.features.contour.reduce((sum, value) => sum + value, 0) /
        candidate.features.contour.length
  const contourFit = 1 - Math.min(1, Math.abs(contour - dna.contourTendency) / 2)
  return clampScore(48 + (matched / comparable.length) * 34 + contourFit * 18)
}

function spaceQuality(candidate: ContentQualityCandidate): number {
  const targetRest: Record<ResolvedLeadContent, number> = {
    melody: 0.2,
    motif: 0.45,
    ostinato: 0.08,
    drone: 0,
    none: 1,
  }
  const restFit = 1 - Math.min(1, Math.abs(candidate.features.restRatio - targetRest[candidate.content]))
  const meaningfulEntry =
    candidate.plan.entryOffsetBeats > 0 || candidate.plan.pickupBeats > 0 ? 8 : 0
  return clampScore(45 + restFit * 47 + meaningfulEntry)
}

export function evaluateContentQuality(
  candidate: ContentQualityCandidate,
  context: ContentQualityContext,
): ContentQualityBreakdown {
  const scores = {
    sectionFit: sectionFit(candidate.content, context.sectionRole),
    songProfileFit: PROFILE_PREFERENCES[context.songProfile][candidate.content],
    harmonicInterest: harmonicInterest(candidate, context.chords),
    structuralClarity: structuralClarity(candidate),
    nextSectionExpectation: nextSectionExpectation(
      candidate,
      context.nextSectionRole,
      context.nextSectionFirstChord,
    ),
    motifRelationship: motifRelationship(candidate, context.songMotifDNA),
    spaceQuality: spaceQuality(candidate),
  }
  const overallQuality =
    scores.sectionFit * 0.2 +
    scores.songProfileFit * 0.15 +
    scores.harmonicInterest * 0.15 +
    scores.structuralClarity * 0.2 +
    scores.nextSectionExpectation * 0.1 +
    scores.motifRelationship * 0.08 +
    scores.spaceQuality * 0.12
  return { ...scores, overallQuality }
}

export function contentQualityFloor(content: ResolvedLeadContent): number {
  return QUALITY_FLOOR[content]
}

type SelectedContentCandidate<T extends ContentQualityCandidate> = T & {
  selection: ContentSelectionDiagnostics
}

function withSelection<T extends ContentQualityCandidate>(
  candidate: T,
  patch: Partial<ContentSelectionDiagnostics>,
): SelectedContentCandidate<T> {
  return {
    ...candidate,
    selection: {
      qualityFloor: QUALITY_FLOOR[candidate.content],
      selectionScore: null,
      selected: false,
      reason:
        candidate.problems.length > 0
          ? "structural-validation-failed"
          : (candidate.quality?.overallQuality ?? 0) < QUALITY_FLOOR[candidate.content]
            ? "below-quality-floor"
            : "not-selected",
      similarityToSelected: [],
      ...patch,
    },
  }
}

/** 品質65% + 既選択候補との差35%。妥当な場合はContent種別も2種類以上にする。 */
export function selectQualityDiverseContent<T extends ContentQualityCandidate & { seed: number }>(
  candidates: T[],
  finalCount = 3,
): {
  selected: SelectedContentCandidate<T>[]
  evaluatedPool: SelectedContentCandidate<T>[]
} {
  let pool = candidates.map((candidate) =>
    withSelection(candidate, {
      qualityFloor: QUALITY_FLOOR[candidate.content],
    }),
  )
  const eligible = pool
    .filter(
      (candidate) =>
        candidate.problems.length === 0 &&
        (candidate.quality?.overallQuality ?? 0) >= QUALITY_FLOOR[candidate.content],
    )
    .sort(
      (a, b) =>
        (b.quality?.overallQuality ?? 0) - (a.quality?.overallQuality ?? 0),
    )
  const selected: SelectedContentCandidate<T>[] = []
  while (selected.length < finalCount && selected.length < eligible.length) {
    if (selected.length === 0) {
      const first = withSelection(eligible[0], {
        selected: true,
        selectionScore: eligible[0].quality?.overallQuality ?? 0,
        reason: "highest-quality",
      })
      selected.push(first)
      continue
    }
    const remaining = eligible.filter(
      (candidate) => !selected.some((item) => item.seed === candidate.seed),
    )
    const scored = remaining
      .map((candidate) => {
        const similarities = selected.map(
          (item) => contentSimilarity(candidate.features, item.features).overall,
        )
        const minimumDiversity = 1 - Math.max(...similarities)
        const contentBonus = selected.every((item) => item.content !== candidate.content) ? 8 : 0
        const score =
          (candidate.quality?.overallQuality ?? 0) * 0.65 +
          minimumDiversity * 100 * 0.35 +
          contentBonus
        return { candidate, similarities, score }
      })
      .sort((a, b) => b.score - a.score)[0]
    if (!scored) break
    selected.push(
      withSelection(scored.candidate, {
        selected: true,
        selectionScore: scored.score,
        reason: "quality-diversity-balance",
        similarityToSelected: scored.similarities,
      }),
    )
  }

  if (new Set(selected.map((candidate) => candidate.content)).size < 2) {
    const alternative = eligible
      .filter((candidate) => candidate.content !== selected[0]?.content)
      .sort(
        (a, b) =>
          (b.quality?.overallQuality ?? 0) - (a.quality?.overallQuality ?? 0),
      )[0]
    if (alternative && selected.length >= 2) {
      const similarities = selected.slice(0, -1).map(
        (item) => contentSimilarity(alternative.features, item.features).overall,
      )
      selected[selected.length - 1] = withSelection(alternative, {
        selected: true,
        selectionScore:
          (alternative.quality?.overallQuality ?? 0) * 0.65 +
          (1 - Math.max(...similarities)) * 100 * 0.35,
        reason: "content-diversity",
        similarityToSelected: similarities,
      })
    }
  }

  const selectedBySeed = new Map(selected.map((candidate) => [candidate.seed, candidate]))
  pool = pool.map((candidate) => {
    return selectedBySeed.get(candidate.seed) ?? candidate
  })
  return { selected, evaluatedPool: pool }
}
