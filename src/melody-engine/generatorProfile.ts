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
  "elegiac-cantabile": { verse: 0.6, "pre-chorus": 0.8, chorus: 1.0, bridge: 0.9 },
  "speech-rhythmic": { verse: 1.0, "pre-chorus": 0.7, chorus: 0.4, bridge: 0.8 },
  incantatory: { verse: 0.9, "pre-chorus": 0.8, chorus: 0.7, bridge: 1.0 },
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
