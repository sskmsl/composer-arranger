import { SeededRandom } from "@/core/rng"
import type { ChordEvent, SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { MelodyNote, MelodyVariant, PhrasePlan } from "@/core/melody"
import { buildHarmonicMap } from "./harmonicMap"
import { resolveGenerationParams, type Density, type Drama, type RangeSetting } from "./generationParams"
import { assemblePhrase } from "./phraseAssembler"
import type { MotifCore } from "./motifCore"
import { computeMelodyFeatures } from "./features"
import { scoreCandidate } from "./scoring"
import { buildSignature, countDistinctCandidates, differenceCount, type DiversitySignature } from "./diversityFilter"

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

function buildCandidate(seed: number, input: GenerateFromChordsInput, forcedContourWeight?: number): Candidate {
  const rng = new SeededRandom(seed)
  const harmonicMap = buildHarmonicMap(input.chords)
  const params = resolveGenerationParams(input.songProfile, input.sectionRole, input.density, input.drama)
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
