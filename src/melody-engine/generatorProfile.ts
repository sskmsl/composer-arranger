import type { MelodyGeneratorProfile } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import type { GenerationParams } from "./generationParams"

/**
 * Melody Candidate Diversity v1.2: Generator Profile(作曲文法の切り替え)の共通定義。
 * Song Profile(曲全体の感情方向)やSection Role(セクション別ルール)とは独立した軸。
 * ここに列挙する9種で完成形とし、新規Profileの追加は優先しない(Scope Control)。
 */
export const GENERATOR_PROFILES: MelodyGeneratorProfile[] = [
  "standard",
  "minimal",
  "leaping",
  "rhythmic",
  "chromatic",
  "cinematic",
  "elegiac-cantabile",
  "speech-rhythmic",
  "incantatory",
]

export const GENERATOR_PROFILE_LABELS: Record<MelodyGeneratorProfile, string> = {
  standard: "Standard",
  minimal: "Minimal",
  leaping: "Leaping",
  rhythmic: "Rhythmic",
  chromatic: "Chromatic",
  cinematic: "Cinematic",
  "elegiac-cantabile": "Elegiac Cantabile",
  "speech-rhythmic": "Speech-Rhythmic",
  incantatory: "Incantatory",
}

/** 固有名詞・特定ジャンル名を使わない、旋律語彙としての説明(7.3) */
export const GENERATOR_PROFILE_DESCRIPTIONS: Record<MelodyGeneratorProfile, string> = {
  standard: "コード進行に沿ったバランス型の旋律を優先",
  minimal: "静けさと余白、少ない音数を優先",
  leaping: "跳躍と起伏の大きい輪郭を優先",
  rhythmic: "リズムの識別性と推進力を優先",
  chromatic: "半音階的な経過音とテンションを優先",
  cinematic: "複数小節にわたる展開とクライマックス設計を優先",
  "elegiac-cantabile": "長い旋律弧と遅延解決を優先",
  "speech-rhythmic": "狭い音域と発話アクセントを優先",
  incantatory: "短い核モチーフの反復と微細な変形を優先",
}

export type GeneratorProfilePlanningPriority =
  | "pitch-led"
  | "rhythm-led"
  | "target-tone-led"
  | "cycle-led"

export type GeneratorProfileIdentityMetric =
  | "chordToneUsageRatio"
  | "restRatio"
  | "avgLeap"
  | "syncopationRatio"
  | "tensionUsageRatio"
  | "pitchRange"
  | "delayedResolutionRatio"
  | "repeatedNoteRatio"
  | "motifRepeatRatio"

export interface GeneratorProfileIdentityComparison {
  metric: GeneratorProfileIdentityMetric
  reference: MelodyGeneratorProfile
  direction: "greater" | "less"
}

/**
 * Issue #68: Profileの名前・説明だけでなく、生成順序と守るべき音楽的性格を一箇所で定義する。
 * param override・専用生成器・Opening Strategyはこの契約を実音化する手段であり、
 * 共通補正や候補選抜はprotectedTraitsを均してはならない。
 */
export interface GeneratorProfileRule {
  /** 実装上の関数呼び出し順ではなく、音楽設計で先に守る判断軸。 */
  planningPriority: GeneratorProfilePlanningPriority
  pitchTendency: string
  rhythmTendency: string
  registerTendency: string
  restTendency: string
  endingTendency: string
  protectedTraits: readonly string[]
  /** 最終品質にProfile適合度を混ぜる比率。品質下限を維持したうえで固有色を選抜へ残す。 */
  selectionFitWeight: number
  identityComparison: GeneratorProfileIdentityComparison
}

