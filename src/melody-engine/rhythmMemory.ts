import type { MelodyNote } from "@/core/melody"

/**
 * リズムの覚えやすさに関わる、記録専用の指標(選抜には使わない)。
 * 定義と、確かめる手順は docs/rhythm-memory-controls.md(Codex desktop との合意、PR #174・#175)。
 * 研究が示したことと、このアプリの仮説は区別している:
 *   - シンコペーション: 強いと24時間後の再認が下がった(Fitch & Rosenfeld 2007)。「弱いほど美しい」とは扱わない
 *   - 拍を作る強さ: アクセントが拍の上に並ぶほど再現しやすい(Povel & Essens 1985)。ここではその限定版
 *   - 単位どうしの輪郭の一致: アプリ独自の仮説(Schmuckler & Moranis 2023 は同異判断の研究で、順位は検証していない)
 * 各関数は区間 [0, totalBeats) に始まる音だけを数える。全体の音列を渡しても、区間外の音は内部で除く。
 */

const SIXTEENTHS_PER_BEAT = 4
const onGrid = (beat: number) => Math.round(beat * SIXTEENTHS_PER_BEAT)
const withinSpan = (notes: readonly MelodyNote[], totalBeats: number) =>
  notes.filter((note) => note.startBeat >= -1e-6 && note.startBeat < totalBeats - 1e-6)

/** 4/4 の1小節(16分×16)の拍節の重み(Longuet-Higgins & Lee 1984) */
const BAR_WEIGHTS = [0, -4, -3, -4, -2, -4, -3, -4, -1, -4, -3, -4, -2, -4, -3, -4]

/**
 * シンコペーションの強さ(Longuet-Higgins & Lee 1984)。
 * 発音 n から次の発音(最後の音は区間の終わり)までの間に、n より重い位置があれば、その中で最も重い位置 p について
 * 重み(p) − 重み(n) を足す。p が n の音の持続か休符かは区別しない。4/4 を前提にする。
 */
export function lhlSyncopation(notes: readonly MelodyNote[], totalBeats: number): number {
  const ticks = [...new Set(withinSpan(notes, totalBeats).map((note) => onGrid(note.startBeat)))].sort((a, b) => a - b)
  const end = onGrid(totalBeats)
  const weight = (tick: number) => BAR_WEIGHTS[((tick % 16) + 16) % 16]
  let total = 0
  ticks.forEach((tick, index) => {
    const next = ticks[index + 1] ?? end
    let strongest: number | undefined
    for (let position = tick + 1; position < next; position++) {
      if (strongest === undefined || weight(position) > weight(strongest)) strongest = position
    }
    if (strongest !== undefined && weight(strongest) > weight(tick)) total += weight(strongest) - weight(tick)
  })
  return total
}

/**
 * 拍を作る強さ(Povel & Essens 1985 の限定版)。小さいほど拍を強く生む(反証の量)。
 *   - アクセント: 孤立した音、2音の組の2音目、3音以上の組の最初と最後。
 *     組は、パターン内の最小の発音間隔のまま続く音のまとまり(16分の格子ではない)
 *   - 時計: 拍子が既知なので、4分音符・位相0の1つだけを評価する(元のモデル全体の再現ではない)
 *   - 各打点で、音がなければ4、アクセントのない音なら1を数える
 */
export function povelEssensCounterEvidence(notes: readonly MelodyNote[], totalBeats: number): number {
  const onsets = [...new Set(withinSpan(notes, totalBeats).map((note) => onGrid(note.startBeat)))].sort((a, b) => a - b)
  if (onsets.length === 0) return Math.round(totalBeats) * 4
  // 最小単位は、実際に隣り合う発音どうしの間隔だけから求める(最後の音から区間の終わりまでは含めない)
  const intervals = onsets.slice(1).map((tick, index) => tick - onsets[index])
  const unit = intervals.length > 0 ? Math.min(...intervals) : 0
  const accented = new Set<number>()
  let group: number[] = [0]
  const closeGroup = () => {
    if (group.length === 1) accented.add(group[0])
    else if (group.length === 2) accented.add(group[1])
    else { accented.add(group[0]); accented.add(group[group.length - 1]) }
  }
  for (let index = 1; index < onsets.length; index++) {
    if (intervals[index - 1] === unit) group.push(index)
    else { closeGroup(); group = [index] }
  }
  closeGroup()
  let evidence = 0
  for (let beat = 0; beat < Math.round(totalBeats); beat++) {
    const index = onsets.indexOf(beat * SIXTEENTHS_PER_BEAT)
    if (index < 0) evidence += 4
    else if (!accented.has(index)) evidence += 1
  }
  return evidence
}

