import type { SeededRandom } from "@/core/rng"
import type { SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { Midi } from "@/core/note"
import { pitchClass } from "@/core/note"
import { chordTonePitchClasses } from "@/core/chord"
import {
  AUTO_CONTENT_CANDIDATES,
  type ChordBoundaryResponse,
  type ContentDevelopmentStrategy,
  type ContentRegister,
  type ResolvedLeadContent,
  type SectionContentPlan,
} from "@/core/sectionContent"
import type { RangeSetting } from "./generationParams"
import type { HarmonicMapEntry } from "./harmonicMap"

/** 反復核の雛形。音程列と音価列を対で持つことで、音数の不一致が起きないようにする */
interface ContentCell {
  intervals: number[]
  durations: number[]
}

export interface ContentPlanContext {
  totalBeats: number
  beatsPerBar: number
  sectionRole: SectionRole
  songProfile: SongProfileId
  harmonicMap: HarmonicMapEntry[]
  range: RangeSetting
  keyScale: number[]
  /** セクション設定で明示されたentryOffset。0以外なら候補間で動かさずそのまま尊重する */
  requestedEntryOffsetBeats: number
  requestedPickup: boolean
}

/**
 * Motifの核: 2〜5音の識別可能な単位。
 * 通常の歌唱フレーズへ展開しすぎないよう、いずれも短く、音数と輪郭の型が互いに異なる。
 */
const MOTIF_CELLS: ContentCell[] = [
  { intervals: [4, -2], durations: [1, 1, 2] }, // 3音・上って寄りかかる
  { intervals: [-5, 2], durations: [0.5, 1.5, 1] }, // 3音・4度下降から戻す
  { intervals: [2, 2, -7], durations: [1, 0.5, 0.5, 2] }, // 4音・順次上昇から跳躍で放す
  { intervals: [7], durations: [2, 3] }, // 2音・裸の5度(最も象徴的)
  { intervals: [1, 3, -1, -2], durations: [0.5, 0.5, 1, 1, 1] }, // 5音・半音を含む回音
  { intervals: [-2, -2], durations: [1.5, 1.5, 3] }, // 3音・下降のみ
]

/** Ostinatoの音高セル(基準音からの半音オフセット)。Rhythmとは独立に計画する */
const OSTINATO_PITCH_CELLS: number[][] = [
  [0, 7, 0, 4],
  [0, 3, 7, 3],
  [0, 5, 0, -5],
  [0, 2, 4, 2],
  [0, 7, 12, 7],
]

/** Ostinatoのリズムセル(セル内オンセット位置と音価)。音高セルとは別々に選ぶ */
const OSTINATO_RHYTHM_CELLS: { onsets: number[]; durations: number[] }[] = [
  { onsets: [0, 1, 2, 3], durations: [1, 1, 1, 1] },
  { onsets: [0, 0.75, 1.5, 2.5], durations: [0.75, 0.75, 1, 1.5] },
  { onsets: [0, 1.5, 2, 3.5], durations: [1.5, 0.5, 1.5, 0.5] },
  { onsets: [0, 0.5, 1, 2, 2.5], durations: [0.5, 0.5, 1, 0.5, 1.5] },
  { onsets: [0, 2, 3], durations: [2, 1, 1] },
]

const REGISTER_ROTATION: ContentRegister[] = ["middle", "high", "low"]

/** 候補ごとに必ず別の値を引くための回転選択(pool長 >= 候補数なら3案とも異なる) */
function rotate<T>(pool: readonly T[], offset: number, index: number, stride = 1): T {
  return pool[(offset + index * stride) % pool.length]
}

/** rangeを重なりのある3区画へ割り、registerを実音域へ落とす */
export function registerWindow(range: RangeSetting, register: ContentRegister): { low: Midi; high: Midi } {
  const span = Math.max(1, range.high - range.low)
  const third = span / 3
  if (register === "low") return { low: range.low, high: Math.round(range.low + third * 1.5) }
  if (register === "high") return { low: Math.round(range.high - third * 1.5), high: range.high }
  return { low: Math.round(range.low + third * 0.5), high: Math.round(range.high - third * 0.5) }
}

/** 全コードに共通して含まれるピッチクラス(Droneの保持音として最も安全) */
export function commonPitchClassesAcrossChords(harmonicMap: HarmonicMapEntry[]): number[] {
  if (harmonicMap.length === 0) return []
  let common = chordTonePitchClasses(harmonicMap[0].parsed)
  for (const entry of harmonicMap.slice(1)) {
    const tones = chordTonePitchClasses(entry.parsed)
    common = common.filter((pc) => tones.includes(pc))
  }
  return common
}

/** Droneの保持音候補を優先順に並べる(共通音 → 主和音のroot/5th → Key音階) */
function dronePitchCandidates(ctx: ContentPlanContext): number[] {
  const common = commonPitchClassesAcrossChords(ctx.harmonicMap)
  const first = ctx.harmonicMap[0]?.parsed
  const rootAndFifth = first ? [first.rootPc, (first.rootPc + 7) % 12] : []
  const ordered = [...common, ...rootAndFifth, ...ctx.keyScale]
  return [...new Set(ordered)]
}

function motifPitchVocabulary(ctx: ContentPlanContext): number[] {
  const chordTones = ctx.harmonicMap.flatMap((entry) => chordTonePitchClasses(entry.parsed))
  const pool = [...new Set([...chordTones, ...ctx.keyScale])]
  return pool.length > 0 ? pool : [0, 2, 4, 5, 7, 9, 11]
}

/**
 * Song Profileごとの保持傾向。Drone/Ostinatoの sustain 目標と、
 * Motifの余白の広さへ軽く効かせる(固有名詞は使わず傾向値としてのみ扱う)。
 */
const PROFILE_SUSTAIN_BIAS: Record<SongProfileId, number> = {
  "dark-romantic": 0.1,
  "cinematic-french-pop": 0.05,
  "minimal-tension": 0.15,
  "dramatic-synth-pop": -0.05,
  "original-custom": 0,
}

/**
 * Issue #41: contentごとの構造計画を、実音を作る前に候補数ぶんまとめて決める。
 *
 * 3案を「同じPlanのseed違い」にしないため、各軸をpoolからの回転選択で割り当て、
 * 少なくとも cell(音程列/音価列) / register / 反復回数 / 展開戦略 の4軸が
 * 候補間で構造的に異なることを設計上保証する。
 * Pattern番号への固定割り当てはせず、回転の起点はseedから決める。
 */
export function planSectionContentBatch(
  rng: SeededRandom,
  content: ResolvedLeadContent,
  ctx: ContentPlanContext,
  count: number,
): SectionContentPlan[] {
  const offset = rng.intBetween(0, 11)
  const sustainBias = PROFILE_SUSTAIN_BIAS[ctx.songProfile] ?? 0
  const plans: SectionContentPlan[] = []
  for (let i = 0; i < count; i++) {
    plans.push(planOne(content, ctx, offset, i, sustainBias))
  }
  return plans
}

/** 単一候補の計画。呼び出し側の回転起点(offset)とindexで軸をずらす */
function planOne(
  content: ResolvedLeadContent,
  ctx: ContentPlanContext,
  offset: number,
  index: number,
  sustainBias: number,
): SectionContentPlan {
  const register = rotate(REGISTER_ROTATION, offset, index)
  const entryOffsetBeats = resolveEntryOffset(ctx, content, offset, index)
  const pickupBeats = resolvePickupBeats(ctx, offset, index)
  const base = {
    content,
    entryOffsetBeats,
    pickupBeats,
    register,
  }

  if (content === "melody") {
    // 既存Melody Engineが実音を作るため、ここでは入口と余白の条件だけを持つ。
    // 他contentの共通Base Melodyとしては使わない。
    return {
      ...base,
      pitchVocabulary: motifPitchVocabulary(ctx),
      rhythmGrammar: "melody-phrase",
      recurrenceStrategy: "phrase",
      developmentStrategy: "develop",
      chordBoundaryResponse: "follow",
      cellLengthBeats: 0,
      repetitionCount: 0,
      sustainRatioTarget: Math.max(0, 0.15 + sustainBias),
      motifIntervals: [],
      cellDurations: [],
      restBeats: [],
    }
  }

  if (content === "motif") {
    const cell = rotate(MOTIF_CELLS, offset, index)
    const cellLengthBeats = cell.durations.reduce((sum, d) => sum + d, 0)
    // sparse-return: 反復と反復の間に明確な余白を置く。余白量も候補間で変える
    const gapPool = [ctx.beatsPerBar, ctx.beatsPerBar * 0.5, ctx.beatsPerBar * 1.5]
    const gap = rotate(gapPool, offset, index, 2)
    const usable = Math.max(0, ctx.totalBeats - entryOffsetBeats - pickupBeats)
    // 最後の提示のあとに余白は要らないので、gapは反復の「間」の数だけ数える
    const repetitionCount = Math.max(1, Math.floor((usable + gap) / (cellLengthBeats + gap)))
    return {
      ...base,
      pitchVocabulary: motifPitchVocabulary(ctx),
      rhythmGrammar: `motif-sparse-return-${cell.durations.length}`,
      recurrenceStrategy: "sparse-return",
      developmentStrategy: rotate<ContentDevelopmentStrategy>(["fragment", "develop", "mutate-cycle"], offset, index),
      chordBoundaryResponse: rotate<ChordBoundaryResponse>(["follow", "anticipate", "hold-through"], offset, index, 2),
      cellLengthBeats,
      repetitionCount,
      sustainRatioTarget: Math.max(0, Math.min(1, 0.25 + sustainBias)),
      motifIntervals: cell.intervals,
      cellDurations: cell.durations,
      restBeats: [gap],
    }
  }

  if (content === "ostinato") {
    // 音高セルとリズムセルを別strideで回すことで、組み合わせも候補間で重複しにくくする
    const pitchCell = rotate(OSTINATO_PITCH_CELLS, offset, index)
    const rhythmCell = rotate(OSTINATO_RHYTHM_CELLS, offset, index, 2)
    const cellLengthBeats = Math.max(
      ...rhythmCell.onsets.map((onset, k) => onset + rhythmCell.durations[k]),
      ctx.beatsPerBar,
    )
    const usable = Math.max(0, ctx.totalBeats - entryOffsetBeats - pickupBeats)
    // 最低2周期は必ず確保する(周期性がMotifの疎な反復と区別できる条件)
    const repetitionCount = Math.max(2, Math.floor(usable / cellLengthBeats))
    return {
      ...base,
      pitchVocabulary: motifPitchVocabulary(ctx),
      rhythmGrammar: `ostinato-cycle-${cellLengthBeats}`,
      recurrenceStrategy: "periodic-cycle",
      developmentStrategy: "mutate-cycle",
      chordBoundaryResponse: rotate<ChordBoundaryResponse>(["follow", "hold-through", "anticipate"], offset, index),
      cellLengthBeats,
      repetitionCount,
      sustainRatioTarget: Math.max(0, Math.min(1, 0.2 + sustainBias)),
      motifIntervals: pitchCell,
      cellDurations: rhythmCell.durations,
      restBeats: rhythmCell.onsets,
    }
  }

  if (content === "drone") {
    const candidates = dronePitchCandidates(ctx)
    // 保持音の分割数。少ないほど1音が長い
    const holdCount = rotate([1, 2, 3], offset, index, 2)
    // 使用ピッチクラスは原則1〜2種類。何番目の候補を主音にするかも候補間で変える。
    // 保持数より多いピッチクラスは実音として現れないため、holdCountで抑える
    // (計画が約束する語彙と実際に鳴る語彙を一致させる)。
    const pitchClassCount = Math.min(rotate([1, 2, 1], offset, index), holdCount)
    const primary = candidates[(offset + index) % Math.max(1, candidates.length)] ?? 0
    const secondary = candidates[(offset + index + 1) % Math.max(1, candidates.length)] ?? (primary + 7) % 12
    const vocabulary = pitchClassCount === 1 ? [primary] : [primary, secondary]
    const usable = Math.max(0, ctx.totalBeats - entryOffsetBeats)
    return {
      ...base,
      pitchVocabulary: [...new Set(vocabulary.map((pc) => ((pc % 12) + 12) % 12))],
      rhythmGrammar: `drone-sustain-${holdCount}`,
      recurrenceStrategy: "sustain",
      developmentStrategy: "hold",
      // Droneはコード境界をまたいで保持するのが本質。境界での再スナップ・分割はしない
      chordBoundaryResponse: "hold-through",
      cellLengthBeats: holdCount > 0 ? usable / holdCount : usable,
      repetitionCount: holdCount,
      sustainRatioTarget: Math.max(0, Math.min(1, 0.9 + sustainBias)),
      motifIntervals: [],
      cellDurations: [],
      restBeats: [],
    }
  }

  // none: リードは鳴らさない。pickupが有効な場合のみ別Layerで弱起だけを作る
  return {
    ...base,
    pitchVocabulary: motifPitchVocabulary(ctx),
    rhythmGrammar: "none",
    recurrenceStrategy: "none",
    developmentStrategy: "none",
    chordBoundaryResponse: "follow",
    cellLengthBeats: 0,
    repetitionCount: 0,
    sustainRatioTarget: 0,
    motifIntervals: [],
    cellDurations: [],
    restBeats: [],
  }
}

/**
 * entryOffsetの決定。セクション設定で明示された値があればそれを尊重し、
 * 未指定(0)のときだけ、遅い入場が音楽的に意味を持つcontentで候補間の差として使う。
 */
function resolveEntryOffset(
  ctx: ContentPlanContext,
  content: ResolvedLeadContent,
  offset: number,
  index: number,
): number {
  if (ctx.requestedEntryOffsetBeats > 0) {
    return Math.min(ctx.requestedEntryOffsetBeats, ctx.totalBeats)
  }
  if (content === "melody") return 0
  const delayPool =
    content === "none"
      ? [ctx.totalBeats - 1, ctx.totalBeats - ctx.beatsPerBar, ctx.totalBeats]
      : [0, ctx.beatsPerBar, ctx.beatsPerBar * 2]
  const delay = rotate(delayPool, offset, index)
  return Math.max(0, Math.min(ctx.totalBeats, delay))
}

/** 弱起の長さ。指定が無ければ0。候補間で位置(長さ)を変える */
function resolvePickupBeats(ctx: ContentPlanContext, offset: number, index: number): number {
  if (!ctx.requestedPickup) return 0
  const pool = [1, 1.5, 2]
  return Math.min(rotate(pool, offset, index), Math.max(0, ctx.totalBeats - 0.5))
}

/**
 * 類似超過の候補を作り直すための代替計画。
 *
 * 単に index を増やすだけでは、poolの長さで剰余が回って既存候補と同じ計画に
 * 戻ってしまう(pool長3に対する index 3 は index 0 と同一)。これは
 * 「seedだけ変えた作り直し」と実質同じなので、回転起点(offset)を総当たりし、
 * 既存のどの計画からも minDifference 項目以上異なるものを選ぶ。
 */
export function planReplacement(
  rng: SeededRandom,
  content: ResolvedLeadContent,
  ctx: ContentPlanContext,
  existing: SectionContentPlan[],
  minDifference = 3,
): SectionContentPlan {
  const sustainBias = PROFILE_SUSTAIN_BIAS[ctx.songProfile] ?? 0
  const startOffset = rng.intBetween(0, 11)
  let best: SectionContentPlan | null = null
  let bestScore = -1

  // offset × index の組み合わせを走査し、既存との最小差が最大になる計画を採る
  for (let step = 0; step < 12; step++) {
    const offset = (startOffset + step) % 12
    for (let index = 0; index < 3; index++) {
      const candidate = planOne(content, ctx, offset, index, sustainBias)
      const minDiff = existing.length
        ? Math.min(...existing.map((plan) => planDifferenceCount(plan, candidate)))
        : Number.POSITIVE_INFINITY
      if (minDiff >= minDifference) return candidate
      if (minDiff > bestScore) {
        bestScore = minDiff
        best = candidate
      }
    }
  }
  // 構造の自由度が足りず閾値に届かない場合は、最も違う計画を返す
  return best ?? planOne(content, ctx, startOffset, 0, sustainBias)
}

/**
 * Auto: そのSectionに適したcontentを列挙し、候補数ぶんの計画をまとめて決める。
 *
 * Pattern番号へgrammarを固定割り当てせず(Pattern1=Motif等はしない)、
 * Song Profile・コード進行・セクション長・使用可能音域から毎回妥当な組み合わせを作る。
 * 3案では最低2種類以上のcontentを提示する。
 */
export function planAutoContentBatch(
  rng: SeededRandom,
  ctx: ContentPlanContext,
  count: number,
): SectionContentPlan[] {
  const pool = autoContentCandidates(ctx)
  const offset = rng.intBetween(0, pool.length - 1)
  const sustainBias = PROFILE_SUSTAIN_BIAS[ctx.songProfile] ?? 0

  // 最低2種類のcontentを保証するため、poolを回転させながら割り当てる
  const contents: ResolvedLeadContent[] = []
  for (let i = 0; i < count; i++) contents.push(pool[(offset + i) % pool.length])
  if (new Set(contents).size < Math.min(2, count) && pool.length > 1) {
    contents[contents.length - 1] = pool[(offset + 1) % pool.length]
  }

  // 同じcontentが複数回選ばれた場合も、その中で構造が重複しないよう出現順をindexにする
  const seenPerContent = new Map<ResolvedLeadContent, number>()
  const planOffset = rng.intBetween(0, 11)
  return contents.map((content) => {
    const seen = seenPerContent.get(content) ?? 0
    seenPerContent.set(content, seen + 1)
    return planOne(content, ctx, planOffset, seen, sustainBias)
  })
}

/**
 * Auto用の代替計画。まず別のcontentを試し(contentが変われば文法自体が変わる)、
 * 候補が1種類しかない場合は同一content内で構造の異なる計画を選ぶ。
 */
export function planAutoReplacement(
  rng: SeededRandom,
  ctx: ContentPlanContext,
  existing: SectionContentPlan[],
  minDifference = 3,
): SectionContentPlan {
  const pool = autoContentCandidates(ctx)
  const used = new Set(existing.map((plan) => plan.content))
  const unused = pool.filter((content) => !used.has(content))
  const order = [...unused, ...pool]
  for (const content of order) {
    const candidate = planReplacement(rng, content, ctx, existing, minDifference)
    const minDiff = existing.length
      ? Math.min(...existing.map((plan) => planDifferenceCount(plan, candidate)))
      : Number.POSITIVE_INFINITY
    if (minDiff >= minDifference) return candidate
  }
  return planReplacement(rng, order[0] ?? "melody", ctx, existing, minDifference)
}

/**
 * セクションの状況から、Autoが選んでよいcontentを絞る。
 * 短すぎるセクションでOstinatoの周期が成立しない等、構造的に無理な選択を除く。
 */
export function autoContentCandidates(ctx: ContentPlanContext): ResolvedLeadContent[] {
  const base = AUTO_CONTENT_CANDIDATES[ctx.sectionRole] ?? ["melody"]
  const filtered = base.filter((content) => {
    // Ostinatoは最低2周期(1周期=最小1小節)が入る長さを要求する
    if (content === "ostinato") return ctx.totalBeats >= ctx.beatsPerBar * 2
    // Droneは保持の意味が出る長さを要求する
    if (content === "drone") return ctx.totalBeats >= ctx.beatsPerBar
    // noneはリードを持たないため、伴奏か弱起のどちらかが鳴る余地を要求する
    if (content === "none") return ctx.totalBeats >= 1
    return true
  })
  return filtered.length > 0 ? filtered : ["melody"]
}

/** 計画のうち、候補間で異なっていることを数える構造項目 */
export function planStructuralSignature(plan: SectionContentPlan): Record<string, string> {
  return {
    entryOffset: plan.entryOffsetBeats.toFixed(3),
    register: plan.register,
    pitchVocabulary: [...plan.pitchVocabulary].sort((a, b) => a - b).join(","),
    motifIntervals: plan.motifIntervals.join(","),
    cellDurations: plan.cellDurations.join(","),
    cellLength: plan.cellLengthBeats.toFixed(3),
    repetitionCount: String(plan.repetitionCount),
    restBeats: plan.restBeats.map((b) => b.toFixed(3)).join(","),
    sustainRatio: plan.sustainRatioTarget.toFixed(3),
    development: plan.developmentStrategy,
    pickup: plan.pickupBeats.toFixed(3),
    boundary: plan.chordBoundaryResponse,
  }
}

/** 2つの計画が構造的に異なる項目数(受け入れ条件「最低3項目」の判定に使う) */
export function planDifferenceCount(a: SectionContentPlan, b: SectionContentPlan): number {
  const sa = planStructuralSignature(a)
  const sb = planStructuralSignature(b)
  return Object.keys(sa).filter((key) => sa[key] !== sb[key]).length
}

/** pitchVocabularyへ収まる、基準音に最も近いMIDIノート */
export function snapToVocabulary(
  candidate: Midi,
  vocabulary: readonly number[],
  window: { low: Midi; high: Midi },
): Midi {
  if (vocabulary.length === 0) return Math.max(window.low, Math.min(window.high, Math.round(candidate)))
  const target = Math.max(window.low, Math.min(window.high, Math.round(candidate)))
  if (vocabulary.includes(pitchClass(target))) return target
  for (let d = 1; d <= 12; d++) {
    const up = target + d
    const down = target - d
    if (up <= window.high && vocabulary.includes(pitchClass(up))) return up
    if (down >= window.low && vocabulary.includes(pitchClass(down))) return down
  }
  return target
}