export const GENERATOR_PROFILE_RULES: Record<MelodyGeneratorProfile, GeneratorProfileRule> = {
  standard: {
    planningPriority: "pitch-led",
    pitchTendency: "コードトーン主体。順次進行を中心に、説明可能な経過音とテンションを許可する",
    rhythmTendency: "強弱拍が明確なbalanced rhythm。規則性と変化を両立する",
    registerTendency: "指定音域の中央を基準に、SectionとDNAの輪郭へ追従する",
    restTendency: "中程度。フレーズ呼吸を作るが推進を止めすぎない",
    endingTendency: "Sectionのend tensionに従い、解決と継続を使い分ける",
    protectedTraits: ["歌唱性", "和声の明瞭さ", "過度に偏らない輪郭"],
    selectionFitWeight: 0.25,
    identityComparison: { metric: "chordToneUsageRatio", reference: "chromatic", direction: "greater" },
  },
  minimal: {
    planningPriority: "cycle-led",
    pitchTendency: "狭い音域の共通音・5th・9thを優先し、大跳躍を抑える",
    rhythmTendency: "長音と反復を主体に、音数より沈黙の配置で差を作る",
    registerTendency: "中央付近のcontained register",
    restTendency: "多い。弱拍側の余白と長い呼吸を優先する",
    endingTendency: "open / suspendedを許し、余韻を残す",
    protectedTraits: ["余白", "狭い音域", "長音", "低い跳躍率"],
    selectionFitWeight: 0.3,
    identityComparison: { metric: "restRatio", reference: "standard", direction: "greater" },
  },
  leaping: {
    planningPriority: "pitch-led",
    pitchTendency: "構造点に跳躍を置き、直後は反行の順次進行で回収する",
    rhythmTendency: "跳躍が知覚できる長さを確保し、全音を跳躍にはしない",
    registerTendency: "中音域から広い輪郭へ展開する",
    restTendency: "中〜少量。跳躍前後の輪郭を分断しない",
    endingTendency: "終止直前は歌唱可能な接続へ戻す",
    protectedTraits: ["構造跳躍", "跳躍後の回収", "広い輪郭"],
    selectionFitWeight: 0.45,
    identityComparison: { metric: "avgLeap", reference: "standard", direction: "greater" },
  },
  rhythmic: {
    planningPriority: "rhythm-led",
    pitchTendency: "リズム識別性を妨げない反復音・小さな音程セルを許可する",
    rhythmTendency: "弱起、裏拍、拍またぎ、シンコペーションを明確に使う",
    registerTendency: "中程度。音域差よりリズム骨格を優先する",
    restTendency: "短い切れ目をアクセントとして使い、強拍の無作為な欠落は避ける",
    endingTendency: "rhythmic peakまたはcarry-forwardを許可する",
    protectedTraits: ["裏拍アタック", "拍またぎ", "識別可能なリズムセル"],
    selectionFitWeight: 0.35,
    identityComparison: { metric: "syncopationRatio", reference: "standard", direction: "greater" },
  },
  chromatic: {
    planningPriority: "target-tone-led",
    pitchTendency: "倚音・半音接近・掛留を解決先と組にして使う",
    rhythmTendency: "非和声音の準備と解決が聞こえる音価を確保する",
    registerTendency: "中音域を中心に半音進行の連続性を保つ",
    restTendency: "解決の因果関係を切らない範囲の余白",
    endingTendency: "suspended / openを許すが、無意味な未解決音は残さない",
    protectedTraits: ["計画された非和声音", "半音接近", "遅延解決"],
    selectionFitWeight: 0.3,
    identityComparison: { metric: "tensionUsageRatio", reference: "standard", direction: "greater" },
  },
  cinematic: {
    planningPriority: "pitch-led",
    pitchTendency: "冒頭を抑制し、複数小節の弧の中で構造音を上昇させる",
    rhythmTendency: "長音と呼吸を使い、クライマックス前後の時間差を作る",
    registerTendency: "低〜中音域から広いrange trajectoryへ展開する",
    restTendency: "頂点前のsilenceを含む構造的な休符",
    endingTendency: "open / carry-forwardを含め、次Sectionへの展開を保つ",
    protectedTraits: ["長期的な音域展開", "頂点前の余白", "最高音の希少性"],
    selectionFitWeight: 0.3,
    identityComparison: { metric: "pitchRange", reference: "minimal", direction: "greater" },
  },
  "elegiac-cantabile": {
    planningPriority: "target-tone-led",
    pitchTendency: "Motif Seedを遅延回帰・断片化し、2〜4小節単位のtarget toneへ向かう",
    rhythmTendency: "歌唱的な長音、ためらい、弱起、breathをPhrase Architectureへ組み込む",
    registerTendency: "感情曲線ごとに異なるtrajectory。後半高音型へ固定しない",
    restTendency: "breathとsilence climaxを意味のある構造点へ置く",
    endingTendency: "resolved / suspended / open / carry-overを候補間で分ける",
    protectedTraits: ["Motif変形", "遅延解決", "複数Climax型", "複数Ending"],
    selectionFitWeight: 0.35,
    identityComparison: { metric: "delayedResolutionRatio", reference: "standard", direction: "greater" },
  },
  "speech-rhythmic": {
    planningPriority: "rhythm-led",
    pitchTendency: "Accent Mapを先に作り、狭い音域で同音反復と小さな屈折を使う",
    rhythmTendency: "発話アクセント、不均等なPhrase長、小節線をまたぐ開始を優先する",
    registerTendency: "狭いcontained register",
    restTendency: "句読点に相当する短い間を非対称に配置する",
    endingTendency: "発話の継続感を持つcarry-forward / openを許可する",
    protectedTraits: ["同音反復", "Accent Map", "Phrase非対称性", "狭い音域"],
    selectionFitWeight: 0.45,
    identityComparison: { metric: "repeatedNoteRatio", reference: "rhythmic", direction: "greater" },
  },
  incantatory: {
    planningPriority: "cycle-led",
    pitchTendency: "2〜5音の核を反復し、周期ごとに限定的な変異を加える",
    rhythmTendency: "核モチーフのアクセント周期と変異周期を維持する",
    registerTendency: "反復可能な狭〜中音域。大きなtrajectoryより輪郭保持を優先する",
    restTendency: "周期を壊さず、変異点または呼吸点へ置く",
    endingTendency: "open / suspendedを含み、反復可能性を残す",
    protectedTraits: ["核モチーフ", "反復周期", "輪郭保持", "限定的変異"],
    selectionFitWeight: 0.35,
    identityComparison: { metric: "motifRepeatRatio", reference: "rhythmic", direction: "greater" },
  },
}

