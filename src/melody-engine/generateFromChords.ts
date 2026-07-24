import { SeededRandom } from "@/core/rng"
import type { ChordEvent, SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type {
  AdvancedMelodyMetrics,
  CandidateGenerationDiagnostics,
  MelodyGeneratorProfile,
  MelodyNote,
  MelodyOpeningIntent,
  MelodyOpeningPlan,
  MelodyVariant,
  PhrasePlan,
  ProsodyPlan,
  SongMotifDNA,
} from "@/core/melody"
import { buildHarmonicMap } from "./harmonicMap"
import { resolveGenerationParams, type Density, type Drama, type GenerationParams, type RangeSetting } from "./generationParams"
import { assemblePhrase, createPlacementDiagnostics, type PlacementDiagnostics } from "./phraseAssembler"
import type { MotifCore } from "./motifCore"
import { computeMelodyFeatures } from "./features"
import { scoreCandidate } from "./scoring"
import { buildSignature, countDistinctCandidates, differenceCount, type DiversitySignature } from "./diversityFilter"
import { GENERATOR_PROFILE_KIND, GENERATOR_PROFILE_LABELS, applyProfileOverride, generatorProfileIntensity } from "./generatorProfile"
import { generateElegiacCantabile } from "./elegiacCantabile"
import { generateSpeechRhythmicPattern } from "./speechRhythmic"
import { generateIncantatoryPattern } from "./incantatory"
import { computeAdvancedMelodyMetrics } from "./advancedMetrics"
import { applyMotifDNA, nudgeTowardDNA } from "./motifDNA"
import {
  MAX_OPENING_REGEN_ATTEMPTS,
  OPENING_SIMILARITY_MAX,
  openingIntentToPlan,
  openingSimilarity,
  planOpeningIntents,
  PROFILE_OPENING_CANDIDATES,
} from "./openingIntent"
import {
  CANDIDATE_SELECTION_CONFIG,
  PROFILE_MINIMUM_QUALITY,
  selectDiverseCandidates,
} from "./candidateSelection"
import { melodySimilarity } from "./melodySimilarity"
import { isChordTone, isTensionTone } from "@/core/chord"
import { pitchClass } from "@/core/note"
import { SETTINGS_APPLICABILITY } from "./settingsApplicability"

export interface GenerateFromChordsInput {
  chords: ChordEvent[]
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  density: Density
  range: RangeSetting
  drama: Drama
  totalBeats: number
  seed: number
  candidateCount?: number
  /** Issue #13: テンション/経過音候補をこのKeyのScaleへ軽く寄せる(parametric Profileのみ) */
  key?: string
}

interface Candidate {
  notes: MelodyNote[]
  plans: PhrasePlan[]
  score: number
  signature: DiversitySignature
  seed: number
  placementDiagnostics: PlacementDiagnostics
}

const GENERATOR_VERSION = "1.0"

/**
 * Issue #13: UIのDensity設定を、bespoke ProfileのnoteDensity(0..1)へ寄せるための目標値。
 * sparse=控えめ / balanced=中庸 / active=密、と直感に一致するよう並べる。
 */
const DENSITY_UI_TARGET: Record<Density, number> = {
  sparse: 0.25,
  balanced: 0.5,
  active: 0.85,
}

function buildCandidate(
  seed: number,
  input: GenerateFromChordsInput,
  forcedContourWeight?: number,
  paramsHook?: (params: GenerationParams) => GenerationParams,
  opening?: MelodyOpeningPlan,
): Candidate {
  const rng = new SeededRandom(seed)
  const harmonicMap = buildHarmonicMap(input.chords)
  let params = resolveGenerationParams(input.songProfile, input.sectionRole, input.density, input.drama, input.key)
  if (paramsHook) params = paramsHook(params)
  if (forcedContourWeight !== undefined) {
    for (const key of Object.keys(params.contourWeights) as (keyof typeof params.contourWeights)[]) {
      params.contourWeights[key] = key === "arch" ? forcedContourWeight : params.contourWeights[key] * 0.6
    }
  }

  const defaultPhraseLengthBeats = input.density === "active" ? 4 : 8

  let firstMotifCore: MotifCore | undefined
  const notes: MelodyNote[] = []
  const plans: PhrasePlan[] = []
  const placementDiagnostics = createPlacementDiagnostics()

  let phraseIdx = 0
  let phraseStart = 0
  while (phraseStart < input.totalBeats - 0.01) {
    // 冒頭フレーズ長を実生成へ反映し、類似度だけを下げる死にメタデータにしない。
    const plannedLength =
      phraseIdx === 0 && opening ? Math.max(1, opening.openingPhraseLengthBeats) : defaultPhraseLengthBeats
    const phraseLen = Math.min(plannedLength, input.totalBeats - phraseStart)
    if (phraseLen <= 0) break
    const isAnswer = phraseIdx === 1
    const reuseMotif = phraseIdx > 0 && firstMotifCore && rng.chance(params.motifRepeatTarget)

    const result = assemblePhrase(
      rng,
      harmonicMap,
      phraseStart,
      phraseLen,
      input.range,
      params,
      input.density,
      reuseMotif ? firstMotifCore : undefined,
      isAnswer,
      // 冒頭設計は最初のフレーズにのみ適用する(それ以降は通常の展開に任せる)
      phraseIdx === 0 ? opening : undefined,
      placementDiagnostics,
    )
    if (phraseIdx === 0) firstMotifCore = result.firstMotifCore
    notes.push(...result.notes)
    plans.push(result.plan)
    phraseStart += phraseLen
    phraseIdx++
  }

  const features = computeMelodyFeatures(notes, harmonicMap, 0, input.totalBeats)
  const score = scoreCandidate(features, params)
  const signature = buildSignature(notes, plans[0]?.contour ?? "wave")

  return { notes, plans, score, signature, seed, placementDiagnostics }
}

/** 5.1 Generate from Chords: 6候補を生成する(標準)。9.7 Diversity Filterで多様性を担保する */
export function generateFromChords(input: GenerateFromChordsInput): {
  candidates: { notes: MelodyNote[]; plans: PhrasePlan[]; seed: number }[]
} {
  const count = input.candidateCount ?? 6
  let candidates: Candidate[] = []
  for (let i = 0; i < count; i++) {
    candidates.push(buildCandidate(input.seed + i * 7919, input))
  }

  // 9.7 Diversity Filter: 少なくとも4案は他候補と2項目以上異なるようにする
  for (let pass = 0; pass < 2; pass++) {
    const signatures = candidates.map((c) => c.signature)
    if (countDistinctCandidates(signatures) >= Math.min(4, count)) break
    for (let i = 0; i < candidates.length; i++) {
      const tooSimilar = candidates.some((other, j) => j !== i && differenceCount(candidates[i].signature, other.signature) < 2)
      if (tooSimilar) {
        const contourWeight = [0.4, 1.8, 2.4][pass % 3] + i * 0.3
        candidates[i] = buildCandidate(input.seed + i * 7919 + (pass + 1) * 104729, input, contourWeight)
      }
    }
  }

  candidates = candidates.sort((a, b) => b.score - a.score)
  return { candidates: candidates.map((c) => ({ notes: c.notes, plans: c.plans, seed: c.seed })) }
}

/** bespoke Profileの出力にも、ピアノロール表示用の簡易PhrasePlanを合成する */
function synthesizePhrasePlan(notes: MelodyNote[], totalBeats: number): PhrasePlan[] {
  if (notes.length === 0) {
    return [{ phraseStartBeat: 0, phraseLengthBeats: totalBeats, climaxBeat: 0, contour: "wave", restBeats: [], endTension: 0.5 }]
  }
  const climaxNote = notes.reduce((a, b) => (b.pitch > a.pitch ? b : a), notes[0])
  return [
    {
      phraseStartBeat: 0,
      phraseLengthBeats: totalBeats,
      climaxBeat: climaxNote.startBeat,
      contour: "arch",
      restBeats: [],
      endTension: 0.5,
    },
  ]
}

function stableHash(value: unknown): string {
  const input = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function noteHash(notes: MelodyNote[]): string {
  return stableHash(
    [...notes]
      .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
      .map((n) => [n.startBeat, n.durationBeats, n.pitch, n.velocity, n.plannedToneRole, n.plannedResolution]),
  )
}

function profileFitScore(
  profile: MelodyGeneratorProfile,
  features: ReturnType<typeof computeMelodyFeatures>,
  advanced?: AdvancedMelodyMetrics,
): number {
  const range = features.rangeHigh - features.rangeLow
  const profileFit = {
    standard: 1 - Math.min(1, Math.abs(features.avgLeap - 3) / 7),
    minimal: (features.restRatio + (1 - Math.min(1, range / 18))) / 2,
    leaping: Math.min(1, features.avgLeap / 6),
    rhythmic: Math.min(1, features.syncopationRatio * 2 + (1 - features.restRatio) * 0.25),
    chromatic: Math.min(1, features.tensionUsageRatio * 2.5 + 0.25),
    cinematic: Math.min(1, range / 15) * 0.55 + features.peakPosition * 0.45,
    "elegiac-cantabile":
      ((advanced?.stepwiseMotionRatio ?? 0.5) + (advanced?.climaxUniqueness ?? 0.5) + (advanced?.delayedResolutionRatio ?? 0)) / 3,
    "speech-rhythmic":
      features.repeatedNoteRatio * 0.3 +
      (1 - Math.min(1, range / 12)) * 0.5 +
      (advanced?.phraseAsymmetry ?? 0.5) * 0.2,
    incantatory:
      (features.motifRepeatRatio + (advanced?.contourRetention ?? 0.5) + (advanced?.cyclicPhraseAmount ?? 0.5)) / 3,
  }[profile]
  return Math.max(0, Math.min(100, profileFit * 100))
}

/** 汎用品質を主軸にしつつ、Profileらしさが選抜で消えない範囲だけ軽く反映する。 */
function combinedQualityScore(baseQuality: number, profileFit: number, profile: MelodyGeneratorProfile): number {
  const profileFitWeight =
    profile === "leaping" ? 0.45 : profile === "speech-rhythmic" ? 0.45 : profile === "minimal" ? 0.3 : 0.25
  return baseQuality * (1 - profileFitWeight) + profileFit * profileFitWeight
}

function directPlacementDiagnostics(notes: MelodyNote[], harmonicMap: ReturnType<typeof buildHarmonicMap>): PlacementDiagnostics {
  const diagnostics = createPlacementDiagnostics()
  for (const note of notes) {
    const entry = harmonicMap.find(
      (e) => note.startBeat >= e.chord.startBeat && note.startBeat < e.chord.startBeat + e.chord.durationBeats,
    )
    const pc = pitchClass(note.pitch)
    const role = !entry
      ? "unresolved-conflict"
      : isChordTone(entry.parsed, pc)
        ? "chord-tone"
        : isTensionTone(entry.parsed, pc)
          ? "tension-hold"
          : "passing-tone"
    note.plannedToneRole = role
    diagnostics.plannedTones.push({
      beat: note.startBeat,
      durationBeats: note.durationBeats,
      rawPitch: note.pitch,
      placedPitch: note.pitch,
      role,
    })
  }
  return diagnostics
}

export interface GenerateProfileBatchInput {
  chords: ChordEvent[]
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  density: Density
  range: RangeSetting
  drama: Drama
  totalBeats: number
  seed: number
  profiles: MelodyGeneratorProfile[]
  /** Song Motif DNA(任意): 他セクションの採用済みメロディから抽出した傾向を軽く反映する */
  motifDNA?: SongMotifDNA
  /** Issue #13: parametric Profileのテンション候補、Speech-Rhythmicのsyncopationへ軽く反映する */
  key?: string
}

export interface ProfileCandidate {
  notes: MelodyNote[]
  plans: PhrasePlan[]
  seed: number
  generatorProfile: MelodyGeneratorProfile
  patternIndex: 1 | 2 | 3
  advancedMetrics?: AdvancedMelodyMetrics
  prosodyPlan?: ProsodyPlan
  openingIntent?: MelodyOpeningIntent
  openingPlan?: MelodyOpeningPlan
  generationDiagnostics?: CandidateGenerationDiagnostics
}

/** 内部表現: 冒頭設計付きの1パターン(冒頭類似度による再生成の対象) */
interface BuiltPattern {
  notes: MelodyNote[]
  plans: PhrasePlan[]
  advancedMetrics?: AdvancedMelodyMetrics
  prosodyPlan?: ProsodyPlan
  seed: number
  opening: MelodyOpeningPlan
  qualityScore: number
  profileFitScore: number
  candidatePoolIndex: number
  openingRegenerationAttempts: number
  placementDiagnostics: PlacementDiagnostics
  rawNotesHash: string
  placedNotesHash: string
  finalNotesHash: string
}

/**
 * Melody Candidate Diversity v1.2 + 冒頭設計: 選択したGenerator Profileごとに3つの独立Patternを生成する。
 * 各Patternはノート生成前にOpening Intent→Opening Planを持ち、冒頭数秒の聴感を明確に分ける。
 * 3案のOpening Intentは最初にまとめて計画し(Pattern番号への固定割り当てはしない)、
 * 生成後に冒頭類似度を測って閾値超過のPatternだけを別のIntent/seedで再生成する。
 */
export function generateFromChordsWithProfiles(input: GenerateProfileBatchInput): {
  candidates: ProfileCandidate[]
  diagnostics: CandidateGenerationDiagnostics[]
} {
  const harmonicMap = buildHarmonicMap(input.chords)
  const results: ProfileCandidate[] = []
  const allDiagnostics: CandidateGenerationDiagnostics[] = []
  // Density/Drama/Keyの効きをbespoke Profileへも一貫させるための基準値
  const baseParams = resolveGenerationParams(input.songProfile, input.sectionRole, input.density, input.drama, input.key)
  const dna = input.motifDNA
  const dnaImpliedDensity = dna ? 1 - dna.repeatedNoteTendency : undefined
  const uiDensityTarget = DENSITY_UI_TARGET[input.density]

  input.profiles.forEach((profile, profileIdx) => {
    const kind = GENERATOR_PROFILE_KIND[profile]
    const intensity = generatorProfileIntensity(profile, input.sectionRole)
    const baseSeed = input.seed + profileIdx * 500009

    const baseInput: GenerateFromChordsInput = {
      chords: input.chords,
      sectionId: input.sectionId,
      sectionRole: input.sectionRole,
      songProfile: input.songProfile,
      density: input.density,
      range: input.range,
      drama: input.drama,
      totalBeats: input.totalBeats,
      seed: baseSeed,
      key: input.key,
    }
    const hook = (params: GenerationParams) => applyMotifDNA(applyProfileOverride(params, profile, intensity), input.motifDNA)
    const applicability = SETTINGS_APPLICABILITY[profile]
    const scoringBaseParams = resolveGenerationParams(
      input.songProfile,
      input.sectionRole,
      input.density,
      applicability.drama === "applied" ? input.drama : "growing",
      applicability.key === "applied" ? input.key : undefined,
    )
    const profileParams = hook(scoringBaseParams)

    // 指定のseedとOpening Intentから、そのProfileの1パターンを生成する(生成順序: Intent→Plan→本体)
    const buildOne = (
      patternSeed: number,
      intent: MelodyOpeningIntent,
      candidatePoolIndex: number,
      openingRegenerationAttempts = 0,
    ): BuiltPattern => {
      const planRng = new SeededRandom(patternSeed ^ 0x5f3759df)
      const opening = openingIntentToPlan(planRng, intent, harmonicMap, input.range)

      if (kind === "bespoke") {
        const rng = new SeededRandom(patternSeed)
        let notes: MelodyNote[]
        let plans: PhrasePlan[]
        let advancedMetrics: AdvancedMelodyMetrics
        let prosodyPlan: ProsodyPlan | undefined
        if (profile === "elegiac-cantabile") {
          const noteDensity = nudgeTowardDNA(nudgeTowardDNA(0.34, uiDensityTarget, 0.6), dnaImpliedDensity, 0.35)
          notes = generateElegiacCantabile(rng, harmonicMap, input.totalBeats, input.range, intensity, noteDensity, dna, opening)
          plans = synthesizePhrasePlan(notes, input.totalBeats)
          advancedMetrics = computeAdvancedMelodyMetrics(notes, harmonicMap)
        } else if (profile === "speech-rhythmic") {
          const repeatedNoteAmount = nudgeTowardDNA(0.82, dna?.repeatedNoteTendency, 0.4)
          const syncopationAmount = nudgeTowardDNA(0.76, baseParams.syncopationAmount, 0.5)
          const r = generateSpeechRhythmicPattern(rng, harmonicMap, input.totalBeats, input.range, intensity, repeatedNoteAmount, syncopationAmount, 0.68, 0.72, opening)
          notes = r.notes
          plans = synthesizePhrasePlan(notes, input.totalBeats)
          advancedMetrics = computeAdvancedMelodyMetrics(notes, harmonicMap)
          prosodyPlan = r.prosodyPlan
        } else {
          // incantatory
          const noteDensity = nudgeTowardDNA(nudgeTowardDNA(0.58, uiDensityTarget, 0.6), dnaImpliedDensity, 0.35)
          const r = generateIncantatoryPattern(rng, harmonicMap, input.totalBeats, input.range, intensity, noteDensity, dna, opening)
          const generic = computeAdvancedMelodyMetrics(r.notes, harmonicMap)
          const motifMutationRatio = 1 / r.plan.mutationPeriod
          notes = r.notes
          plans = synthesizePhrasePlan(notes, input.totalBeats)
          advancedMetrics = {
            ...generic,
            motifMutationRatio,
            cyclicPhraseAmount: 0.8 + intensity * 0.15,
            mutationPeriodicity: r.plan.mutationPeriod / 8,
            contourRetention: 1 - motifMutationRatio,
          }
        }

        const features = computeMelodyFeatures(notes, harmonicMap, 0, input.totalBeats)
        const placementDiagnostics = directPlacementDiagnostics(notes, harmonicMap)
        const hash = noteHash(notes)
        const fitScore = profileFitScore(profile, features, advancedMetrics)
        return {
          notes,
          plans,
          advancedMetrics,
          prosodyPlan,
          seed: patternSeed,
          opening,
          qualityScore: combinedQualityScore(scoreCandidate(features, profileParams), fitScore, profile),
          profileFitScore: fitScore,
          candidatePoolIndex,
          openingRegenerationAttempts,
          placementDiagnostics,
          rawNotesHash: hash,
          placedNotesHash: hash,
          finalNotesHash: hash,
        }
      }

      // parametric: 既存フレーズ生成エンジンをProfile専用パラメータ + Opening Planで駆動する
      const c = buildCandidate(patternSeed, baseInput, undefined, hook, opening)
      const advancedMetrics = computeAdvancedMelodyMetrics(c.notes, harmonicMap)
      const fitScore = profileFitScore(profile, computeMelodyFeatures(c.notes, harmonicMap, 0, input.totalBeats), advancedMetrics)
      return {
        notes: c.notes,
        plans: c.plans,
        advancedMetrics,
        seed: c.seed,
        opening,
        qualityScore: combinedQualityScore(c.score, fitScore, profile),
        profileFitScore: fitScore,
        candidatePoolIndex,
        openingRegenerationAttempts,
        placementDiagnostics: c.placementDiagnostics,
        rawNotesHash: stableHash(c.placementDiagnostics.plannedTones.map((t) => [t.beat, t.durationBeats, t.rawPitch, t.role, t.resolution])),
        placedNotesHash: stableHash(c.placementDiagnostics.plannedTones.map((t) => [t.beat, t.durationBeats, t.placedPitch, t.role, t.resolution])),
        finalNotesHash: noteHash(c.notes),
      }
    }

    // 1) Profileに適した入口を持つ独立候補プールを生成する。最初の3つは従来通りまとめて計画する。
    const intentRng = new SeededRandom(baseSeed ^ 0x9e3779b1)
    const initialIntents = planOpeningIntents(intentRng, profile, 3)
    const intentForPoolIndex = (poolIndex: number): MelodyOpeningIntent => {
      if (poolIndex < initialIntents.length) return initialIntents[poolIndex]
      const candidates = PROFILE_OPENING_CANDIDATES[profile]
      const offset = new SeededRandom(baseSeed ^ 0x85ebca6b).intBetween(0, candidates.length - 1)
      const candidate = candidates[(poolIndex - initialIntents.length + offset) % candidates.length]
      return {
        entryType: candidate.entryType,
        emotionalFunction: candidate.emotionalFunction,
        register: candidate.register,
        initialDirection: candidate.initialDirection,
      }
    }

    const pool: BuiltPattern[] = []
    const appendCandidate = () => {
      const poolIndex = pool.length
      pool.push(buildOne(baseSeed + poolIndex * 7919, intentForPoolIndex(poolIndex), poolIndex))
    }
    while (pool.length < CANDIDATE_SELECTION_CONFIG.candidatePoolSize) appendCandidate()

    // 従来の3 Pattern相当となる先頭3件が似た場合は、後側の該当候補だけを
    // 新しいIntent・Plan・seedで作り直す。候補全体のコピーや開始音だけの差し替えは行わない。
    for (let attempt = 1; attempt <= MAX_OPENING_REGEN_ATTEMPTS; attempt++) {
      let target = -1
      let worstSimilarity = OPENING_SIMILARITY_MAX - 0.001
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          const similarity = openingSimilarity(
            { notes: pool[a].notes, plan: pool[a].opening },
            { notes: pool[b].notes, plan: pool[b].opening },
          )
          if (similarity >= worstSimilarity) {
            worstSimilarity = similarity
            target = b
          }
        }
      }
      const distinctStarts = new Set(
        pool.slice(0, 3).map((candidate) =>
          Math.min(...candidate.notes.map((note) => note.startBeat), Number.POSITIVE_INFINITY).toFixed(3),
        ),
      ).size
      if (target < 0 && distinctStarts >= 2) break
      if (target < 0) target = 2
      const replacementIntent = intentForPoolIndex(
        CANDIDATE_SELECTION_CONFIG.candidatePoolSize + attempt * 3 + target,
      )
      pool[target] = buildOne(
        baseSeed + target * 7919 + attempt * 15485863,
        replacementIntent,
        target,
        attempt,
      )
    }

    const runSelection = () =>
      selectDiverseCandidates(
        pool.map((candidate) => ({ ...candidate, openingPlan: candidate.opening })),
        harmonicMap,
        PROFILE_MINIMUM_QUALITY[profile],
        CANDIDATE_SELECTION_CONFIG.finalCandidateCount,
        {
          maximumOpeningSimilarity: OPENING_SIMILARITY_MAX - 0.001,
          requireOpeningCategoryDiversity: true,
          requireActualStartBeatDiversity: true,
        },
      )

    // 2) 品質候補が不足する、または初期閾値では多様な3案を選べない場合だけ追加生成する。
    let selection = runSelection()
    while (
      pool.length < CANDIDATE_SELECTION_CONFIG.maximumPoolSize &&
      (selection.selected.length < CANDIDATE_SELECTION_CONFIG.finalCandidateCount ||
        selection.selected.some((item) => item.reason === "insufficient-diversity-fallback"))
    ) {
      appendCandidate()
      selection = runSelection()
    }

    const selectedPoolIndexes = new Set(selection.selected.map((item) => item.candidate.candidatePoolIndex))
    for (const pattern of pool) {
      const selectedItem = selection.selected.find((item) => item.candidate.candidatePoolIndex === pattern.candidatePoolIndex)
      const belowFloor = pattern.qualityScore < PROFILE_MINIMUM_QUALITY[profile]
      const similarityToSelected = selection.selected
        .filter((item) => item.candidate.candidatePoolIndex !== pattern.candidatePoolIndex)
        .map((item) =>
            melodySimilarity(
              { notes: pattern.notes, plans: pattern.plans, openingPlan: pattern.opening },
              item.candidate,
              harmonicMap,
            ),
          )
      const rejectedDiversity = 1 - Math.max(...similarityToSelected.map((similarity) => similarity.overallSimilarity), 0)
      const diagnosticSelectionScore =
        selectedItem?.selectionScore ??
        Math.max(0, Math.min(1, pattern.qualityScore / 100)) * CANDIDATE_SELECTION_CONFIG.qualityWeight +
          rejectedDiversity * CANDIDATE_SELECTION_CONFIG.diversityWeight
      allDiagnostics.push({
        batchBaseSeed: baseSeed,
        candidateSeed: pattern.seed,
        candidatePoolIndex: pattern.candidatePoolIndex,
        openingRegenerationAttempts: pattern.openingRegenerationAttempts,
        qualityScore: pattern.qualityScore,
        profileFitScore: pattern.profileFitScore,
        selectionScore: diagnosticSelectionScore,
        selected: selectedPoolIndexes.has(pattern.candidatePoolIndex),
        reason: selectedItem?.reason ?? (belowFloor ? "below-quality-floor" : "not-selected"),
        similarityToSelected,
        plannedTones: pattern.placementDiagnostics.plannedTones,
        changedPitchCount: pattern.placementDiagnostics.changedPitchCount,
        corrections: pattern.placementDiagnostics.corrections,
        rawNotesHash: pattern.rawNotesHash,
        placedNotesHash: pattern.placedNotesHash,
        finalNotesHash: pattern.finalNotesHash,
      })
    }

    // 3) 選抜順を最終Pattern 1〜3へ割り当てる。元候補は互いに独立生成されている。
    selection.selected.forEach((selected, i) => {
      const pattern = selected.candidate
      const generationDiagnostics = allDiagnostics.find(
        (d) => d.batchBaseSeed === baseSeed && d.candidatePoolIndex === pattern.candidatePoolIndex,
      )
      results.push({
        notes: pattern.notes,
        plans: pattern.plans,
        seed: pattern.seed,
        generatorProfile: profile,
        patternIndex: (i + 1) as 1 | 2 | 3,
        advancedMetrics: pattern.advancedMetrics,
        prosodyPlan: pattern.prosodyPlan,
        openingIntent: pattern.opening.intent,
        openingPlan: pattern.opening,
        generationDiagnostics,
      })
    })
  })

  return { candidates: results, diagnostics: allDiagnostics }
}

