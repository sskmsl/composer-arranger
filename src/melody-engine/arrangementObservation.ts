import type { MelodyNote } from "@/core/melody"

/**
 * 記録用: アレンジのパート(イントロ・短いフレーズ・対旋律・装飾)と主旋律の関係を観測する。
 * 観測だけを共通にし、選抜の重みや除外条件は役割ごとに決める(対旋律・補強の重複・単独のイントロで目的が違う)。
 * 生成や選抜には使わない。
 */

const pc = (pitch: number) => ((pitch % 12) + 12) % 12
const OVERLAP_BEATS = .5 - 1e-6

const GRID = 4
const onGrid = (beat: number) => Math.round(beat * GRID) / GRID

/**
 * 開始と終わりを16分音符の格子に丸めた音。演奏処理は音ごとに開始を数ミリ秒前後させるので、
 * 主旋律と各パートの関係は、両方を同じ格子へそろえてから比べる(丸めて長さが0になる音は1/8拍として残す)
 */
export function toGrid(notes: readonly MelodyNote[]): MelodyNote[] {
  return notes.map((note) => {
    const startBeat = onGrid(note.startBeat)
    const endBeat = onGrid(note.startBeat + note.durationBeats)
    return { ...note, startBeat, durationBeats: Math.max(.125, endBeat - startBeat) }
  })
}

/**
 * 同じ開始の音は最高音1つにした線(和音の素材を1本の線として見る代理。モチーフの核や持続する内声そのものではない)。
 * 演奏処理は和音の音ごとに数ミリ秒ずつ開始をずらすので、開始は16分音符の格子に丸めてまとめる
 */
export function topLine(notes: readonly MelodyNote[]): MelodyNote[] {
  const byStart = new Map<number, MelodyNote>()
  for (const note of toGrid(notes)) {
    const current = byStart.get(note.startBeat)
    if (!current || current.pitch < note.pitch) byStart.set(note.startBeat, note)
  }
  return [...byStart.values()].sort((a, b) => a.startBeat - b.startBeat)
}

/** beat に鳴っている音(開始を含み、終わりを含まない) */
export function soundingAt(notes: readonly MelodyNote[], beat: number): MelodyNote | undefined {
  return notes.find((note) => note.startBeat <= beat + 1e-6 && beat < note.startBeat + note.durationBeats - 1e-6)
}

/** 2音の絶対音程が完全5度(複音程を含む)か、完全8度・同度(複音程を含む)か。4度は含めない */
export function perfectIntervalClass(upper: number, lower: number): "fifth" | "octave" | null {
  const interval = pc(Math.abs(upper - lower))
  if (interval === 7) return "fifth"
  if (interval === 0) return "octave"
  return null
}

export interface ParallelObservation {
  /** パートの隣り合う2音の間で、主旋律も別の音へ替わった組 */
  movingPairs: number
  /** そのうち両方が同じ向きに動いた組(平行の判定対象) */
  similarMotionPairs: number
  /** そのうち、同じ種類の完全音程(5度→5度、8度→8度)が続いた組 */
  parallelPerfect: number
}

/** 主旋律との平行5度・8度。音程は絶対音程で判定する(下声・上声のどちらでも同じ) */
export function observeParallels(sourceLine: readonly MelodyNote[], sourceLead: readonly MelodyNote[]): ParallelObservation {
  const result: ParallelObservation = { movingPairs: 0, similarMotionPairs: 0, parallelPerfect: 0 }
  const line = toGrid(sourceLine)
  const lead = toGrid(sourceLead)
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]
    const b = line[index]
    const leadA = soundingAt(lead, a.startBeat)
    const leadB = soundingAt(lead, b.startBeat)
    if (!leadA || !leadB || leadA === leadB) continue
    const partMove = b.pitch - a.pitch
    const leadMove = leadB.pitch - leadA.pitch
    if (partMove === 0 || leadMove === 0) continue
    result.movingPairs += 1
    if (Math.sign(partMove) !== Math.sign(leadMove)) continue
    result.similarMotionPairs += 1
    const first = perfectIntervalClass(a.pitch, leadA.pitch)
    if (first && first === perfectIntervalClass(b.pitch, leadB.pitch)) result.parallelPerfect += 1
  }
  return result
}

