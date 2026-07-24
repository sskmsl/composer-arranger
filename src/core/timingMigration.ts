/**
 * Issue #16: schemaVersion 1.1のまま「四分音符=1拍」へ統一する前後で存在する
 * 拍子分母4以外(6/8等)の時間値データを、新しい時間単位へ移行する。
 *
 * 背景: parseTimeSignature の beatsPerBar は元々 numerator をそのまま使っていたが、
 * numerator * 4 / denominator (四分音符換算) へ修正された。schemaVersion は
 * 前後どちらも "1.1" のままだったため、denominator!==4 のデータだけでは
 * 旧形式(numerator換算)か新形式(四分音符換算)かを区別できない。
 *
 * この一箇所だけがJSON Import(loadProject経由)とIndexedDB復元(hydrate)双方の
 * 唯一の入口になる。時間値の変換はここでしか行わない。
 */
import { normalizeProject, TIME_BASE, type ComposerProject } from "./project"
import { parseTimeSignature, type TimeSignature } from "./section"
import type { MelodyVariant } from "./melody"

export interface TimingAmbiguity {
  timeSignature: string
  /** 判定できなかった理由(ユーザー表示用) */
  reason: string
}

export type TimingMigrationStatus = "no-op" | "auto-converted" | "ambiguous"

export interface TimingMigrationResult {
  project: ComposerProject
  status: TimingMigrationStatus
  /** auto-convertedの場合、実際に掛けた倍率(4/denominator) */
  factor?: number
  ambiguity?: TimingAmbiguity
}

const COVERAGE_TOLERANCE = 0.15

function scale(v: number, factor: number): number {
  return Math.round(v * factor * 1000) / 1000
}

/** チェック対象プロジェクト全体の時間値へfactorを一括適用する(唯一の変換経路) */
export function convertProjectTiming(project: ComposerProject, factor: number): ComposerProject {
  if (factor === 1) return project
  const melodyVariants: MelodyVariant[] = project.melodyVariants.map((v) => ({
    ...v,
    notes: v.notes.map((n) => ({ ...n, startBeat: scale(n.startBeat, factor), durationBeats: scale(n.durationBeats, factor) })),
    phrasePlans: v.phrasePlans.map((p) => ({
      ...p,
      phraseStartBeat: scale(p.phraseStartBeat, factor),
      phraseLengthBeats: scale(p.phraseLengthBeats, factor),
      climaxBeat: scale(p.climaxBeat, factor),
      restBeats: p.restBeats.map((r) => scale(r, factor)),
    })),
    prosodyPlan: v.prosodyPlan
      ? {
          syllableSlots: v.prosodyPlan.syllableSlots.map((s) => ({ ...s, beat: scale(s.beat, factor), durationBeats: scale(s.durationBeats, factor) })),
          breathPositions: v.prosodyPlan.breathPositions.map((b) => scale(b, factor)),
        }
      : v.prosodyPlan,
  }))
  return {
    ...project,
    chords: project.chords.map((c) => ({ ...c, startBeat: scale(c.startBeat, factor), durationBeats: scale(c.durationBeats, factor) })),
    melodyVariants,
  }
}

type Era = "old" | "new" | "ambiguous"

/**
 * セクションごとに「実際に保存されているデータの最終拍」が、新旧どちらの
 * beatsPerBar解釈による想定小節長に近いかを多数決する。両方に票が割れる、
 * またはどちらの解釈にも一致しない(判定材料がない場合を含む)ならambiguousとする。
 */
function detectEra(project: ComposerProject, ts: TimeSignature): Era {
  const newBeatsPerBar = ts.beatsPerBar
  const oldBeatsPerBar = ts.numerator
  let oldVotes = 0
  let newVotes = 0

  for (const section of project.sections) {
    const chordSpans = project.chords.filter((c) => c.sectionId === section.id).map((c) => c.startBeat + c.durationBeats)
    const noteSpans = project.melodyVariants
      .filter((v) => v.sectionId === section.id)
      .flatMap((v) => v.notes.map((n) => n.startBeat + n.durationBeats))
    const spans = [...chordSpans, ...noteSpans]
    if (spans.length === 0) continue

    const actual = Math.max(...spans)
    const expectedNew = section.lengthBars * newBeatsPerBar
    const expectedOld = section.lengthBars * oldBeatsPerBar
    if (expectedNew <= 0 || expectedOld <= 0) continue

    const nearNew = Math.abs(actual / expectedNew - 1) < COVERAGE_TOLERANCE
    const nearOld = Math.abs(actual / expectedOld - 1) < COVERAGE_TOLERANCE
    if (nearOld && !nearNew) oldVotes++
    else if (nearNew && !nearOld) newVotes++
  }

  if (oldVotes > 0 && newVotes === 0) return "old"
  if (newVotes > 0 && oldVotes === 0) return "new"
  return "ambiguous"
}

/**
 * JSON Import / IndexedDB復元の両方から呼ぶ唯一の入口。
 * - すでにtimeBase="quarter"が付いている(=新形式で保存された)場合は何もしない
 * - 拍子分母が4の場合は新旧の解釈が一致するため無条件でそのままタグ付けする
 * - 分母が4以外の場合、既存データの収まり方から新旧を確信を持って判定できれば
 *   自動変換(旧形式)またはそのままタグ付け(新形式)する
 * - 判定できない場合は変換せずambiguousを返す。呼び出し側はバックアップを取った上で
 *   ユーザーに変換するかどうかを確認すること(resolveAmbiguousTiming参照)
 */
export function resolveProjectTiming(raw: unknown): TimingMigrationResult {
  const normalized = normalizeProject(raw)

  if (normalized.timeBase === TIME_BASE) {
    return { project: normalized, status: "no-op" }
  }

  const ts = parseTimeSignature(normalized.song.timeSignature)
  if (ts.denominator === 4) {
    return { project: { ...normalized, timeBase: TIME_BASE }, status: "no-op" }
  }

  const era = detectEra(normalized, ts)
  if (era === "new") {
    return { project: { ...normalized, timeBase: TIME_BASE }, status: "no-op" }
  }
  if (era === "old") {
    const factor = 4 / ts.denominator
    const converted = convertProjectTiming(normalized, factor)
    return { project: { ...converted, timeBase: TIME_BASE }, status: "auto-converted", factor }
  }

  return {
    project: normalized,
    status: "ambiguous",
    ambiguity: {
      timeSignature: normalized.song.timeSignature,
      reason:
        "拍子(分母4以外)と既存データの時間値だけでは、新旧どちらの時間単位で保存されたか確信を持って判定できませんでした。",
    },
  }
}

/** ambiguousだったプロジェクトへユーザーの選択を適用する。変換を選ばなかった場合もタグ付けし、再度確認を求めないようにする */
export function resolveAmbiguousTiming(project: ComposerProject, convert: boolean): ComposerProject {
  if (!convert) return { ...project, timeBase: TIME_BASE }
  const ts = parseTimeSignature(project.song.timeSignature)
  const factor = 4 / ts.denominator
  return { ...convertProjectTiming(project, factor), timeBase: TIME_BASE }
}
