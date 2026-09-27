import type { MelodyNote } from "@/core/melody"

/**
 * 生成の各段階で旋律がどう変わったかを記録する、診断専用の仕組み(選抜にも生成にも使わない)。
 * 記録は traceStages の中だけで行い、通常の生成では何も保持しない。
 * 乱数は使わず、音は数値だけを写して保存する(後の段階が音を書き換えても、前の記録は変わらない)。
 */

export interface StageNote {
  id: string
  startBeat: number
  durationBeats: number
  pitch: number
}

export interface StageRecord {
  /** 記録した順の番号 */
  order: number
  /** 段階の名前(例: "finish:narrative"、"craft:lift"、"final:refineTowardClassical") */
  stage: string
  /** 記録したときの文脈(作り方・プールの番号・再生成の回数・仕上げの種類など) */
  context: Readonly<Record<string, string | number | boolean>>
  notes: readonly StageNote[]
}

interface ActiveTrace {
  records: StageRecord[]
  context: Record<string, string | number | boolean>
}

let active: ActiveTrace | undefined

/** fn を実行し、その間に記録された段階を返す。入れ子にはしない */
export function traceStages<T>(fn: () => T): { result: T; records: StageRecord[] } {
  if (active) throw new Error("traceStages は入れ子にできません")
  const trace: ActiveTrace = { records: [], context: {} }
  active = trace
  try {
    return { result: fn(), records: trace.records }
  } finally {
    active = undefined
  }
}

/** 記録中なら、段階の後の音を写して残す。記録していなければ何もしない */
export function recordStage(stage: string, notes: readonly MelodyNote[]): void {
  if (!active) return
  active.records.push({
    order: active.records.length,
    stage,
    context: { ...active.context },
    notes: notes.map((note) => ({ id: note.id, startBeat: note.startBeat, durationBeats: note.durationBeats, pitch: note.pitch })),
  })
}

/** fn の間だけ文脈を足す。記録していなければ fn をそのまま呼ぶ */
export function withStageContext<T>(context: Record<string, string | number | boolean>, fn: () => T): T {
  if (!active) return fn()
  const trace = active
  const previous = trace.context
  trace.context = { ...previous, ...context }
  try {
    return fn()
  } finally {
    trace.context = previous
  }
}

export interface CandidateStage {
  /** 段階の名前。最終段と仕上げの流れの段階には "final:" / "craft:" を付けて区別する */
  stage: string
  notes: readonly StageNote[]
}

/**
 * 最終候補の1案が通った段階だけを、実際の処理順に取り出す。
 * プールの番号が同じでも作り方が違えば別の候補なので、作り方でも絞る。
 * 冒頭の再生成があった番号は、最後に作り直した回の記録を使う。仕上げ(finish)は採用した案の記録だけを残す。
 */
export function candidatePath(
  records: readonly StageRecord[],
  target: { profile: string; poolIndex: number; patternIndex: number },
): CandidateStage[] {
  const own = (record: StageRecord) => record.context.profile === target.profile && record.context.poolIndex === target.poolIndex
  const survivor = records.filter((record) => record.stage === "pool:harmonicIntegrity" && own(record)).at(-1)
  if (!survivor) return []
  const attempt = survivor.context.attempt
  const chosen = records.filter((record) => record.stage === "buildCandidate:chosen" && own(record) && record.context.attempt === attempt).at(-1)
  return records.filter((record) => {
    if (!own(record)) return false
    if (record.context.phase === "final") return record.context.patternIndex === target.patternIndex
    if (record.context.attempt !== attempt) return false
    return record.context.finish === undefined || record.context.finish === chosen?.context.chosenFinish
  }).map((record) => ({
    stage: record.context.phase === "final" || (record.context.phase === "craft" && !record.stage.startsWith("craft:"))
      ? `${record.context.phase}:${record.stage}`
      : record.stage,
    notes: record.notes,
  }))
}
