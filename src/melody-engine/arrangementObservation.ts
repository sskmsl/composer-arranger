import type { MelodyNote } from "@/core/melody"

/**
 * 記録用: アレンジのパート(イントロ・短いフレーズ・対旋律・装飾)と主旋律の関係を観測する。
 * 観測だけを共通にし、選抜の重みや除外条件は役割ごとに決める(対旋律・補強の重複・単独のイントロで目的が違う)。
 * 生成や選抜には使わない。
 */

const pc = (pitch: number) => ((pitch % 12) + 12) % 12
const OVERLAP_BEATS = .5 - 1e-6

/**
 * 同じ開始の音は最高音1つにした線(和音の素材を1本の線として見る代理。モチーフの核や持続する内声そのものではない)。
 * 演奏処理は和音の音ごとに数ミリ秒ずつ開始をずらすので、開始は16分音符の格子に丸めてまとめる
 */
export function topLine(notes: readonly MelodyNote[]): MelodyNote[] {
  const byStart = new Map<number, MelodyNote>()
  for (const note of notes) {
    const start = Math.round(note.startBeat * 4) / 4
    const current = byStart.get(start)
    if (!current || current.pitch < note.pitch) byStart.set(start, note)
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
export function observeParallels(line: readonly MelodyNote[], lead: readonly MelodyNote[]): ParallelObservation {
  const result: ParallelObservation = { movingPairs: 0, similarMotionPairs: 0, parallelPerfect: 0 }
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
  /** 他の音と0.5拍以上重なる音 */
  overlapNotes: number
  /** 重なっている拍数の合計 */
  overlapBeats: number
  /** 短2度(1半音)で重なる音と、その重なりの拍数 */
  minorSecond: number
  minorSecondBeats: number
  /** 長7度(11半音)で重なる音 */
  majorSeventh: number
  /** 短9度・長14度などの複音程で重なる音 */
  compound: number
  /** 短2度の重なりのうち、拍の頭(16分音符の格子に丸めた整数拍)で始まるもの */
  minorSecondOnBeat: number
  /** 短2度の重なりのうち、次の音が2半音以内に動いて解決するもの */
  minorSecondResolved: number
}

/** 他の音との半音系のぶつかり。実際の音域の間隔・長さ・拍の位置・解決を分けて残す */
export function observeClashes(notes: readonly MelodyNote[], others: readonly MelodyNote[]): ClashObservation {
  const result: ClashObservation = {
    overlapNotes: 0, overlapBeats: 0, minorSecond: 0, minorSecondBeats: 0, majorSeventh: 0, compound: 0, minorSecondOnBeat: 0, minorSecondResolved: 0,
  }
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  sorted.forEach((note, index) => {
    const overlaps = others
      .map((other) => ({
        other,
        beats: Math.min(other.startBeat + other.durationBeats, note.startBeat + note.durationBeats) - Math.max(other.startBeat, note.startBeat),
      }))
      .filter(({ beats }) => beats >= OVERLAP_BEATS)
    if (overlaps.length === 0) return
    result.overlapNotes += 1
    result.overlapBeats += Math.max(...overlaps.map(({ beats }) => beats))
    const distances = overlaps.map(({ other, beats }) => ({ distance: Math.abs(note.pitch - other.pitch), beats }))
    const minorSecond = distances.filter(({ distance }) => distance === 1)
    if (minorSecond.length > 0) {
      result.minorSecond += 1
      result.minorSecondBeats += Math.max(...minorSecond.map(({ beats }) => beats))
      const nominal = Math.round(note.startBeat * 4) / 4
      if (Math.abs(nominal - Math.round(nominal)) < 1e-6) result.minorSecondOnBeat += 1
      const next = sorted[index + 1]
      if (next && next.pitch !== note.pitch && Math.abs(next.pitch - note.pitch) <= 2) result.minorSecondResolved += 1
    } else if (distances.some(({ distance }) => distance === 11)) {
      result.majorSeventh += 1
    } else if (distances.some(({ distance }) => distance > 12 && [1, 11].includes(distance % 12))) {
      result.compound += 1
    }
  })
  return result
}

export interface RegisterObservation {
  /** 主旋律と同時に鳴っていて比べられた線の音 */
  compared: number
  /** そのうち主旋律より上の音 */
  above: number
  /** 比べられた音が続く所で、主旋律との上下が入れ替わった回数(同じ高さは入れ替わりに数えない) */
  crossings: number
}

/** 主旋律との上下関係。上にある割合と、上下が入れ替わる交差を分けて残す */
export function observeRegister(line: readonly MelodyNote[], lead: readonly MelodyNote[]): RegisterObservation {
  const result: RegisterObservation = { compared: 0, above: 0, crossings: 0 }
  let previousSide = 0
  for (const note of line) {
    const other = soundingAt(lead, note.startBeat)
    if (!other) continue
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
export function silentShare(layers: readonly (readonly MelodyNote[])[], totalBeats: number): number {
  const steps = Math.round(totalBeats * 4)
  let silent = 0
  for (let step = 0; step < steps; step += 1) {
    const beat = step / 4 + 1e-3
    if (!layers.some((notes) => soundingAt(notes, beat))) silent += 1
  }
  return steps > 0 ? silent / steps : 0
}
