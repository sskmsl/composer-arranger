import { SeededRandom } from "@/core/rng"
import type { ChordEvent, SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { MelodyNote, MelodyVariant, SongMotifDNA } from "@/core/melody"
import type {
  ContentQualityBreakdown,
  ContentSelectionDiagnostics,
  ContentStructureFeatures,
  LeadContent,
  ResolvedLeadContent,
  SectionContentPlan,
  SectionContentSettings,
  SectionLayer,
} from "@/core/sectionContent"
import { LEAD_CONTENT_LABELS, partRoleFor } from "@/core/sectionContent"
import { flattenLayerNotes } from "@/core/sectionLayers"
import { keyScalePitchClasses } from "@/core/scale"
import { buildHarmonicMap } from "./harmonicMap"
import { rangeWithClimaxReservation, resolveClimaxCeiling } from "./climaxReservation"
import type { Density, Drama, RangeSetting } from "./generationParams"
import { buildContentLayers, generatePickupNotes } from "./contentGenerators"
import { generateFromChords } from "./generateFromChords"
import {
  chordsForWindow,
  DEFAULT_PICKUP_BEATS,
  shiftNotesToSection,
  windowLengthBeats,
  type LeadWindow,
} from "./leadWindow"
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
import {
  contentQualityFloor,
  evaluateContentQuality,
  selectQualityDiverseContent,
} from "./sectionContentQuality"

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
  /**
   * Issue #41: 生成済みのサビ系メロディの最高音。
   * 未生成(undefined)ならSong Profileの予約幅へフォールバックする。
   */
  chorusPeakMidi?: number
  /** content="melody" をMelody Engineへ渡す際に使う生成設定 */
  density?: Density
  drama?: Drama
  /** Issue #63: 現在セクションの終わり方を次の役割へ合わせるための参照情報。 */
  nextSectionRole?: SectionRole
  nextSectionFirstChord?: string
  songMotifDNA?: SongMotifDNA
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
  /** Issue #63: Section Content専用の品質内訳。 */
  quality: ContentQualityBreakdown
  selection: ContentSelectionDiagnostics
}

const MAX_CONTENT_REGEN_ATTEMPTS = 4

function buildContext(input: GenerateSectionContentInput): ContentPlanContext {
  // Issue #41: 主旋律のクライマックス音高を予約し、その下だけを使って生成する。
  // サビ未生成でも例外にせず、Song Profileの予約幅へフォールバックする。
  const ceiling = resolveClimaxCeiling({
    sectionRole: input.sectionRole,
    songProfile: input.songProfile,
    range: input.range,
    chorusPeakMidi: input.chorusPeakMidi,
  })

  return {
    totalBeats: input.totalBeats,
    beatsPerBar: input.beatsPerBar,
    sectionRole: input.sectionRole,
    songProfile: input.songProfile,
    harmonicMap: buildHarmonicMap(input.chords),
    range: rangeWithClimaxReservation(input.range, ceiling),
    keyScale: input.key ? keyScalePitchClasses(input.key) : [],
    requestedEntryOffsetBeats: input.content.entryOffsetBeats,
    requestedPickup: input.content.pickup,
  }
}

/**
 * content="melody" の計画を、既存Melody Engineへ渡して実音を作る。
 *
 * entryOffset/pickup を尊重するため、窓の内側だけを生成対象にして
 * 生成後にセクション相対へ戻す。弱起は別Layerとして持つ。
 */
