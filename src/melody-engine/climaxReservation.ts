import type { SongProfileId } from "@/core/project"
import type { SectionRole } from "@/core/section"
import type { Midi } from "@/core/note"
import type { RangeSetting } from "./generationParams"

/**
 * Issue #41: 主旋律のクライマックス音高を予約する。
 *
 * 「イントロが主旋律の最高音を先に使っていないか」を評価したいが、イントロ生成時点では
 * サビが未生成のことがあり、そのままではサビの最高音を参照できない(#30と生成順序で衝突する)。
 * そこで Song Profile ごとに上限を予約する方式を採り、サビ未確定時は
 * 例外を投げずに予約値へフォールバックする。
 */
export type ClimaxCeilingSource = "chorus-melody" | "profile-reservation" | "no-reservation"

export interface ClimaxCeiling {
  /** この音高より上をリードで使わない(この値自体は使用可) */
  ceilingMidi: Midi
  source: ClimaxCeilingSource
}

/**
 * Song Profileごとの予約幅(半音)。クライマックスの落差を大きく設計するProfileほど、
 * サビ以外のセクションで上を空けておく。
 */
const PROFILE_RESERVED_SEMITONES: Record<SongProfileId, number> = {
  "dark-romantic": 4,
  "cinematic-french-pop": 5,
  "minimal-tension": 3,
  "dramatic-synth-pop": 6,
  "original-custom": 4,
}

/** クライマックスを担うRole。ここでは音域を全開放する(予約しない) */
const CLIMAX_ROLES: SectionRole[] = ["chorus", "grand-chorus"]

/**
 * そのセクションのリードが使ってよい上限音高を返す。
 *
 * - サビ系のメロディが既に生成済みなら、その最高音より下に収める
 * - 未生成なら Song Profile の予約幅へフォールバックする(例外は投げない)
 * - サビ自身は予約しない
 */
export function resolveClimaxCeiling(args: {
  sectionRole: SectionRole
  songProfile: SongProfileId
  range: RangeSetting
  /** 既に生成済みのサビ系メロディの最高音。未生成なら undefined */
  chorusPeakMidi?: number
}): ClimaxCeiling {
  const { sectionRole, songProfile, range, chorusPeakMidi } = args

  if (CLIMAX_ROLES.includes(sectionRole)) {
    return { ceilingMidi: range.high, source: "no-reservation" }
  }

  if (chorusPeakMidi !== undefined && Number.isFinite(chorusPeakMidi)) {
    // サビの最高音を先に使わないよう、1半音下までに収める。
    // ただしrange下限を割らないようクランプする(音域が極端に狭い場合の保険)。
    const ceiling = Math.max(range.low, Math.min(range.high, chorusPeakMidi - 1))
    return { ceilingMidi: ceiling, source: "chorus-melody" }
  }

  const reserved = PROFILE_RESERVED_SEMITONES[songProfile] ?? 4
  const ceiling = Math.max(range.low, range.high - reserved)
  return { ceilingMidi: ceiling, source: "profile-reservation" }
}

/** 予約を適用した音域(リード生成に渡す実効レンジ) */
export function rangeWithClimaxReservation(range: RangeSetting, ceiling: ClimaxCeiling): RangeSetting {
  return { low: range.low, high: Math.max(range.low, Math.min(range.high, ceiling.ceilingMidi)) }
}
