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
  coveredBeats: number
  status: "exact" | "under" | "over"
  /** under のとき不足拍(>0) */
  gapBeats: number
  /** over のとき超過拍(>0) */
  overflowBeats: number
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
    interpretedSymbol: parsed.unrecognized ? event.symbol.slice(0, event.symbol.length - parsed.unrecognized.length) : event.symbol,
  }

  const reasons: string[] = []
  if (parsed.unrecognized) reasons.push(`未対応の記法「${parsed.unrecognized}」を無視しました`)
  if (durationInvalid) reasons.push("長さの指定が不正です(正の拍数を指定してください)")

  if (reasons.length > 0) {
    return { ...base, ...preview, status: "warning", reason: reasons.join(" / ") }
  }
  return { ...base, ...preview, status: "ok" }
}

/**
 * セクションの和音入力全体を診断する。区間の過不足・重複と、各和音の解析結果をまとめる。
 * sectionLengthBeats <= 0 の場合は充足判定を行わない(exact 扱い)。
 */
export function diagnoseChordInput(events: ChordEvent[], sectionLengthBeats: number): ChordInputDiagnostics {
  const sorted = [...events].sort((a, b) => a.startBeat - b.startBeat)
  const chords = sorted.map((e, i) => diagnoseChord(e, i))

  const overlaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].startBeat + sorted[i - 1].durationBeats
    if (sorted[i].startBeat < prevEnd - EPS) overlaps.push(i)
  }

  const coveredBeats = sorted.length ? Math.max(...sorted.map((e) => e.startBeat + e.durationBeats)) : 0

  let status: SectionCoverage["status"] = "exact"
  let gapBeats = 0
  let overflowBeats = 0
  if (sectionLengthBeats > 0) {
    if (coveredBeats < sectionLengthBeats - EPS) {
      status = "under"
      gapBeats = Math.round((sectionLengthBeats - coveredBeats) * 1000) / 1000
    } else if (coveredBeats > sectionLengthBeats + EPS) {
      status = "over"
      overflowBeats = Math.round((coveredBeats - sectionLengthBeats) * 1000) / 1000
    }
  }

  return {
    chords,
    coverage: { sectionLengthBeats, coveredBeats, status, gapBeats, overflowBeats, overlaps },
    hasError: chords.some((c) => c.status === "error"),
    hasWarning: chords.some((c) => c.status === "warning") || overlaps.length > 0 || status !== "exact",
  }
}