function buildMelodyLayers(
  rng: SeededRandom,
  plan: SectionContentPlan,
  input: GenerateSectionContentInput,
  ctx: ContentPlanContext,
  idPrefix: string,
): SectionLayer[] {
  const window: LeadWindow = {
    startBeat: plan.entryOffsetBeats,
    endBeat: Math.max(plan.entryOffsetBeats, input.totalBeats - plan.pickupBeats),
    pickupBeats: plan.pickupBeats,
  }
  const span = windowLengthBeats(window)
  const windowChords = chordsForWindow(input.chords, window)

  let notes: MelodyNote[] = []
  if (span > 0 && windowChords.length > 0) {
    const { candidates } = generateFromChords({
      chords: windowChords,
      sectionId: input.sectionId,
      sectionRole: input.sectionRole,
      songProfile: input.songProfile,
      density: input.density ?? "balanced",
      range: ctx.range,
      drama: input.drama ?? "growing",
      totalBeats: span,
      seed: rng.intBetween(1, 0x7fffffff),
      candidateCount: 1,
    })
    notes = shiftNotesToSection(candidates[0]?.notes ?? [], window)
  }

  const layers: SectionLayer[] = [
    {
      id: `${idPrefix}:primary`,
      partRole: partRoleFor("melody"),
      content: "melody",
      plan,
      notes,
      kind: "primary",
    },
  ]

  const pickupNotes = generatePickupNotes(rng, plan, ctx)
  if (pickupNotes.length > 0) {
    layers.push({
      id: `${idPrefix}:pickup`,
      partRole: "lead",
      content: "melody",
      plan,
      notes: pickupNotes,
      kind: "pickup",
    })
  }
  return layers
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
  unresolvedCandidates: SectionContentCandidate[]
  /** 開発用診断。未選抜候補を含むAuto候補プール。 */
  candidatePool: SectionContentCandidate[]
} {
  const count = input.candidateCount ?? 3
  const poolCount = input.content.lead === "auto" ? Math.max(9, count * 3) : count
  const ctx = buildContext(input)
  const planRng = new SeededRandom(input.seed ^ 0x51ed270b)

  const plans =
    input.content.lead === "auto"
      ? planAutoContentBatch(planRng, ctx, poolCount)
      : planSectionContentBatch(planRng, input.content.lead as ResolvedLeadContent, ctx, poolCount)

  const build = (
    plan: SectionContentPlan,
    index: number,
    seed: number,
    attempts: number,
  ): Omit<SectionContentCandidate, "quality" | "selection"> => {
    // Issue #41 / PR#43: contentごとに生成器をdispatchする。
    // buildContentLayers は motif/ostinato/drone しか実音を作らないため、
    // Autoがmelodyを選んだ計画をそこへ通すと空候補になってしまう
    // (chorus/grand-chorusはAutoの候補がmelodyのみなので3案すべて空になる)。
    const layers =
      plan.content === "melody"
        ? buildMelodyLayers(new SeededRandom(seed), plan, input, ctx, `${input.sectionId}:${index}`)
        : buildContentLayers(new SeededRandom(seed), plan, ctx, `${input.sectionId}:${index}`)
    const notes = flattenLayerNotes(layers)
    const features = computeContentStructureFeatures(notes, plan, input.totalBeats)
    // 構造検証は primary Layer の実音で行う。弱起を含めた合計で数えると、
    // primaryが0音でも pickup の音数で下限を満たし、生成失敗を見逃してしまう。
    // 同様に Drone のピッチクラス数なども弱起の音で汚れるため、専用の特徴量を使う。
    const primaryNotes = layers.find((layer) => layer.kind === "primary")?.notes ?? notes
    const primaryFeatures = computeContentStructureFeatures(primaryNotes, plan, input.totalBeats)
    const validation = validateContentStructure(primaryFeatures, plan, primaryNotes, input.totalBeats, notes)
    return {
      patternIndex: ((index % 3) + 1) as 1 | 2 | 3,
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

  const candidates = plans.map((plan, index) =>
    build(plan, index, input.seed + index * 7919, 0),
  )

  // 構造検証の失敗と類似超過を、どちらも作り直しの対象にする。
  // (検証結果を problems に置くだけでは、そのcontentとして成立していない候補が
  //  そのまま採用候補として返ってしまう)
  for (let attempt = 1; attempt <= MAX_CONTENT_REGEN_ATTEMPTS; attempt++) {
    // 1) 構造検証に失敗した候補を優先して作り直す
    let target = candidates.findIndex((candidate) => candidate.problems.length > 0)

    // 2) 検証は通っているが似すぎている場合は、後ろ側の候補を作り直す
    if (target < 0) {
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
    const replacement = build(
      replacementPlan,
      target,
      input.seed + target * 7919 + attempt * 15485863,
      attempt,
    )
    // 作り直しで構造を悪化させない。構造的妥当性は類似度より優先する。
    // (類似超過を直すために構造的に成立しない候補へ差し替えるのは本末転倒)
    // entryOffsetをセクション末尾に固定した等、どう計画しても成立しない設定では
    // 何度引き直しても失敗するため、元の候補を保持したまま試行回数を使い切る。
    const before = candidates[target].problems.length
    const after = replacement.problems.length
    if (after === 0 || after < before) candidates[target] = replacement
  }

  // 上限まで作り直しても成立しない場合は、その事実を呼び出し側へ返してUIで知らせる
  const qualityContext = {
    sectionRole: input.sectionRole,
    songProfile: input.songProfile,
    chords: input.chords,
    totalBeats: input.totalBeats,
    nextSectionRole: input.nextSectionRole,
    nextSectionFirstChord: input.nextSectionFirstChord,
    songMotifDNA: input.songMotifDNA,
  }
  const evaluated = candidates.map((candidate) => ({
    ...candidate,
    quality: evaluateContentQuality(candidate, qualityContext),
    selection: {
      qualityFloor: contentQualityFloor(candidate.content),
      selectionScore: null,
      selected: input.content.lead !== "auto",
      reason: "not-selected" as const,
      similarityToSelected: [],
    },
  }))

  const selection =
    input.content.lead === "auto"
      ? selectQualityDiverseContent(evaluated, count)
      : { selected: evaluated, evaluatedPool: evaluated }
  const selected = selection.selected.map((candidate, index) => ({
    ...candidate,
    patternIndex: (index + 1) as 1 | 2 | 3,
  }))
  const unresolved = selected.filter((candidate) => candidate.problems.length > 0)
  return {
    candidates: selected,
    /** 構造検証を満たせなかった候補(空なら全候補が下限を満たしている) */
    unresolvedCandidates: unresolved,
    candidatePool: selection.evaluatedPool,
  }
}

/**
 * Melody経路(Generator Profile)向けの弱起ノート。
 *
 * Generator Profileの生成はセクション全長ではなく窓の内側で行うため、
 * 弱起だけは別途この関数で作って別Layerとして足す。
 */
export function generateMelodyPickupNotes(
  seed: number,
  input: GenerateSectionContentInput,
): MelodyNote[] {
  if (!input.content.pickup) return []
  const ctx = buildContext(input)
  const rng = new SeededRandom(seed ^ 0x2545f491)
  const [plan] = planSectionContentBatch(rng, "melody", ctx, 1)
  return generatePickupNotes(rng, { ...plan, pickupBeats: DEFAULT_PICKUP_BEATS }, ctx)
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
    contentQuality: candidate.quality,
    contentSelection: candidate.selection,
  }
}

/** そのセクション設定が、既存Melody Engineではなくcontent専用経路を通るか */
export function usesContentPipeline(lead: LeadContent): boolean {
  return lead !== "melody"
}