/**
 * 単位の中で、隣り合う音価の関係(長くなる 1 / 同じ 0 / 短くなる −1)の列。関係が2つ未満なら undefined。
 * 音価だけを見るので、発音間隔や休符が違っても音価の並びが同じなら同じ輪郭になる(この指標の限界)
 */
export function durationContour(notes: readonly Pick<MelodyNote, "startBeat" | "durationBeats">[]): number[] | undefined {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  if (sorted.length < 3) return undefined
  return sorted.slice(1).map((note, index) => {
    const previous = onGrid(sorted[index].durationBeats)
    const current = onGrid(note.durationBeats)
    return current > previous ? 1 : current < previous ? -1 : 0
  })
}

export interface ContourMatchRecord {
  /** 比べられた単位の組の数 */
  compared: number
  /** そのうち輪郭が一致した数 */
  matched: number
  /** 音が足りず比べられなかった単位の数(0点にはしない) */
  notApplicable: number
}

/**
 * 基準の単位と、後の単位の輪郭が一致するか(アプリ独自の仮説)。
 * 単位の境界は呼び出し側が結果を見る前に固定する(対照では小節線、生成した旋律では核の長さ)。
 * 基準の単位の輪郭が作れないときは、全ての単位を notApplicable にする。
 */
export function contourMatches(
  notes: readonly MelodyNote[],
  unitBeats: number,
  totalBeats: number,
  referenceStart = 0,
): ContourMatchRecord {
  const starts: number[] = []
  for (let start = referenceStart + unitBeats; start + unitBeats <= totalBeats + 1e-6; start += unitBeats) starts.push(start)
  return contourMatchesAgainst(durationContour(unitAt(notes, referenceStart, unitBeats)), notes, starts, unitBeats)
}

/**
 * 生成時点の核(核の頭を0拍とした相対位置)の輪郭を基準に、指定した開始拍からの単位が一致するか(アプリ独自の仮説)。
 * 開始拍には、最終旋律の冒頭(0拍)や、計画で核を再提示するとした区間など、結果を見る前に決まっている位置を渡す。
 * 区間の終わりを越える単位は数えない。
 */
export function coreContourMatches(
  coreNotes: readonly Pick<MelodyNote, "startBeat" | "durationBeats">[],
  notes: readonly MelodyNote[],
  starts: readonly number[],
  unitBeats: number,
  totalBeats: number,
): ContourMatchRecord {
  return contourMatchesAgainst(durationContour(coreNotes), notes, starts.filter((start) => start + unitBeats <= totalBeats + 1e-6), unitBeats)
}

const unitAt = (notes: readonly MelodyNote[], start: number, unitBeats: number) =>
  notes.filter((note) => note.startBeat >= start - 1e-6 && note.startBeat < start + unitBeats - 1e-6)

function contourMatchesAgainst(
  reference: number[] | undefined,
  notes: readonly MelodyNote[],
  starts: readonly number[],
  unitBeats: number,
): ContourMatchRecord {
  const record: ContourMatchRecord = { compared: 0, matched: 0, notApplicable: 0 }
  for (const start of starts) {
    const contour = durationContour(unitAt(notes, start, unitBeats))
    if (!reference || !contour) {
      record.notApplicable += 1
      continue
    }
    record.compared += 1
    if (contour.length === reference.length && contour.every((value, index) => value === reference[index])) record.matched += 1
  }
  return record
}
