/**
 * Reference Influence: 参考曲を「真似る」ためではなく、参考曲がなぜ魅力的かを抽象化した値だけを、
 * いまの曲の生成・評価の参考値として使うための仕組み。
 *
 * Reference Song → Reference Analysis(tools/reference-analysis) → 旋律・コード・リフ・音型は捨てる
 * → Reference Profile(0〜1 の一般化された特徴だけ) → いまの曲の Music Context へ最下位の層として合成
 * → 既存 Generator の重み・候補評価が少し動く → 新しいオリジナル案
 *
 * 判断の優先順位(上ほど強い):
 *   Boutonnat の考え方 → いまの曲・音楽的必然性 → セクションの役割 → Genre / Style → Aesthetic → Reference → Generator
 * Reference は現在の曲を上書きしない。影響量が High でも、特徴の値へ近づける割合に上限がある(MAX_BLEND)。
 * プロファイルには数値しか入らない(音列・コード・リズムの並びを保存する場所がない)。
 */

export const REFERENCE_PROFILE_VERSION = 1 as const

export interface ReferenceMelodyTraits {
  /** 核になる動機の長さ(0: 1拍程度 〜 1: 8拍程度) */
  motifLength: number
  /** 同じ動機・音型が戻ってくる度合い */
  repetition: number
  /** 1拍あたりの音の多さ(0: 疎 〜 1: 細かい) */
  noteDensity: number
  /** 休み・余白の多さ */
  restDensity: number
  /** リズムの個性(拍の裏や独特の音価の多さ) */
  rhythmicIdentity: number
  /** 曲の進行とともに音域が広がる度合い */
  registerExpansion: number
  /** 旋律の頂点の位置(0: 冒頭 〜 1: 最後) */
  climaxTiming: number
}

export interface ReferenceHarmonyTraits {
  /** コードが変わる速さ */
  harmonicRhythm: number
  /** 緊張(付加音・sus・七の和音など)の多さ */
  tension: number
  /** 属和音から主和音への解決の強さ */
  resolutionStrength: number
  /** ベースが動く度合い(0: 保続 〜 1: よく動く) */
  bassMovement: number
  /** 旋法的(ドリアン的な行き来・sus の反復)な傾向 */
  modalTendency: number
}

export interface ReferenceRhythmTraits {
  density: number
  syncopation: number
  /** 周期の反復がはっきりしている(グルーヴ)度合い */
  grooveTendency: number
}

export interface ReferenceArrangementTraits {
  /** 前景(旋律・短い音型)の密度 */
  foregroundDensity: number
  /** 後景の持続(長い音・パッド)の多さ */
  backgroundSustain: number
  /** 新しいフレーズ・合いの手が現れる頻度 */
  phraseFrequency: number
  /** セクション間の対比の大きさ */
  sectionContrast: number
  /** 音域の重心(0: 低域寄り 〜 1: 高域寄り) */
  registerBalance: number
}

export interface ReferenceAestheticTraits {
  depth: number
  decay: number
  transientSoftness: number
  stereoDiffusion: number
  /** 0: 暗い 〜 1: 明るい */
  darkLuminousBalance: number
  textureDensity: number
}

export interface ReferenceEmotionTraits {
  /** 抑制(頂点以外で抑えている度合い) */
  restraint: number
  /** 曲全体の緊張の弧(8点、0〜1)。形だけを持ち、実際の音量や時間は持たない */
  tensionCurve: number[]
  climaxTiming: number
  /** 頂点の後にどれだけ解き放つか */
  release: number
  /** 終わりの余韻の長さ */
  afterglow: number
}

export interface ReferenceProfile {
  version: typeof REFERENCE_PROFILE_VERSION
  id: string
  /** 利用者が付けた呼び名(端末内だけで使う。Generator には渡さない) */
  label: string
  createdAt: string
  /** どこから抽象化したか(種類と長さだけ。曲名やファイル名は持たない) */
  source: { kind: "audio" | "midi"; durationSeconds: number; tempoBpm: number | null }
  melody: ReferenceMelodyTraits
  harmony: ReferenceHarmonyTraits
  rhythm: ReferenceRhythmTraits
  arrangement: ReferenceArrangementTraits
  aesthetic: ReferenceAestheticTraits
  emotion: ReferenceEmotionTraits
  /** 分析の確からしさ(0〜1)。低いほど影響を弱める */
  confidence: Partial<Record<ReferenceApplyTarget, number>>
}

export const REFERENCE_APPLY_TARGETS = ["melody", "harmony", "rhythm", "bass", "arrangement", "aesthetic", "emotionalArc"] as const
export type ReferenceApplyTarget = (typeof REFERENCE_APPLY_TARGETS)[number]

export const REFERENCE_TARGET_LABELS: Record<ReferenceApplyTarget, string> = {
  melody: "旋律",
  harmony: "和声",
  rhythm: "リズム",
  bass: "ベース",
  arrangement: "アレンジ",
  aesthetic: "音像",
  emotionalArc: "感情の弧",
}

export type ReferenceInfluenceAmount = "low" | "moderate" | "high"