export interface ClashObservation {
  /** 他の音と0.5拍以上重なる音(重なる区間の和集合の長さで判定する) */
  overlapNotes: number
  /** 重なっている拍数の合計 */
  overlapBeats: number
  /** 短2度(1半音)で0.5拍以上重なる音と、その重なりの拍数。短2度・長7度・複音程は、同じ音で重なってもそれぞれに数える */
  minorSecond: number
  minorSecondBeats: number
  /** 長7度(11半音)で重なる音 */
  majorSeventh: number
  /** 短9度・長14度などの複音程で重なる音 */
  compound: number
  /** 短2度の重なりのうち、重なりが拍の頭(格子上の整数拍)で始まるもの */
  minorSecondOnBeat: number
  /** 短2度の重なりのうち、その音が鳴り終わった後の最初の開始でパートが1〜2半音動き、そのとき鳴っている相手の音と短2度でなくなったもの(進む先が短2度のままや、相手が動いて短2度が続く場合、元の音がまだ鳴っている間に加わった音は数えない) */
  minorSecondResolved: number
}

/** 区間の和集合の長さ(重なる区間は1回だけ数える) */
function unionLength(intervals: readonly (readonly [number, number])[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let currentStart = -Infinity
  let currentEnd = -Infinity
  for (const [start, end] of sorted) {
    if (start > currentEnd) {
      if (currentEnd > currentStart) total += currentEnd - currentStart
      currentStart = start
      currentEnd = end
    } else {
      currentEnd = Math.max(currentEnd, end)
    }
  }
  if (currentEnd > currentStart) total += currentEnd - currentStart
  return total
}

/**
 * 他の音との半音系のぶつかり。実際の音域の間隔・長さ・拍の位置・解決を分けて残す。
 * 重なりの拍数は、重なる相手が替わっても区間の和集合で数える。
 * 解決は、次の異なる開始(16分音符の格子)でパートの音が1〜2半音動き、そのとき鳴っている相手の音と短2度でなくなった場合だけ数える
 */
export function observeClashes(sourceNotes: readonly MelodyNote[], sourceOthers: readonly MelodyNote[]): ClashObservation {
  const result: ClashObservation = {
    overlapNotes: 0, overlapBeats: 0, minorSecond: 0, minorSecondBeats: 0, majorSeventh: 0, compound: 0, minorSecondOnBeat: 0, minorSecondResolved: 0,
  }
  const notes = toGrid(sourceNotes)
  const others = toGrid(sourceOthers)
  const grid = onGrid
  for (const note of notes) {
    const end = note.startBeat + note.durationBeats
    // 正の交差区間を先に集め、和集合の長さにしてから 0.5拍の閾値を当てる(短い相手が続く場合も落とさない)
    const overlaps = others
      .map((other) => ({
        other,
        from: Math.max(other.startBeat, note.startBeat),
        to: Math.min(other.startBeat + other.durationBeats, end),
      }))
      .filter(({ from, to }) => to - from > 1e-6)
    const spanOf = (list: typeof overlaps) => unionLength(list.map(({ from, to }) => [from, to] as const))
    const overlapBeats = spanOf(overlaps)
    if (overlapBeats < OVERLAP_BEATS) continue
    result.overlapNotes += 1
    result.overlapBeats += overlapBeats
    const distanceOf = (other: MelodyNote) => Math.abs(note.pitch - other.pitch)
    // 音程の種類ごとに独立に数える(途中で主旋律の音が替わり、短2度と長7度の両方で重なる音もある)
    const minorSecond = overlaps.filter(({ other }) => distanceOf(other) === 1)
    const majorSeventh = overlaps.filter(({ other }) => distanceOf(other) === 11)
    const compound = overlaps.filter(({ other }) => distanceOf(other) > 12 && [1, 11].includes(distanceOf(other) % 12))
    if (spanOf(majorSeventh) >= OVERLAP_BEATS) result.majorSeventh += 1
    if (spanOf(compound) >= OVERLAP_BEATS) result.compound += 1
    const minorSecondBeats = spanOf(minorSecond)
    if (minorSecondBeats >= OVERLAP_BEATS) {
      result.minorSecond += 1
      result.minorSecondBeats += minorSecondBeats
      // 拍の頭かどうかは、短2度の重なりが実際に始まる位置で判定する
      const clashStart = Math.min(...minorSecond.map(({ from }) => from))
      if (Math.abs(clashStart - Math.round(clashStart)) < 1e-6) result.minorSecondOnBeat += 1
      // 進む先は、この音が鳴り終わった後(格子上)の最初の開始で鳴るパートの音のうち、この音にいちばん近い音とみなす。
      // 衝突より前に入った音や、この音がまだ鳴っている間に加わった音は、解決に数えない
      const ends = grid(note.startBeat + note.durationBeats)
      const nextStart = notes.map((other) => grid(other.startBeat))
        .filter((start) => start > clashStart + 1e-6 && start >= ends - 1e-6)
        .sort((a, b) => a - b)[0]
      const next = nextStart === undefined ? undefined : notes
        .filter((other) => Math.abs(grid(other.startBeat) - nextStart) < 1e-6)
        .sort((a, b) => Math.abs(a.pitch - note.pitch) - Math.abs(b.pitch - note.pitch))[0]
      if (next) {
        const move = Math.abs(next.pitch - note.pitch)
        const against = soundingAt(others, next.startBeat)
        if (move >= 1 && move <= 2 && against && Math.abs(next.pitch - against.pitch) !== 1) result.minorSecondResolved += 1
      }
    }
  }
  return result
}

export interface RegisterObservation {
  /** 主旋律と同時に鳴っていて比べられた線の音 */
  compared: number
  /** そのうち主旋律より上の音 */
  above: number
  /** 比べられた音が続く所で、主旋律との上下が入れ替わった回数(同じ高さは入れ替わりに数えない。主旋律の休み・パート自身の休みで続きを切る) */
  crossings: number
}

/** 主旋律との上下関係。上にある割合と、上下が入れ替わる交差を分けて残す */
export function observeRegister(sourceLine: readonly MelodyNote[], sourceLead: readonly MelodyNote[]): RegisterObservation {
  const result: RegisterObservation = { compared: 0, above: 0, crossings: 0 }
  const line = toGrid(sourceLine)
  const lead = toGrid(sourceLead)
  let previousSide = 0
  let previousBeat: number | null = null
  let previousPartEnd: number | null = null
  for (const note of line) {
    // パート自身の休みを挟んだ所でも、続きを切る(休みの間にいつ入れ替わったかは観測できない)
    if (previousPartEnd !== null && note.startBeat > previousPartEnd + 1e-6) {
      previousSide = 0
      previousBeat = null
    }
    previousPartEnd = previousPartEnd === null ? note.startBeat + note.durationBeats : Math.max(previousPartEnd, note.startBeat + note.durationBeats)
    const other = soundingAt(lead, note.startBeat)
    // 主旋律が鳴っていない所では上下を比べられないので、続きを切る(休みの間に入れ替わったかは観測できない)
    if (!other) {
      previousSide = 0
      previousBeat = null
      continue
    }
    // 前に比べた音からこの音までの間に主旋律の休みがあれば、そこでも続きを切る
    if (previousBeat !== null) {
      for (let beat = previousBeat; beat < note.startBeat - 1e-6; beat += .25) {
        if (!soundingAt(lead, beat + 1e-3)) {
          previousSide = 0
          break
        }
      }
    }
    previousBeat = note.startBeat
    result.compared += 1
    const side = Math.sign(note.pitch - other.pitch)
    if (side > 0) result.above += 1
    if (side !== 0) {
      if (previousSide !== 0 && side !== previousSide) result.crossings += 1
      previousSide = side
    }
  }
  return result
}

/** 区間のうち、どの音も鳴っていない拍の割合(16分音符の格子で数える) */
export function silentShare(sourceLayers: readonly (readonly MelodyNote[])[], totalBeats: number): number {
  const layers = sourceLayers.map(toGrid)
  const steps = Math.round(totalBeats * 4)
  let silent = 0
  for (let step = 0; step < steps; step += 1) {
    const beat = step / 4 + 1e-3
    if (!layers.some((notes) => soundingAt(notes, beat))) silent += 1
  }
  return steps > 0 ? silent / steps : 0
}