export function toMelodyVariantFromProfile(
  sectionId: string,
  songProfile: SongProfileId,
  candidate: ProfileCandidate,
  batchId: string,
  parentMelodyId: string | null = null,
): MelodyVariant {
  return {
    id: crypto.randomUUID(),
    name: `${GENERATOR_PROFILE_LABELS[candidate.generatorProfile]} · Pattern ${candidate.patternIndex}`,
    sectionId,
    sourceMode: "generate",
    notes: candidate.notes,
    phrasePlans: candidate.plans,
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: GENERATOR_VERSION,
    seed: candidate.seed,
    songProfile,
    parentMelodyId,
    batchId,
    createdAt: new Date().toISOString(),
    generatorProfile: candidate.generatorProfile,
    patternIndex: candidate.patternIndex,
    advancedMetrics: candidate.advancedMetrics,
    prosodyPlan: candidate.prosodyPlan,
    openingIntent: candidate.openingIntent,
    generationDiagnostics: candidate.generationDiagnostics,
  }
}

export function toMelodyVariant(
  sectionId: string,
  songProfile: SongProfileId,
  candidate: { notes: MelodyNote[]; plans: PhrasePlan[]; seed: number },
  index: number,
  batchId: string,
  parentMelodyId: string | null = null,
): MelodyVariant {
  return {
    id: crypto.randomUUID(),
    name: `候補 ${index + 1}`,
    sectionId,
    sourceMode: "generate",
    notes: candidate.notes,
    phrasePlans: candidate.plans,
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: GENERATOR_VERSION,
    seed: candidate.seed,
    songProfile,
    parentMelodyId,
    batchId,
    createdAt: new Date().toISOString(),
  }
}
