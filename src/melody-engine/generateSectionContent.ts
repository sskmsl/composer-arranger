import { SeededRandom } from "@/core/rng"
import type { ChordEvent, SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type {
  ContentStructureFeatures,
  LeadContent,
  ResolvedLeadContent,
  SectionContentPlan,
  SectionContentSettings,
  SectionLayer,
} from "@/core/sectionContent"
import { LEAD_CONTENT_LABELS } from "@/core/sectionContent"
import { flattenLayerNotes } from "@/core/sectionLayers"
import { keyScalePitchClasses } from "@/core/scale"
import { buildHarmonicMap } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"
import { buildContentLayers } from "./contentGenerators"
import {
  computeContentStructureFeatures,
  contentSimilarity,
  CONTENT_SIMILARITY_MAX,
  validateContentStructure,
} from "./contentStructure"
import {
  planAutoContentBatch,
  planAutoReplacement,
  planReplacement,
  planSectionContentBatch,
  type ContentPlanContext,
} from "./sectionContentPlan"

const GENERATOR_VERSION = "2.1"

export interface GenerateSectionContentInput {
  chords: ChordEvent[]
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  content: SectionContentSettings
  range: RangeSetting
  totalBeats: number
  beatsPerBar: number
  seed: number
  key?: string
  candidateCount?: number
}

export interface SectionContentCandidate {
  patternIndex: 1 | 2 | 3
  content: ResolvedLeadContent
  plan: SectionContentPlan
  layers: SectionLayer[]
  notes: MelodyNote[]
  features: ContentStructureFeatures
  seed: number
  /** 構造検証で見つかった問題(空なら下限を満たしている) */
  problems: string[]
  /** 類似超過で作り直した回数 */
  regenerationAttempts: number
}

const MAX_CONTENT_REGEN_ATTEMPTS = 4

function buildContext(input: GenerateSectionContentInput): ContentPlanContext {
  return {
    totalBeats: input.totalBeats,
    beatsPerBar: input.beatsPerBar,
    sectionRole: input.sectionRole,
    songProfile: input.songProfile,
    harmonicMap: buildHarmonicMap(input.chords),
    range: input.range,
    keyScale: input.key ? keyScalePitchClasses(input.key) : [],
    requestedEntryOffsetBeats: input.content.entryOffsetBeats,
    requestedPickup: input.content.pickup,
  }
}

/**
 * Issue #41: melody以外のリード内容を、計画→専用Generator→構造検証の順で生成する。
 *
 * 3案は「同じPlanのseed違い」にしない。まず候補数ぶんの計画をまとめて決め、
 * 生成後に構造類似度を測り、閾値を超えた候補だけを
 * 「seedだけでなくContent Planも変えて」作り直す。
 */
export function generateSectionContent(input: GenerateSectionContentInput): {
  candidates: SectionContentCandidate[]
} {
  const count = input.candidateCount ?? 3
  const ctx = buildContext(input)
  const planRng = new SeededRandom(input.seed ^ 0x51ed270b)

  const plans =
    input.content.lead === "auto"
      ? planAutoContentBatch(planRng, ctx, count)
      : planSectionContentBatch(planRng, input.content.lead as ResolvedLeadContent, ctx, count)

  const build = (plan: SectionContentPlan, index: number, seed: number, attempts: number): SectionContentCandidate => {
    const layers = buildContentLayers(new SeededRandom(seed), plan, ctx, `${input.sectionId}:${index}`)
    const notes = flattenLayerNotes(layers)
    const features = computeContentStructureFeatures(notes, plan, input.totalBeats)
    const validation = validateContentStructure(features, plan, notes)
    return {
      patternIndex: (index + 1) as 1 | 2 | 3,
      content: plan.content,
      plan,
      layers,
      notes,
      features,
      seed,
      problems: validation.problems,
      regenerationAttempts: attempts,
    }
  }

  const candidates = plans.map((plan, index) => build(plan, index, input.seed + index * 7919, 0))

  // 類似超過の解消: 後ろ側の候補だけを、別の計画(=別の構造)で作り直す
  for (let attempt = 1; attempt <= MAX_CONTENT_REGEN_ATTEMPTS; attempt++) {
    let target = -1
    let worst = CONTENT_SIMILARITY_MAX
    for (let a = 0; a < candidates.length; a++) {
      for (let b = a + 1; b < candidates.length; b++) {
        const similarity = contentSimilarity(candidates[a].features, candidates[b].features).overall
        if (similarity >= worst) {
          worst = similarity
          target = b
        }
      }
    }
    if (target < 0) break

    // seedだけでなくPlanそのものを引き直す(同一Planのseed違いにしない)。
    // 作り直し対象以外の計画を「既存」として渡し、それらと構造が異なる計画を選ぶ。
    const replacementRng = new SeededRandom(input.seed ^ (0x9e3779b1 + attempt * 2654435761))
    const keptPlans = candidates.filter((_, i) => i !== target).map((candidate) => candidate.plan)
    const replacementPlan =
      input.content.lead === "auto"
        ? planAutoReplacement(replacementRng, ctx, keptPlans)
        : planReplacement(replacementRng, input.content.lead as ResolvedLeadContent, ctx, keptPlans)
    candidates[target] = build(
      replacementPlan,
      target,
      input.seed + target * 7919 + attempt * 15485863,
      attempt,
    )
  }

  return { candidates }
}

/** Issue #41: content候補をMelodyVariantへ変換する(既存の候補経路へ載せるため) */
export function toMelodyVariantFromContent(
  sectionId: string,
  songProfile: SongProfileId,
  candidate: SectionContentCandidate,
  batchId: string,
): MelodyVariant {
  return {
    id: crypto.randomUUID(),
    name: `${LEAD_CONTENT_LABELS[candidate.content]} · Pattern ${candidate.patternIndex}`,
    sectionId,
    sourceMode: "generate",
    notes: candidate.notes,
    // content候補は歌唱フレーズを前提としないため、フレーズ計画は全体1区間として持つ
    phrasePlans: [
      {
        phraseStartBeat: 0,
        phraseLengthBeats: Math.max(1, candidate.features.onsetPattern.at(-1) ?? 1),
        climaxBeat: candidate.plan.entryOffsetBeats,
        contour: "wave",
        restBeats: [],
        endTension: 0.5,
      },
    ],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: GENERATOR_VERSION,
    seed: candidate.seed,
    songProfile,
    parentMelodyId: null,
    batchId,
    createdAt: new Date().toISOString(),
    patternIndex: candidate.patternIndex,
    leadContent: candidate.content,
    contentPlan: candidate.plan,
    layers: candidate.layers,
    contentFeatures: candidate.features,
  }
}

/** そのセクション設定が、既存Melody Engineではなくcontent専用経路を通るか */
export function usesContentPipeline(lead: LeadContent): boolean {
  return lead !== "melody"
}
