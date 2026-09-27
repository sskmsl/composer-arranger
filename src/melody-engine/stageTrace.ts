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
