import type {
  CandidateMelodyDNA,
  CandidateSelectionReason,
  MelodyTransitionPlan,
  MelodyGeneratorProfile,
  MelodySimilarityBreakdown,
} from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import {
  melodySimilarity,
  type MelodySimilarityCandidate,
} from "./melodySimilarity"

export const CANDIDATE_SELECTION_CONFIG = {
  candidatePoolSize: 9,
  finalCandidateCount: 3,
  maximumPoolSize: 15,
  qualityWeight: 0.6,
  diversityWeight: 0.4,
  /** Rule指定時だけ使用する。残り90%はquality/diversityの比率を維持する。 */
  techniqueFitWeight: 0.1,
  maximumOverallSimilarity: 0.72,
  similarityRelaxationStep: 0.05,
  maximumRelaxedSimilarity: 0.9,
  structuralRhythmSimilarity: 0.9,
  structuralIntervalSimilarity: 0.84,
  structuralContourSimilarity: 0.92,
} as const

/** 現行score(0..100)に対する保守的なProfile別最低品質。試聴後に個別調整できる設定値。 */
export const PROFILE_MINIMUM_QUALITY: Record<MelodyGeneratorProfile, number> = {
  standard: 45,
  minimal: 40,
  leaping: 42,
  rhythmic: 42,
  chromatic: 40,
  cinematic: 42,
  "elegiac-cantabile": 38,
  "speech-rhythmic": 38,
  incantatory: 38,
}

export interface SelectableCandidate extends MelodySimilarityCandidate {
  candidatePoolIndex: number
  qualityScore: number
  profileFitScore: number
  techniqueFitScore?: number
  candidateMelodyDNA?: CandidateMelodyDNA
  transitionPlan?: MelodyTransitionPlan
}

export interface SelectedCandidate<T extends SelectableCandidate> {
  candidate: T
  selectionScore: number
  reason: CandidateSelectionReason
  similarityToSelected: MelodySimilarityBreakdown[]
}

export interface CandidateSelectionResult<T extends SelectableCandidate> {
  selected: SelectedCandidate<T>[]
  belowQualityFloor: T[]
  unselected: T[]
  finalSimilarityThreshold: number
}

export interface CandidateSelectionOptions {
  maximumOpeningSimilarity?: number
  requireOpeningCategoryDiversity?: boolean
  requireActualStartBeatDiversity?: boolean
  requireCandidateDNADiversity?: boolean
  requireTransitionStrategyDiversity?: boolean
  minimumTransitionFitScore?: number
  /** 0なら従来選抜。指定時もquality floorは変更しない。 */
  techniqueFitWeight?: number
}

function normalizedQuality(candidate: SelectableCandidate): number {
  return Math.max(0, Math.min(1, candidate.qualityScore / 100))
}

function normalizedTechniqueFit(candidate: SelectableCandidate): number {
  return Math.max(0, Math.min(1, candidate.techniqueFitScore ?? 0))
}

function techniqueFitWeight(options: CandidateSelectionOptions): number {
  return Math.max(0, Math.min(0.25, options.techniqueFitWeight ?? 0))
}

function firstCandidateScore(
  candidate: SelectableCandidate,
  options: CandidateSelectionOptions,
): number {
  const fitWeight = techniqueFitWeight(options)
  return (
    normalizedQuality(candidate) * (1 - fitWeight) +
    normalizedTechniqueFit(candidate) * fitWeight
  )
}

function balancedSelectionScore(
  candidate: SelectableCandidate,
  diversity: number,
  options: CandidateSelectionOptions,
): number {
  const fitWeight = techniqueFitWeight(options)
  const baseWeight = 1 - fitWeight
  return (
    normalizedQuality(candidate) *
      CANDIDATE_SELECTION_CONFIG.qualityWeight *
      baseWeight +
    diversity *
      CANDIDATE_SELECTION_CONFIG.diversityWeight *
      baseWeight +
    normalizedTechniqueFit(candidate) * fitWeight
  )
}

function similaritiesToSelected<T extends SelectableCandidate>(
  candidate: T,
  selected: SelectedCandidate<T>[],
  harmonicMap: HarmonicMapEntry[],
): MelodySimilarityBreakdown[] {
  return selected.map((item) => melodySimilarity(candidate, item.candidate, harmonicMap))
}

/**
 * overallだけでは、同型の音程列・リズム骨格が音域や終止の差で薄まる場合がある。
 * 実際に「同じ案の移高・小変更」と聞こえやすい組み合わせを構造的重複として扱う。
 */
