import type { SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { PhraseContour } from "@/core/melody"
import { keyScalePitchClasses } from "@/core/scale"

export type Density = "sparse" | "balanced" | "active"
export type Drama = "restrained" | "growing" | "open"

export interface RangeSetting {
  low: number
  high: number
}

export const RANGE_PRESETS: Record<"low" | "middle" | "high", RangeSetting> = {
  low: { low: 55, high: 72 }, // G3-C5
  middle: { low: 60, high: 77 }, // C4-F5
  high: { low: 64, high: 81 }, // E4-A5
}

export interface GenerationParams {
  restRatioTarget: number
  syncopationAmount: number
  tensionUsageTarget: number
  motifRepeatTarget: number
  leapWidthBias: number
  contourWeights: Record<PhraseContour, number>
  endTensionBias: number
  climaxBias: "early" | "late" | "end"
  noveltyWeight: number
  densityNoteMultiplier: number
  /** レンジ上限からどれだけ音域を控えるか(8.2 Verseは最高音を温存、8.4 Chorusは全開放) */
  peakHeadroomSemitones: number
  /**
   * Issue #13: Song KeyのダイアトニックScale(ピッチクラス7つ)。テンション/経過音候補を
   * このScaleへ軽く寄せるために使う。未指定または空配列の場合は従来通りコードのUsable Tone
   * (allUsablePitchClasses)をそのまま使う。
   */
  keyScalePitchClasses?: number[]
}

const BASE_PARAMS: GenerationParams = {
  restRatioTarget: 0.25,
  syncopationAmount: 0.3,
  tensionUsageTarget: 0.2,
  motifRepeatTarget: 0.4,
  leapWidthBias: 0.4,
  contourWeights: { ascending: 1, descending: 1, arch: 1.2, "inverted-arch": 1, wave: 1 },
  endTensionBias: 0.35,
  climaxBias: "late",
  noveltyWeight: 0.5,
  densityNoteMultiplier: 1,
  peakHeadroomSemitones: 4,
}

/** 9.9.1 Song Profileごとの初期値傾向(Phase2で反映) */
const PROFILE_TENDENCY: Record<SongProfileId, Partial<GenerationParams>> = {
  "dark-romantic": {
    tensionUsageTarget: 0.4,
    endTensionBias: 0.7,
    restRatioTarget: 0.35,
    contourWeights: { ascending: 0.8, descending: 1.1, arch: 1, "inverted-arch": 1.3, wave: 1.1 },
  },
  "cinematic-french-pop": {
    leapWidthBias: 0.2,
    motifRepeatTarget: 0.65,
    contourWeights: { ascending: 1, descending: 0.9, arch: 1.3, "inverted-arch": 0.7, wave: 1 },
  },
  "minimal-tension": {
    leapWidthBias: 0.15,
    motifRepeatTarget: 0.7,
    tensionUsageTarget: 0.1,
    noveltyWeight: 0.25,
    contourWeights: { ascending: 0.8, descending: 0.8, arch: 0.8, "inverted-arch": 0.8, wave: 1.6 },
  },
  "dramatic-synth-pop": {
    leapWidthBias: 0.7,
    climaxBias: "end",
    contourWeights: { ascending: 1.4, descending: 0.7, arch: 1.3, "inverted-arch": 0.6, wave: 0.6 },
  },
  "original-custom": {},
}

/** 8章 セクション別生成ルールを数値傾向へ変換したもの */
const SECTION_TENDENCY: Record<SectionRole, Partial<GenerationParams>> = {
  intro: { restRatioTarget: 0.45, leapWidthBias: 0.2, climaxBias: "early", noveltyWeight: 0.3, peakHeadroomSemitones: 5 },
  verse: { restRatioTarget: 0.3, leapWidthBias: 0.25, climaxBias: "early", peakHeadroomSemitones: 6 },
  "pre-chorus": { restRatioTarget: 0.2, endTensionBias: 0.75, climaxBias: "late", peakHeadroomSemitones: 3 },
  chorus: { restRatioTarget: 0.15, motifRepeatTarget: 0.6, endTensionBias: 0.2, climaxBias: "end", peakHeadroomSemitones: 0 },
  // 落ちサビ: サビの記憶性を残しつつ、音数・音域・解決感を抑えて次の解放を作る
  "breakdown-chorus": { restRatioTarget: 0.32, densityNoteMultiplier: 0.65, motifRepeatTarget: 0.6, endTensionBias: 0.45, climaxBias: "late", peakHeadroomSemitones: 4 },
  // 大サビ: 曲全体の感情的な頂点。サビより息を継がず、モチーフを強く回収し、完全解決へ向かう
  "grand-chorus": { restRatioTarget: 0.1, motifRepeatTarget: 0.75, endTensionBias: 0.1, climaxBias: "end", peakHeadroomSemitones: 0 },
  // Cメロ: A/B/サビとは異なる旋律語彙を許容し、大サビへの緊張を保持する
  "c-melody": { restRatioTarget: 0.22, leapWidthBias: 0.5, noveltyWeight: 0.8, endTensionBias: 0.7, climaxBias: "late", peakHeadroomSemitones: 2 },
  bridge: { leapWidthBias: 0.6, noveltyWeight: 0.7, climaxBias: "late", peakHeadroomSemitones: 2 },
  outro: { restRatioTarget: 0.4, densityNoteMultiplier: 0.6, endTensionBias: 0.6, peakHeadroomSemitones: 7 },
  instrumental: { restRatioTarget: 0.35, peakHeadroomSemitones: 4 },
}

const DENSITY_TENDENCY: Record<Density, Partial<GenerationParams>> = {
  sparse: { restRatioTarget: 0.4, densityNoteMultiplier: 0.7, syncopationAmount: 0.2 },
  balanced: {},
  active: { restRatioTarget: 0.15, densityNoteMultiplier: 1.4, syncopationAmount: 0.45 },
}

const DRAMA_TENDENCY: Record<Drama, Partial<GenerationParams>> = {
  restrained: { leapWidthBias: -0.15, endTensionBias: 0.1 },
  growing: {},
  open: { leapWidthBias: 0.2, climaxBias: "end" },
}

function merge(base: GenerationParams, ...patches: Partial<GenerationParams>[]): GenerationParams {
  let result = { ...base, contourWeights: { ...base.contourWeights } }
  for (const patch of patches) {
    result = { ...result, ...patch }
    if (patch.contourWeights) result.contourWeights = { ...result.contourWeights, ...patch.contourWeights }
  }
  return result
}

export function resolveGenerationParams(
  profile: SongProfileId,
  role: SectionRole,
  density: Density,
  drama: Drama,
  key?: string,
): GenerationParams {
  const merged = merge(BASE_PARAMS, PROFILE_TENDENCY[profile], SECTION_TENDENCY[role], DENSITY_TENDENCY[density], DRAMA_TENDENCY[drama])
  merged.restRatioTarget = clamp01(merged.restRatioTarget)
  merged.tensionUsageTarget = clamp01(merged.tensionUsageTarget)
  merged.leapWidthBias = clamp01(merged.leapWidthBias)
  merged.endTensionBias = clamp01(merged.endTensionBias)
  if (key) merged.keyScalePitchClasses = keyScalePitchClasses(key)
  return merged
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
