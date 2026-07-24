import { SeededRandom } from "@/core/rng"
import type { ChordEvent, SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { AdvancedMelodyMetrics, MelodyGeneratorProfile, MelodyNote, MelodyVariant, PhrasePlan, ProsodyPlan, SongMotifDNA } from "@/core/melody"
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
import { applyMotifDNA } from "./motifDNA"

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
}

interface Candidate {
  notes: MelodyNote[]
  plans: PhrasePlan[]
  score: number
  signature: DiversitySignature
  seed: number
}

const GENERATOR_VERSION = "1.0"

function buildCandidate(
  seed: number,
  input: GenerateFromChordsInput,
  forcedContourWeight?: number,
  paramsHook?: (params: GenerationParams) => GenerationParams,
): Candidate {
  const rng = new SeededRandom(seed)
  const harmonicMap = buildHarmonicMap(input.chords)
  let params = resolveGenerationParams(input.songProfile, input.sectionRole, input.density, input.drama)
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
}

export interface ProfileCandidate {
  notes: MelodyNote[]
  plans: PhrasePlan[]
  seed: number
  generatorProfile: MelodyGeneratorProfile
  patternIndex: 1 | 2 | 3
  advancedMetrics?: AdvancedMelodyMetrics
  prosodyPlan?: ProsodyPlan
}

/** Melody Candidate Diversity v1.2: 選択したGenerator Profileごとに3つの独立Patternを生成する */
export function generateFromChordsWithProfiles(input: GenerateProfileBatchInput): { candidates: ProfileCandidate[] } {
  const harmonicMap = buildHarmonicMap(input.chords)
  const results: ProfileCandidate[] = []

  input.profiles.forEach((profile, profileIdx) => {
    const kind = GENERATOR_PROFILE_KIND[profile]
    const intensity = generatorProfileIntensity(profile, input.sectionRole)
    const baseSeed = input.seed + profileIdx * 500009

    if (kind === "bespoke") {
      const patterns: { notes: MelodyNote[]; advancedMetrics?: AdvancedMelodyMetrics; prosodyPlan?: ProsodyPlan; seed: number }[] = []
      for (let p = 0; p < 3; p++) {
        const patternSeed = baseSeed + p * 7919
        const rng = new SeededRandom(patternSeed)

        if (profile === "elegiac-cantabile") {
          // 初期パラメータ(3.5): noteDensity 0.34
          const notes = generateElegiacCantabile(rng, harmonicMap, input.totalBeats, input.range, intensity, 0.34)
          patterns.push({ notes, advancedMetrics: computeAdvancedMelodyMetrics(notes, harmonicMap), seed: patternSeed })
        } else if (profile === "speech-rhythmic") {
          // 初期パラメータ(4.5): repeatedNoteAmount 0.82, syncopationAmount 0.76, pickupAmount 0.68, phraseAsymmetry 0.72
          const r = generateSpeechRhythmicPattern(rng, harmonicMap, input.totalBeats, input.range, intensity, 0.82, 0.76, 0.68, 0.72)
          patterns.push({
            notes: r.notes,
            advancedMetrics: computeAdvancedMelodyMetrics(r.notes, harmonicMap),
            prosodyPlan: r.prosodyPlan,
            seed: patternSeed,
          })
        } else {
          // incantatory 初期パラメータ(5.5): noteDensity 0.58
          const r = generateIncantatoryPattern(rng, harmonicMap, input.totalBeats, input.range, intensity, 0.58)
          const generic = computeAdvancedMelodyMetrics(r.notes, harmonicMap)
          const motifMutationRatio = 1 / r.plan.mutationPeriod
          patterns.push({
            notes: r.notes,
            advancedMetrics: {
              ...generic,
              motifMutationRatio,
              cyclicPhraseAmount: 0.8 + intensity * 0.15,
              mutationPeriodicity: r.plan.mutationPeriod / 8,
              contourRetention: 1 - motifMutationRatio,
            },
            seed: patternSeed,
          })
        }
      }
      patterns.forEach((pattern, i) =>
        results.push({
          notes: pattern.notes,
          plans: synthesizePhrasePlan(pattern.notes, input.totalBeats),
          seed: pattern.seed,
          generatorProfile: profile,
          patternIndex: (i + 1) as 1 | 2 | 3,
          advancedMetrics: pattern.advancedMetrics,
          prosodyPlan: pattern.prosodyPlan,
        }),
      )
    } else {
      // parametric: 既存フレーズ生成エンジンをProfile専用パラメータで駆動する
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
      }
      const hook = (params: GenerationParams) => applyMotifDNA(applyProfileOverride(params, profile, intensity), input.motifDNA)
      let candidates: Candidate[] = []
      for (let p = 0; p < 3; p++) {
        candidates.push(buildCandidate(baseSeed + p * 7919, baseInput, undefined, hook))
      }
      // 3案が潰れないよう、軽い多様性チェック(9.7と同じ仕組みを3案規模で適用)
      for (let pass = 0; pass < 2; pass++) {
        const signatures = candidates.map((c) => c.signature)
        if (countDistinctCandidates(signatures) >= 2) break
        for (let i = 0; i < candidates.length; i++) {
          const tooSimilar = candidates.some((other, j) => j !== i && differenceCount(candidates[i].signature, other.signature) < 2)
          if (tooSimilar) {
            const contourWeight = [0.5, 2.0][pass % 2] + i * 0.4
            candidates[i] = buildCandidate(baseSeed + i * 7919 + (pass + 1) * 104729, baseInput, contourWeight, hook)
          }
        }
      }
      candidates.forEach((c, i) =>
        results.push({
          notes: c.notes,
          plans: c.plans,
          seed: c.seed,
          generatorProfile: profile,
          patternIndex: (i + 1) as 1 | 2 | 3,
          advancedMetrics: computeAdvancedMelodyMetrics(c.notes, harmonicMap),
        }),
      )
    }
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
