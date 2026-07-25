/**
 * Issue #12: コード入力の解析結果・警告・エラーと、セクション充足状況を可視化するための診断。
 *
 * 生成は buildHarmonicMap が未解析コードを暗黙に C major へフォールバックする(harmonicMap.ts)。
 * ここでは「実際に生成へ渡る解釈」と「無視された未対応記法・不正な長さ・区間の過不足」を
 * ユーザーが生成前に確認できるよう、和音イベント列から診断情報を組み立てる。
 */
import { parseChordSymbol } from "./chord"
import { PITCH_CLASS_NAMES_SHARP } from "./note"
import type { ChordEvent } from "./project"

export type ChordDiagnosisStatus = "ok" | "warning" | "error"

export interface ChordDiagnosis {
  index: number
  /** 入力されたままのシンボル */
  symbol: string
  startBeat: number
  durationBeats: number
  status: ChordDiagnosisStatus
  /** warning/error の理由(ユーザー向け) */
  reason?: string
  /** 解析できた場合のプレビュー */
  rootName?: string
  bassName?: string
  toneNames?: string[]
  tensionNames?: string[]
  /** 実際に生成へ渡る解釈(未対応末尾を無視した後のシンボル) */
  interpretedSymbol?: string
}

export interface SectionCoverage {
  sectionLengthBeats: number
  /** 最後の和音の終端拍(区間内に空白があっても、これ単体では過不足を判定しない) */
  coveredBeats: number
  status: "exact" | "under" | "over"
  /** gapsの合計(先頭・中間・末尾いずれの空白も含む。>0 のとき under) */
  gapBeats: number
  /** over のとき超過拍(>0) */
  overflowBeats: number
  /**
   * 区間[0, sectionLengthBeats]内で和音が置かれていない範囲(Issue #12 PR#35レビュー対応)。
   * インポート等で和音が連続配置とは限らないため、終端拍だけでなく実際の被覆区間の和集合から
   * 先頭の空白・中間の空白を検出する(例: 8拍のセクションで4〜8拍にしか和音が無い場合、
   * 従来は終端一致だけを見て"exact"と誤判定していた)。
   */
  gaps: { startBeat: number; endBeat: number }[]
  /** 直前の和音と重なっているイベント(index)。順次配置なら通常は空 */
  overlaps: number[]
}

export interface ChordInputDiagnostics {
  chords: ChordDiagnosis[]
  coverage: SectionCoverage
  hasError: boolean
  hasWarning: boolean
}

function pcName(pc: number): string {
  return PITCH_CLASS_NAMES_SHARP[((pc % 12) + 12) % 12]
}

const EPS = 1e-6

