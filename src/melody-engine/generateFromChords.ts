import { SeededRandom } from "@/core/rng"
import type { ChordEvent, SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type {
  AdvancedMelodyMetrics,
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
import { assemblePhrase } from "./phraseAssembler"
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
  pickDistinctIntent,
  planOpeningIntents,
} from "./openingIntent"

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

  const phraseLengthBeats = input.density === "active" ? 4 : 8
  const numPhrases = Math.max(1, Math.ceil(input.totalBeats / phraseLengthBeats))

  let firstMotifCore: MotifCore | undefined
  const notes: MelodyNote[] = []
  const plans: PhrasePlan[] = []

  for (let phraseIdx = 0; phraseIdx < numPhrases; phraseIdx++) {
    const phraseStart = phraseIdx * phraseLengthBeats
    const phraseLen = Math.min(phraseLengthBeats, input.totalBeats - phraseStart)
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
    )
    if (phraseIdx === 0) firstMotifCore = result.firstMotifCore
    notes.push(...result.notes)
    plans.push(result.plan)
  }

  const features = computeMelodyFeatures(notes, harmonicMap, 0, input.totalBeats)
  const score = scoreCandidate(features, params)
  const signature = buildSignature(notes, plans[0]?.contour ?? "wave")

  return { notes, plans, score, signature, seed }
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
}

/** 内部表現: 冒頭設計付きの1パターン(冒頭類似度による再生成の対象) */
interface BuiltPattern {
  notes: MelodyNote[]
  plans: PhrasePlan[]
  advancedMetrics?: AdvancedMelodyMetrics
  prosodyPlan?: ProsodyPlan
  seed: number
  opening: MelodyOpeningPlan
}

/**
 * Melody Candidate Diversity v1.2 + 冒頭設計: 選択したGenerator Profileごとに3つの独立Patternを生成する。
 * 各Patternはノート生成前にOpening Intent→Opening Planを持ち、冒頭数秒の聴感を明確に分ける。
 * 3案のOpening Intentは最初にまとめて計画し(Pattern番号への固定割り当てはしない)、
 * 生成後に冒頭類似度を測って閾値超過のPatternだけを別のIntent/seedで再生成する。
 */
export function generateFromChordsWithProfiles(input: GenerateProfileBatchInput): { candidates: ProfileCandidate[] } {
  const harmonicMap = buildHarmonicMap(input.chords)
  const results: ProfileCandidate[] = []
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

    // 指定のseedとOpening Intentから、そのProfileの1パターンを生成する(生成順序: Intent→Plan→本体)
    const buildOne = (patternSeed: number, intent: MelodyOpeningIntent): BuiltPattern => {
      const planRng = new SeededRandom(patternSeed ^ 0x5f3759df)
      const opening = openingIntentToPlan(planRng, intent, harmonicMap, input.range)

      if (kind === "bespoke") {
        const rng = new SeededRandom(patternSeed)
        if (profile === "elegiac-cantabile") {
          const noteDensity = nudgeTowardDNA(nudgeTowardDNA(0.34, uiDensityTarget, 0.6), dnaImpliedDensity, 0.35)
          const notes = generateElegiacCantabile(rng, harmonicMap, input.totalBeats, input.range, intensity, noteDensity, dna, opening)
          return { notes, plans: synthesizePhrasePlan(notes, input.totalBeats), advancedMetrics: computeAdvancedMelodyMetrics(notes, harmonicMap), seed: patternSeed, opening }
        }
        if (profile === "speech-rhythmic") {
          const repeatedNoteAmount = nudgeTowardDNA(0.82, dna?.repeatedNoteTendency, 0.4)
          const syncopationAmount = nudgeTowardDNA(0.76, baseParams.syncopationAmount, 0.5)
          const r = generateSpeechRhythmicPattern(rng, harmonicMap, input.totalBeats, input.range, intensity, repeatedNoteAmount, syncopationAmount, 0.68, 0.72, opening)
          return { notes: r.notes, plans: synthesizePhrasePlan(r.notes, input.totalBeats), advancedMetrics: computeAdvancedMelodyMetrics(r.notes, harmonicMap), prosodyPlan: r.prosodyPlan, seed: patternSeed, opening }
        }
        // incantatory
        const noteDensity = nudgeTowardDNA(nudgeTowardDNA(0.58, uiDensityTarget, 0.6), dnaImpliedDensity, 0.35)
        const r = generateIncantatoryPattern(rng, harmonicMap, input.totalBeats, input.range, intensity, noteDensity, dna, opening)
        const generic = computeAdvancedMelodyMetrics(r.notes, harmonicMap)
        const motifMutationRatio = 1 / r.plan.mutationPeriod
        return {
          notes: r.notes,
          plans: synthesizePhrasePlan(r.notes, input.totalBeats),
          advancedMetrics: { ...generic, motifMutationRatio, cyclicPhraseAmount: 0.8 + intensity * 0.15, mutationPeriodicity: r.plan.mutationPeriod / 8, contourRetention: 1 - motifMutationRatio },
          seed: patternSeed,
          opening,
        }
      }

      // parametric: 既存フレーズ生成エンジンをProfile専用パラメータ + Opening Planで駆動する
      const c = buildCandidate(patternSeed, baseInput, undefined, hook, opening)
      return { notes: c.notes, plans: c.plans, advancedMetrics: computeAdvancedMelodyMetrics(c.notes, harmonicMap), seed: c.seed, opening }
    }

    // 1) Profileに適した3つの異なるOpening Intentをまとめて計画する
    const intentRng = new SeededRandom(baseSeed ^ 0x9e3779b1)
    const intents = planOpeningIntents(intentRng, profile, 3)

    // 2) 各Intentで3パターン生成する
    const built: BuiltPattern[] = intents.map((intent, p) => buildOne(baseSeed + p * 7919, intent))

    // 3) 冒頭類似度が閾値を超えるPatternだけを、別のIntent/seedで再生成する(最大試行あり)
    for (let attempt = 1; attempt <= MAX_OPENING_REGEN_ATTEMPTS; attempt++) {
      let worstPair: [number, number] | null = null
      // 閾値ちょうど(0.70)に張り付く境界ケースも確実に閾値未満へ押し下げるため、
      // 実際の再生成トリガーは閾値より少し手前に置いてマージンを取る。
      let worstSim = OPENING_SIMILARITY_MAX - 0.03
      for (let a = 0; a < built.length; a++) {
        for (let b = a + 1; b < built.length; b++) {
          const sim = openingSimilarity({ notes: built[a].notes, plan: built[a].opening }, { notes: built[b].notes, plan: built[b].opening })
          if (sim > worstSim) {
            worstSim = sim
            worstPair = [a, b]
          }
        }
      }
      if (!worstPair) break
      // 重複ペアの後ろ側を、他2案と重複しない新しいIntent + 別seedで作り直す
      const target = worstPair[1]
      const others = built.filter((_, i) => i !== target).map((x) => x.opening.intent)
      const regenRng = new SeededRandom((built[target].seed ^ 0x85ebca6b) + attempt * 2654435761)
      const freshIntent = pickDistinctIntent(regenRng, profile, others)
      built[target] = buildOne(built[target].seed + attempt * 15485863, freshIntent)
    }

    built.forEach((pattern, i) =>
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
      }),
    )
  })

  return { candidates: results }
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