/** 影響量 → 特徴の値へ近づける割合。High でも半分強までで、いまの曲の判断を上書きしない */
export const INFLUENCE_WEIGHTS: Record<ReferenceInfluenceAmount, number> = { low: 0.2, moderate: 0.4, high: 0.6 }
/** 複数の参考曲を合わせても、1つの対象でこれ以上は近づけない */
export const MAX_BLEND = 0.6

/** どの参考曲を、どの用途に、どれだけ使うか。対象ごとに別の参考曲・別の量を選べる */
export interface ReferenceInfluenceSetting {
  profileId: string
  /** 使う対象と量。指定のない対象には使わない */
  targets: Partial<Record<ReferenceApplyTarget, ReferenceInfluenceAmount | number>>
}

/** 対象ごとに合成した参考値と、その強さ(0〜MAX_BLEND) */
export interface ResolvedReferenceTarget<T> {
  traits: T
  strength: number
}

export interface ResolvedReferenceInfluence {
  melody?: ResolvedReferenceTarget<ReferenceMelodyTraits>
  harmony?: ResolvedReferenceTarget<ReferenceHarmonyTraits>
  rhythm?: ResolvedReferenceTarget<ReferenceRhythmTraits>
  bass?: ResolvedReferenceTarget<Pick<ReferenceHarmonyTraits, "bassMovement">>
  arrangement?: ResolvedReferenceTarget<ReferenceArrangementTraits>
  aesthetic?: ResolvedReferenceTarget<ReferenceAestheticTraits>
  emotionalArc?: ResolvedReferenceTarget<ReferenceEmotionTraits>
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5))

function amountWeight(amount: ReferenceInfluenceAmount | number | undefined): number {
  if (amount === undefined) return 0
  if (typeof amount === "number") return Math.max(0, Math.min(MAX_BLEND, amount))
  return INFLUENCE_WEIGHTS[amount] ?? 0
}

function traitsFor(profile: ReferenceProfile, target: ReferenceApplyTarget): Record<string, number | number[]> {
  switch (target) {
    case "melody": return { ...profile.melody }
    case "harmony": return { ...profile.harmony }
    case "rhythm": return { ...profile.rhythm }
    case "bass": return { bassMovement: profile.harmony.bassMovement }
    case "arrangement": return { ...profile.arrangement }
    case "aesthetic": return { ...profile.aesthetic }
    case "emotionalArc": return { ...profile.emotion }
  }
}

/**
 * 複数の参考曲を、対象ごとに「抽象化された値の重み付き平均」として合成する。
 * 具体的な素材は最初から持っていないので、混ぜ合わせても素材が混ざることはない。
 */
export function resolveReferenceInfluence(
  profiles: readonly ReferenceProfile[],
  settings: readonly ReferenceInfluenceSetting[],
): ResolvedReferenceInfluence | null {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]))
  const resolved: ResolvedReferenceInfluence = {}
  for (const target of REFERENCE_APPLY_TARGETS) {
    const contributions = settings.flatMap((setting) => {
      const profile = byId.get(setting.profileId)
      const weight = amountWeight(setting.targets[target]) * clamp01(profile?.confidence[target] ?? 1)
      return profile && weight > 0 ? [{ traits: traitsFor(profile, target), weight }] : []
    })
    if (contributions.length === 0) continue
    const total = contributions.reduce((sum, item) => sum + item.weight, 0)
    const merged: Record<string, number | number[]> = {}
    for (const key of Object.keys(contributions[0].traits)) {
      const first = contributions[0].traits[key]
      if (Array.isArray(first)) {
        merged[key] = first.map((_, index) => contributions.reduce((sum, item) => sum + ((item.traits[key] as number[])[index] ?? 0.5) * item.weight, 0) / total)
      } else {
        merged[key] = contributions.reduce((sum, item) => sum + (item.traits[key] as number) * item.weight, 0) / total
      }
    }
    ;(resolved as Record<string, ResolvedReferenceTarget<unknown>>)[target] = {
      traits: merged,
      // 強さは足し合わせるが上限あり(参考曲を増やしても、いまの曲を押し切らない)
      strength: Math.min(MAX_BLEND, total),
    }
  }
  return Object.keys(resolved).length > 0 ? resolved : null
}

/** current を参考値 reference へ weight だけ近づける */
export function blendToward(current: number, reference: number, weight: number): number {
  return clamp01(current * (1 - weight) + clamp01(reference) * weight)
}

const NUMERIC_GROUPS = ["melody", "harmony", "rhythm", "arrangement", "aesthetic"] as const

/**
 * 読み込んだプロファイルを検証する。0〜1 の数値の特徴だけを受け付け、
 * 音列・コード・リズムの並びのような具体的な素材が含まれていたら受け付けない。
 */