export function isStructurallyRedundant(similarity: MelodySimilarityBreakdown): boolean {
  return (
    (similarity.rhythmSimilarity >= CANDIDATE_SELECTION_CONFIG.structuralRhythmSimilarity &&
      similarity.intervalSimilarity >= CANDIDATE_SELECTION_CONFIG.structuralIntervalSimilarity) ||
    (similarity.contourSimilarity >= CANDIDATE_SELECTION_CONFIG.structuralContourSimilarity &&
      similarity.phraseSimilarity >= 0.9 &&
      similarity.cadenceSimilarity >= 0.9)
  )
}

/** 聴感上目立つ音程・リズム・輪郭をoverallより少し強く扱う選抜専用類似度。 */
function perceptualSimilarity(similarity: MelodySimilarityBreakdown): number {
  return Math.max(
    similarity.overallSimilarity,
    similarity.rhythmSimilarity * 0.45 +
      similarity.intervalSimilarity * 0.35 +
      similarity.contourSimilarity * 0.2,
  )
}

function minimumPerceptualDiversity(similarities: MelodySimilarityBreakdown[]): number {
  return 1 - Math.max(...similarities.map(perceptualSimilarity), 0)
}

export function selectDiverseCandidates<T extends SelectableCandidate>(
  pool: T[],
  harmonicMap: HarmonicMapEntry[],
  qualityFloor: number,
  finalCount = CANDIDATE_SELECTION_CONFIG.finalCandidateCount,
  options: CandidateSelectionOptions = {},
): CandidateSelectionResult<T> {
  const eligible = pool.filter((candidate) => candidate.qualityScore >= qualityFloor)
  const belowQualityFloor = pool.filter((candidate) => candidate.qualityScore < qualityFloor)

  // Opening制約を同時に満たす必要があるProfile生成では、最高品質1件を先に固定すると
  // 残り2件を選べなくなることがある。最大15件なので全3組を評価し、実音上成立する組から選ぶ。
  if (
    finalCount === 3 &&
    options.maximumOpeningSimilarity !== undefined &&
    options.requireOpeningCategoryDiversity
  ) {
    const pairCache = new Map<string, MelodySimilarityBreakdown>()
    const pairSimilarity = (a: T, b: T): MelodySimilarityBreakdown => {
      const low = Math.min(a.candidatePoolIndex, b.candidatePoolIndex)
      const high = Math.max(a.candidatePoolIndex, b.candidatePoolIndex)
      const key = `${low}:${high}`
      const cached = pairCache.get(key)
      if (cached) return cached
      const value = melodySimilarity(a, b, harmonicMap)
      pairCache.set(key, value)
      return value
    }
    const starts = (set: T[]): number =>
      new Set(
        set.map((candidate) =>
          Math.min(...candidate.notes.map((note) => note.startBeat), Number.POSITIVE_INFINITY).toFixed(3),
        ),
      ).size
    const openingCategoriesValid = (set: T[]): boolean => {
      const plans = set.map((candidate) => candidate.openingPlan)
      if (plans.some((plan) => !plan)) return false
      return (
        new Set(plans.map((plan) => plan!.intent.entryType)).size >= 2 &&
        new Set(plans.map((plan) => plan!.intent.initialDirection)).size >= 2 &&
        new Set(plans.map((plan) => plan!.openingContour)).size >= 2 &&
        (!options.requireActualStartBeatDiversity || starts(set) >= 2)
      )
    }
    const candidateDNAValid = (set: T[]): boolean => {
      if (!options.requireCandidateDNADiversity) return true
      const candidates = set.map((candidate) => candidate.candidateMelodyDNA)
      if (candidates.some((candidate) => !candidate)) return false
      const dnaSet = candidates as CandidateMelodyDNA[]
      const signatures = dnaSet.map((candidate) => JSON.stringify(candidate))
      const dimensions = [
        dnaSet.map((candidate) => candidate.motifIdentity),
        dnaSet.map((candidate) => candidate.rhythmGrammar),
        dnaSet.map((candidate) => candidate.phraseArchitecture),
        dnaSet.map((candidate) => candidate.harmonicResponse),
        dnaSet.map((candidate) => candidate.registerTrajectory),
        dnaSet.map((candidate) => candidate.developmentStrategy),
        dnaSet.map((candidate) => candidate.climaxPlan.position),
        dnaSet.map((candidate) => candidate.endingStrategy),
      ]
      return new Set(signatures).size === set.length && dimensions.filter((values) => new Set(values).size >= 2).length >= 3
    }
    const transitionStrategiesValid = (set: T[]): boolean => {
      if (!options.requireTransitionStrategyDiversity) return true
      const plans = set.map((candidate) => candidate.transitionPlan)
      return (
        plans.every(Boolean) &&
        plans.every(
          (plan) =>
            plan!.transitionFitScore >= (options.minimumTransitionFitScore ?? 0),
        ) &&
        new Set(plans.map((plan) => plan!.strategy)).size >= 2
      )
    }

    type RankedSet = {
      set: T[]
      similarities: MelodySimilarityBreakdown[]
      maxOverall: number
      structuralRedundancyCount: number
      score: number
    }
    const rankedSets: RankedSet[] = []
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        for (let k = j + 1; k < eligible.length; k++) {
          const set = [eligible[i], eligible[j], eligible[k]]
          if (!openingCategoriesValid(set)) continue
          if (!candidateDNAValid(set)) continue
          if (!transitionStrategiesValid(set)) continue
          const similarities = [
            pairSimilarity(set[0], set[1]),
            pairSimilarity(set[0], set[2]),
            pairSimilarity(set[1], set[2]),
          ]
          if (similarities.some((similarity) => similarity.openingSimilarity > options.maximumOpeningSimilarity! + 1e-9)) {
            continue
          }
          const maxOverall = Math.max(...similarities.map((similarity) => similarity.overallSimilarity))
          const averageQuality = set.reduce((sum, candidate) => sum + normalizedQuality(candidate), 0) / set.length
          const averageTechniqueFit =
            set.reduce(
              (sum, candidate) =>
                sum + normalizedTechniqueFit(candidate),
              0,
            ) / set.length
          const minimumDiversity = minimumPerceptualDiversity(similarities)
          const structuralRedundancyCount = similarities.filter(isStructurallyRedundant).length
          const fitWeight = techniqueFitWeight(options)
          rankedSets.push({
            set,
            similarities,
            maxOverall,
            structuralRedundancyCount,
            score:
              averageQuality *
                CANDIDATE_SELECTION_CONFIG.qualityWeight *
                (1 - fitWeight) +
              minimumDiversity *
                CANDIDATE_SELECTION_CONFIG.diversityWeight *
                (1 - fitWeight) +
              averageTechniqueFit * fitWeight -
              structuralRedundancyCount * 0.08,
          })
        }
      }
    }

    let setThreshold: number = CANDIDATE_SELECTION_CONFIG.maximumOverallSimilarity
    let bestSet: RankedSet | undefined
    // まず全緩和範囲で構造重複ゼロの組を探し、それが存在しない場合だけ重複数最小の組へフォールバックする。
    while (!bestSet && setThreshold <= CANDIDATE_SELECTION_CONFIG.maximumRelaxedSimilarity + 1e-9) {
      bestSet = rankedSets
        .filter(
          (candidateSet) =>
            candidateSet.maxOverall <= setThreshold &&
            candidateSet.structuralRedundancyCount === 0,
        )
        .sort((a, b) => b.score - a.score)[0]
      if (!bestSet) setThreshold += CANDIDATE_SELECTION_CONFIG.similarityRelaxationStep
    }
    if (!bestSet) {
      setThreshold = CANDIDATE_SELECTION_CONFIG.maximumOverallSimilarity
      while (!bestSet && setThreshold <= CANDIDATE_SELECTION_CONFIG.maximumRelaxedSimilarity + 1e-9) {
        bestSet = rankedSets
          .filter((candidateSet) => candidateSet.maxOverall <= setThreshold)
          .sort(
            (a, b) =>
              a.structuralRedundancyCount - b.structuralRedundancyCount ||
              b.score - a.score,
          )[0]
        if (!bestSet) setThreshold += CANDIDATE_SELECTION_CONFIG.similarityRelaxationStep
      }
    }

    if (bestSet) {
      const ordered = [...bestSet.set].sort(
        (a, b) => b.qualityScore - a.qualityScore || a.candidatePoolIndex - b.candidatePoolIndex,
      )
      const selected: SelectedCandidate<T>[] = []
      for (const candidate of ordered) {
        const similarities = similaritiesToSelected(candidate, selected, harmonicMap)
        const diversity = minimumPerceptualDiversity(similarities)
        selected.push({
          candidate,
          selectionScore:
            selected.length === 0
              ? firstCandidateScore(candidate, options)
              : balancedSelectionScore(candidate, diversity, options),
          reason:
            selected.length === 0
              ? "highest-quality"
              : bestSet.structuralRedundancyCount > 0
                ? "insufficient-diversity-fallback"
              : setThreshold <= CANDIDATE_SELECTION_CONFIG.maximumOverallSimilarity
                ? "quality-diversity-balance"
                : "diversity-threshold-relaxed",
          similarityToSelected: similarities,
        })
      }
      return {
        selected,
        belowQualityFloor,
        unselected: eligible.filter((candidate) => !bestSet.set.includes(candidate)),
        finalSimilarityThreshold: Math.min(setThreshold, CANDIDATE_SELECTION_CONFIG.maximumRelaxedSimilarity),
      }
    }

    return {
      selected: [],
      belowQualityFloor,
      unselected: eligible,
      finalSimilarityThreshold: CANDIDATE_SELECTION_CONFIG.maximumRelaxedSimilarity,
    }
  }

  const selected: SelectedCandidate<T>[] = []
  const remaining = [...eligible]

  if (remaining.length > 0) {
    remaining.sort(
      (a, b) =>
        firstCandidateScore(b, options) -
          firstCandidateScore(a, options) ||
        b.qualityScore - a.qualityScore ||
        b.profileFitScore - a.profileFitScore ||
        a.candidatePoolIndex - b.candidatePoolIndex,
    )
    const first = remaining.shift()!
    selected.push({
      candidate: first,
      selectionScore: firstCandidateScore(first, options),
      reason: "highest-quality",
      similarityToSelected: [],
    })
  }

  let threshold: number = CANDIDATE_SELECTION_CONFIG.maximumOverallSimilarity
  while (selected.length < finalCount && remaining.length > 0) {
    const ranked = remaining
      .map((candidate) => {
        const similarities = similaritiesToSelected(candidate, selected, harmonicMap)
        const maximumSimilarity = Math.max(...similarities.map((s) => s.overallSimilarity), 0)
        const minimumDiversity = minimumPerceptualDiversity(similarities)
        const selectionScore = balancedSelectionScore(
          candidate,
          minimumDiversity,
          options,
        )
        return {
          candidate,
          similarities,
          maximumSimilarity,
          structurallyRedundant: similarities.some(isStructurallyRedundant),
          selectionScore,
        }
      })
      .sort(
        (a, b) =>
          Number(a.structurallyRedundant) - Number(b.structurallyRedundant) ||
          b.selectionScore - a.selectionScore ||
          b.candidate.qualityScore - a.candidate.qualityScore ||
          a.candidate.candidatePoolIndex - b.candidate.candidatePoolIndex,
      )

    const keepsOpeningCategoriesDistinct = (candidate: T): boolean => {
      const next = candidate.openingPlan
      if (!options.requireOpeningCategoryDiversity || !next) return true
      const duplicateIntent = selected.some((item) => {
        const existing = item.candidate.openingPlan?.intent
        return (
          existing?.entryType === next.intent.entryType &&
          existing.emotionalFunction === next.intent.emotionalFunction &&
          existing.register === next.intent.register &&
          existing.initialDirection === next.intent.initialDirection
        )
      })
      if (duplicateIntent) return false
      if (selected.length !== 1) return true
      const first = selected[0].candidate.openingPlan
      if (!first) return true
      return (
        first.intent.entryType !== next.intent.entryType &&
        first.intent.initialDirection !== next.intent.initialDirection &&
        first.openingContour !== next.openingContour
      )
    }
    const respectsOpeningCeiling = (item: (typeof ranked)[number]): boolean =>
      options.maximumOpeningSimilarity === undefined ||
      item.similarities.every((similarity) => similarity.openingSimilarity <= options.maximumOpeningSimilarity! + 1e-9)

    const keepsActualStartBeatDiverse = (candidate: T): boolean => {
      if (!options.requireActualStartBeatDiversity || selected.length !== 1) return true
      const firstStart = Math.min(...selected[0].candidate.notes.map((note) => note.startBeat), Number.POSITIVE_INFINITY)
      const candidateStart = Math.min(...candidate.notes.map((note) => note.startBeat), Number.POSITIVE_INFINITY)
      return Math.abs(firstStart - candidateStart) >= 0.25
    }
    const hardConstraintsSatisfied = (item: (typeof ranked)[number]): boolean =>
      respectsOpeningCeiling(item) &&
      keepsOpeningCategoriesDistinct(item.candidate) &&
      keepsActualStartBeatDiverse(item.candidate)

    const hardEligible = ranked.filter(hardConstraintsSatisfied)
    let picked = hardEligible.find((item) => !item.structurallyRedundant && item.maximumSimilarity <= threshold)
    let reason: CandidateSelectionReason = threshold === CANDIDATE_SELECTION_CONFIG.maximumOverallSimilarity
      ? "quality-diversity-balance"
      : "diversity-threshold-relaxed"

    if (!picked) {
      if (threshold < CANDIDATE_SELECTION_CONFIG.maximumRelaxedSimilarity) {
        threshold = Math.min(
          CANDIDATE_SELECTION_CONFIG.maximumRelaxedSimilarity,
          threshold + CANDIDATE_SELECTION_CONFIG.similarityRelaxationStep,
        )
        continue
      }
      picked = hardEligible[0]
      if (!picked) break
      reason = "insufficient-diversity-fallback"
    }

    selected.push({
      candidate: picked.candidate,
      selectionScore: picked.selectionScore,
      reason,
      similarityToSelected: picked.similarities,
    })
    remaining.splice(remaining.indexOf(picked.candidate), 1)
  }

  return {
    selected,
    belowQualityFloor,
    unselected: remaining,
    finalSimilarityThreshold: threshold,
  }
}