/** 1つの和音イベントを診断する(解析成功/未対応末尾の警告/解析不能のエラー/不正な長さ) */
export function diagnoseChord(event: ChordEvent, index: number): ChordDiagnosis {
  const base: ChordDiagnosis = {
    index,
    symbol: event.symbol,
    startBeat: event.startBeat,
    durationBeats: event.durationBeats,
    status: "ok",
  }

  const durationInvalid = !Number.isFinite(event.durationBeats) || event.durationBeats <= 0

  if (!event.symbol.trim()) {
    return { ...base, status: "error", reason: "空のコードです" }
  }

  const parsed = parseChordSymbol(event.symbol, event.bass ?? undefined)
  if (!parsed) {
    return {
      ...base,
      status: "error",
      reason: `解析できないコード記法です(ルート音 A〜G で始めてください)。このままでは C major として生成されます`,
    }
  }

  const toneNames = parsed.tones.map((t) => pcName(t.pitchClass))
  const tensionNames = parsed.tensions.map((t) => pcName(t.pitchClass))
  const preview: Partial<ChordDiagnosis> = {
    rootName: parsed.rootName,
    bassName: parsed.bassPc !== parsed.rootPc ? parsed.bassName : undefined,
    toneNames,
    tensionNames: tensionNames.length ? tensionNames : undefined,
    interpretedSymbol: parsed.unrecognized ? parsed.interpretedSymbol : event.symbol,
  }

  const reasons: string[] = []
  if (parsed.unrecognized) reasons.push(`未対応の記法「${parsed.unrecognized}」を無視しました`)
  if (durationInvalid) reasons.push("長さの指定が不正です(正の拍数を指定してください)")

  if (reasons.length > 0) {
    return { ...base, ...preview, status: "warning", reason: reasons.join(" / ") }
  }
  return { ...base, ...preview, status: "ok" }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * 和音イベント列(startBeat順)の被覆区間を和集合として求め、[0, sectionLengthBeats]内の
 * 空白(先頭・中間・末尾)を検出する(Issue #12 PR#35レビュー対応)。
 * 重なり合う/連続するイベントは1つの区間へマージする。
 */
function computeCoverageGaps(
  sorted: ChordEvent[],
  sectionLengthBeats: number,
): { gaps: { startBeat: number; endBeat: number }[] } {
  if (sectionLengthBeats <= 0) return { gaps: [] }

  const merged: { start: number; end: number }[] = []
  for (const e of sorted) {
    const start = e.startBeat
    const end = e.startBeat + e.durationBeats
    if (end <= start + EPS) continue // 長さ0以下は被覆に寄与しない(別途warningで検出済み)
    const last = merged[merged.length - 1]
    if (last && start <= last.end + EPS) {
      last.end = Math.max(last.end, end)
    } else {
      merged.push({ start, end })
    }
  }

  const gaps: { startBeat: number; endBeat: number }[] = []
  let cursor = 0
  for (const iv of merged) {
    if (iv.start > cursor + EPS) gaps.push({ startBeat: cursor, endBeat: Math.min(iv.start, sectionLengthBeats) })
    cursor = Math.max(cursor, iv.end)
    if (cursor >= sectionLengthBeats) break
  }
  if (cursor < sectionLengthBeats - EPS) gaps.push({ startBeat: cursor, endBeat: sectionLengthBeats })

  return {
    gaps: gaps
      .map((g) => ({ startBeat: round3(Math.max(0, g.startBeat)), endBeat: round3(Math.min(sectionLengthBeats, g.endBeat)) }))
      .filter((g) => g.endBeat - g.startBeat > EPS),
  }
}

/**
 * セクションの和音入力全体を診断する。区間の過不足・重複と、各和音の解析結果をまとめる。
 * sectionLengthBeats <= 0 の場合は充足判定を行わない(exact 扱い)。
 */
export function diagnoseChordInput(events: ChordEvent[], sectionLengthBeats: number): ChordInputDiagnostics {
  const sorted = [...events].sort((a, b) => a.startBeat - b.startBeat)
  const chords = sorted.map((e, i) => diagnoseChord(e, i))

  // 直前のイベントとだけ比較すると、間に短いイベントが挟まる入れ子状の重複
  // (例: A=0〜10拍, B=2〜3拍, C=4〜5拍でCとAの重複)を見逃す(Issue #12 PR#35レビュー対応)。
  // そこまでの最大終端位置と比較することで、順序が入れ替わっても正しく検出する。
  const overlaps: number[] = []
  let maxEndSoFar = sorted.length ? sorted[0].startBeat + sorted[0].durationBeats : 0
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startBeat < maxEndSoFar - EPS) overlaps.push(i)
    maxEndSoFar = Math.max(maxEndSoFar, sorted[i].startBeat + sorted[i].durationBeats)
  }

  const coveredBeats = sorted.length ? Math.max(...sorted.map((e) => e.startBeat + e.durationBeats)) : 0
  const { gaps } = computeCoverageGaps(sorted, sectionLengthBeats)
  const gapBeats = round3(gaps.reduce((sum, g) => sum + (g.endBeat - g.startBeat), 0))

  let status: SectionCoverage["status"] = "exact"
  let overflowBeats = 0
  if (sectionLengthBeats > 0 && coveredBeats > sectionLengthBeats + EPS) {
    overflowBeats = round3(coveredBeats - sectionLengthBeats)
  }
  if (gapBeats > EPS) status = "under"
  else if (overflowBeats > EPS) status = "over"

  return {
    chords,
    coverage: { sectionLengthBeats, coveredBeats, status, gapBeats, overflowBeats, gaps, overlaps },
    hasError: chords.some((c) => c.status === "error"),
    hasWarning: chords.some((c) => c.status === "warning") || overlaps.length > 0 || status !== "exact",
  }
}