export function parseReferenceProfile(value: unknown): ReferenceProfile {
  if (!value || typeof value !== "object") throw new Error("参考曲のプロファイルではありません")
  const source = value as Record<string, unknown>
  if (source.version !== REFERENCE_PROFILE_VERSION) throw new Error("このプロファイルの形式には対応していません")
  const forbidden = ["notes", "melodyNotes", "chords", "progression", "riff", "pattern", "midi", "pitches"]
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (forbidden.includes(key)) throw new Error(`具体的な素材(${path}${key})は受け付けません`)
      walk(child, `${path}${key}.`)
    }
  }
  walk(value, "")
  const numbers = (group: Record<string, unknown> | undefined, keys: string[]) => {
    if (!group) throw new Error("特徴の値が足りません")
    return Object.fromEntries(keys.map((key) => [key, clamp01(Number(group[key]))]))
  }
  const profile: ReferenceProfile = {
    version: REFERENCE_PROFILE_VERSION,
    id: String(source.id ?? `ref-${Date.now()}`),
    label: String(source.label ?? "参考曲"),
    createdAt: String(source.createdAt ?? new Date().toISOString()),
    source: {
      kind: (source.source as { kind?: string } | undefined)?.kind === "midi" ? "midi" : "audio",
      durationSeconds: Number((source.source as { durationSeconds?: number } | undefined)?.durationSeconds) || 0,
      tempoBpm: Number((source.source as { tempoBpm?: number } | undefined)?.tempoBpm) || null,
    },
    melody: numbers(source.melody as Record<string, unknown>, ["motifLength", "repetition", "noteDensity", "restDensity", "rhythmicIdentity", "registerExpansion", "climaxTiming"]) as unknown as ReferenceMelodyTraits,
    harmony: numbers(source.harmony as Record<string, unknown>, ["harmonicRhythm", "tension", "resolutionStrength", "bassMovement", "modalTendency"]) as unknown as ReferenceHarmonyTraits,
    rhythm: numbers(source.rhythm as Record<string, unknown>, ["density", "syncopation", "grooveTendency"]) as unknown as ReferenceRhythmTraits,
    arrangement: numbers(source.arrangement as Record<string, unknown>, ["foregroundDensity", "backgroundSustain", "phraseFrequency", "sectionContrast", "registerBalance"]) as unknown as ReferenceArrangementTraits,
    aesthetic: numbers(source.aesthetic as Record<string, unknown>, ["depth", "decay", "transientSoftness", "stereoDiffusion", "darkLuminousBalance", "textureDensity"]) as unknown as ReferenceAestheticTraits,
    emotion: (() => {
      const emotion = source.emotion as Record<string, unknown> | undefined
      if (!emotion) throw new Error("特徴の値が足りません")
      const curve = Array.isArray(emotion.tensionCurve) ? emotion.tensionCurve.slice(0, 8).map((point) => clamp01(Number(point))) : []
      return {
        restraint: clamp01(Number(emotion.restraint)),
        tensionCurve: curve.length === 8 ? curve : [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
        climaxTiming: clamp01(Number(emotion.climaxTiming)),
        release: clamp01(Number(emotion.release)),
        afterglow: clamp01(Number(emotion.afterglow)),
      }
    })(),
    confidence: Object.fromEntries(REFERENCE_APPLY_TARGETS.map((target) => [
      target,
      clamp01(Number((source.confidence as Record<string, unknown> | undefined)?.[target] ?? 1)),
    ])),
  }
  for (const group of NUMERIC_GROUPS) {
    for (const value of Object.values(profile[group])) if (!Number.isFinite(value)) throw new Error("特徴の値が数値ではありません")
  }
  return profile
}

/** 緊張の弧(8点)を 0〜1 の位置で読む */
export function sampleTensionCurve(curve: readonly number[], position: number): number {
  if (curve.length === 0) return .5
  const scaled = Math.max(0, Math.min(1, position)) * (curve.length - 1)
  const low = Math.floor(scaled)
  const high = Math.min(curve.length - 1, low + 1)
  return curve[low] + (curve[high] - curve[low]) * (scaled - low)
}

/** 感情の弧で動かせるエネルギー幅の上限。頂点の場所・人が決めた強さ・セクションの役割は動かさない */
const ARC_MAX_SHIFT = 12

/**
 * セクションのエネルギー(役割から推定した値)を、参考曲の緊張の弧の形へ少しだけ寄せる。
 * 頂点より前は「抑制」が強いほど抑え、頂点の後は「余韻」が長いほど静かに降りる。
 */
export function applyReferenceArc(
  energy: number,
  position: number,
  beforeClimax: boolean,
  arc: ResolvedReferenceTarget<ReferenceEmotionTraits> | undefined,
): number {
  if (!arc) return energy
  const { traits, strength } = arc
  const target = 20 + sampleTensionCurve(traits.tensionCurve, position) * 74
  const shape = (target - energy) * strength * .5
  const restraint = beforeClimax ? -(traits.restraint - .5) * 10 * strength : 0
  const afterglow = beforeClimax ? 0 : -(traits.afterglow - .5) * 8 * strength
  const shift = Math.max(-ARC_MAX_SHIFT, Math.min(ARC_MAX_SHIFT, shape + restraint + afterglow))
  return Math.max(10, Math.min(94, Math.round(energy + shift)))
}