export type GeneratorProfileKind = "parametric" | "bespoke"

/**
 * parametric: 既存のフレーズ生成エンジン(harmonicMap→phrase→motif→development)を
 *   専用GenerationParamsプリセットで駆動する。
 * bespoke: このProfile専用の生成順序を持つ独立パイプライン(elegiacCantabile.ts等)。
 */
export const GENERATOR_PROFILE_KIND: Record<MelodyGeneratorProfile, GeneratorProfileKind> = {
  standard: "parametric",
  minimal: "parametric",
  leaping: "parametric",
  rhythmic: "parametric",
  chromatic: "parametric",
  cinematic: "parametric",
  "elegiac-cantabile": "bespoke",
  "speech-rhythmic": "bespoke",
  incantatory: "bespoke",
}

const FULL_CONTOUR = (a: number, d: number, arch: number, inv: number, w: number) => ({
  ascending: a,
  descending: d,
  arch,
  "inverted-arch": inv,
  wave: w,
})

/** parametric 6種の、ベースGenerationParamsに対する上書き差分 */
export const GENERATOR_PROFILE_PARAM_OVERRIDES: Record<MelodyGeneratorProfile, Partial<GenerationParams>> = {
  standard: {},
  minimal: {
    restRatioTarget: 0.5,
    densityNoteMultiplier: 0.55,
    leapWidthBias: 0.12,
    motifRepeatTarget: 0.62,
    noveltyWeight: 0.2,
    syncopationAmount: 0.15,
    contourWeights: FULL_CONTOUR(0.8, 0.8, 0.8, 0.8, 1.6),
  },
  leaping: {
    leapWidthBias: 0.82,
    restRatioTarget: 0.2,
    noveltyWeight: 0.65,
    contourWeights: FULL_CONTOUR(1.3, 1.1, 1.4, 0.9, 0.5),
  },
  rhythmic: {
    syncopationAmount: 0.7,
    densityNoteMultiplier: 1.3,
    restRatioTarget: 0.18,
    motifRepeatTarget: 0.55,
    leapWidthBias: 0.35,
  },
  chromatic: {
    tensionUsageTarget: 0.55,
    leapWidthBias: 0.3,
    endTensionBias: 0.6,
    restRatioTarget: 0.22,
  },
  cinematic: {
    leapWidthBias: 0.55,
    climaxBias: "end",
    peakHeadroomSemitones: 0,
    restRatioTarget: 0.2,
    noveltyWeight: 0.6,
    contourWeights: FULL_CONTOUR(1.2, 0.8, 1.4, 0.7, 0.6),
  },
  // bespoke 3種はここでは扱わない(専用パイプラインが独自パラメータを持つ)
  "elegiac-cantabile": {},
  "speech-rhythmic": {},
  incantatory: {},
}

/** 8章: セクション別の適用強度(0=Profile固有色を弱める 〜 1=通常適用)。値が無いセクションは1.0扱い */
export const GENERATOR_PROFILE_SECTION_INTENSITY: Partial<Record<MelodyGeneratorProfile, Partial<Record<SectionRole, number>>>> = {
  "elegiac-cantabile": { verse: 0.6, "pre-chorus": 0.8, chorus: 1.0, "breakdown-chorus": 0.65, "grand-chorus": 1.0, "c-melody": 0.9, bridge: 0.9 },
  "speech-rhythmic": { verse: 1.0, "pre-chorus": 0.7, chorus: 0.4, "breakdown-chorus": 0.35, "grand-chorus": 0.55, "c-melody": 0.8, bridge: 0.8 },
  incantatory: { verse: 0.9, "pre-chorus": 0.8, chorus: 0.7, "breakdown-chorus": 0.55, "grand-chorus": 0.85, "c-melody": 1.0, bridge: 1.0 },
}

export function generatorProfileIntensity(profile: MelodyGeneratorProfile, role: SectionRole): number {
  return GENERATOR_PROFILE_SECTION_INTENSITY[profile]?.[role] ?? 1.0
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** ベースパラメータと、Profile差分をintensityで補間したGenerationParamsを返す(8章) */
export function applyProfileOverride(base: GenerationParams, profile: MelodyGeneratorProfile, intensity: number): GenerationParams {
  const overrides = GENERATOR_PROFILE_PARAM_OVERRIDES[profile]
  const t = Math.min(1, Math.max(0, intensity))
  const result: GenerationParams = { ...base, contourWeights: { ...base.contourWeights } }
  for (const key of Object.keys(overrides) as (keyof GenerationParams)[]) {
    if (key === "contourWeights") {
      const ov = overrides.contourWeights!
      for (const c of Object.keys(ov) as (keyof typeof ov)[]) {
        result.contourWeights[c] = lerp(base.contourWeights[c], ov[c], t)
      }
    } else if (key === "climaxBias") {
      if (overrides.climaxBias && t >= 0.5) result.climaxBias = overrides.climaxBias
    } else {
      const baseVal = base[key] as number
      const overrideVal = overrides[key] as number
      ;(result[key] as number) = lerp(baseVal, overrideVal, t)
    }
  }
  return result
}
