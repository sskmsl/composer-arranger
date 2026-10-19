import type { ComposerProject } from "@/core/project"
import type { ArrangementPlan, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { EmotionalMechanismId } from "@/core/emotionalMechanism"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import { parseTimeSignature } from "@/core/section"

/**
 * アレンジが感情を動かす仕組みを、実音(または録音の小節ごとの分析)から測る。
 *
 * 曲線は、小節ごとの dB で表す。録音から作った曲線も、生成した音から作った曲線も同じ関数で採点するので、
 * 参照で較正した基準を、生成物にそのまま当てられる。
 * 点数は「聴感の感動」を保証しない。仕組みが音の上で起きているかを調べる代理値で、メロディ側の
 * 感情曲線の構造指標(docs/emotional-arc-melody-audit.md)と同じ位置づけ。
 */
export interface EmotionCurves {
  /** 土台(低域の層)の強さ */
  weightDb: number[]
  /** 明るさ・空気(高域の層)の強さ */
  brightnessDb: number[]
  /** 全体の強さ */
  energyDb: number[]
  /** その小節で新しく入った層の数(直前の小節で鳴っていなかった層) */
  entries: number[]
}

export interface MechanismMeasure {
  id: EmotionalMechanismId
  /** 0〜1。仕組みが音の上でどれだけ起きているか */
  score: number
  /** score が下の閾値を超えた */
  present: boolean
  /** 起きた小節(0始まり)。終止の減衰では測り始めの小節 */
  at: number | null
  detail: Record<string, number>
}

export interface EmotionReport {
  bars: number
  mechanisms: Record<EmotionalMechanismId, MechanismMeasure | null>
  /** 0〜100。参照で較正した重みで仕組みの得点を合わせた代理値 */
  arcScore: number
}

/** 仕組みが働いたと見なす最低点 */
export const MECHANISM_PRESENT_THRESHOLD = 0.5
/** 基準より何dB低ければ「保留」と見なすか */
export const WITHHELD_DB = 8
/** 戻りと見なす最低の上がり幅(dB) */
export const RETURN_STEP_DB = 4
/** 仕組みの得点を arcScore へ合わせる重み。参照録音での観察本数の多い順 */
export const ARC_WEIGHTS: Record<EmotionalMechanismId, number> = {
  "closure-decay": 0.4,
  "expectation-arrival": 0.35,
  accumulation: 0.15,
  "subtraction-contrast": 0.1,
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0
}

/** 曲線の基準: 最大から12dB以内の小節の中央値(曲が「全開」のときの水準)。 */
function referenceLevel(curve: number[]): number {
  const peak = Math.max(...curve)
  return median(curve.filter((value) => value >= peak - 12))
}

interface Recovery {
  start: number
  end: number
  depth: number
  step: number
  entries: number
}

/** 基準より8dB以上低い状態が2小節以上続き、その後に4dB以上で戻る区間。曲の終わりへ消える区間は含めない。 */
function recoveries(curve: number[], entries: number[]): Recovery[] {
  const reference = referenceLevel(curve)
  const result: Recovery[] = []
  let index = 0
  while (index < curve.length) {
    if (curve[index] > reference - WITHHELD_DB) { index++; continue }
    let end = index
    while (end < curve.length && curve[end] <= reference - WITHHELD_DB) end++
    if (end - index >= 2 && end + 1 < curve.length) {
      const before = mean(curve.slice(Math.max(index, end - 2), end))
      const after = mean(curve.slice(end, end + 2))
      if (after - before >= RETURN_STEP_DB) {
        result.push({
          start: index, end,
          depth: reference - mean(curve.slice(index, end)),
          step: after - before,
          entries: entries[end] ?? 0,
        })
      }
    }
    index = Math.max(end, index + 1)
  }
  return result
}

function recoveryScore(recovery: Recovery, lengthCap: number): number {
  return clamp01(
    0.25 * clamp01((recovery.depth - WITHHELD_DB) / 8 + 0.5)
    + 0.2 * clamp01((recovery.end - recovery.start) / lengthCap)
    + 0.35 * clamp01(recovery.step / 12)
    + 0.2 * clamp01((recovery.entries - 1) / 3),
  )
}

/** 終わりの無音(録音のフェードの先、または曲の後ろの休み)を除いた、音のある小節数。 */
function bodyLength(energy: number[]): number {
  const level = median(energy)
  let end = energy.length
  while (end > 8 && energy[end - 1] < level - 30) end--
  return end
}

export function measureEmotionFromCurves(curves: EmotionCurves): EmotionReport {
  const bars = curves.energyDb.length
  const mechanisms: Record<EmotionalMechanismId, MechanismMeasure | null> = {
    "expectation-arrival": null, "subtraction-contrast": null, "closure-decay": null, accumulation: null,
  }
  if (bars < 8) return { bars, mechanisms, arcScore: 0 }
  const weightRecoveries = recoveries(curves.weightDb, curves.entries)
  const brightnessRecoveries = recoveries(curves.brightnessDb, curves.entries)

  // 期待→到来: 曲の最初から保留された土台が、一点で戻る
  const opening = weightRecoveries.filter((recovery) => recovery.start <= 1)
  const bestOpening = opening.sort((a, b) => recoveryScore(b, 8) - recoveryScore(a, 8))[0]
  const arrivalScore = bestOpening ? recoveryScore(bestOpening, 8) : 0
  mechanisms["expectation-arrival"] = {
    id: "expectation-arrival", score: arrivalScore, present: arrivalScore >= MECHANISM_PRESENT_THRESHOLD,
    at: bestOpening?.end ?? null,
    detail: bestOpening
      ? { withheldBars: bestOpening.end - bestOpening.start, depthDb: bestOpening.depth, stepDb: bestOpening.step, simultaneousEntries: bestOpening.entries }
      : {},
  }

  // 引き算による対比: 最初ではない場所で土台か空気を引き、戻す
  const later = [...weightRecoveries, ...brightnessRecoveries].filter((recovery) => recovery.start > 8)
  const bestLater = later.sort((a, b) => recoveryScore(b, 4) - recoveryScore(a, 4))[0]
  const subtractionScore = bestLater ? recoveryScore(bestLater, 4) : 0
  mechanisms["subtraction-contrast"] = {
    id: "subtraction-contrast", score: subtractionScore, present: subtractionScore >= MECHANISM_PRESENT_THRESHOLD,
    at: bestLater?.end ?? null,
    detail: bestLater ? { withheldBars: bestLater.end - bestLater.start, depthDb: bestLater.depth, stepDb: bestLater.step } : {},
  }

  // 終止の減衰: 音のある最後の4小節で、強さが下がり続ける
  const end = bodyLength(curves.energyDb)
  const span = Math.min(4, end - 1)
  const tail = curves.energyDb.slice(end - span - 1, end)
  const drop = tail[tail.length - 1] - tail[0]
  const nonIncreasing = tail.slice(1).filter((value, i) => value <= tail[i] + 0.5).length / Math.max(1, tail.length - 1)
  // 録音が無音へ消えていく場合は、その先の落ち込みも終止の減衰に数える
  const fullDrop = curves.energyDb[bars - 1] - curves.energyDb[Math.max(0, end - span - 1)]
  const effectiveDrop = Math.min(drop, fullDrop)
  const closureScore = clamp01(-effectiveDrop / 12) * (0.5 + 0.5 * nonIncreasing)
  mechanisms["closure-decay"] = {
    id: "closure-decay", score: closureScore, present: closureScore >= MECHANISM_PRESENT_THRESHOLD,
    at: end - span - 1, detail: { dropDb: -effectiveDrop, nonIncreasingRatio: nonIncreasing },
  }

  // 蓄積: 最初の到来より前(無ければ最初の8小節)で、強さが小節ごとに上がる
  const stretch = Math.max(4, Math.min(bestOpening ? bestOpening.end : 8, end))
  const opener = curves.energyDb.slice(0, stretch)
  let slope = 0
  if (opener.length >= 4) {
    const xs = opener.map((_, i) => i), mx = mean(xs), my = mean(opener)
    slope = xs.reduce((sum, x, i) => sum + (x - mx) * (opener[i] - my), 0) / xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
  }
  const rise = slope * (opener.length - 1)
  const accumulationScore = clamp01(rise / 6)
  mechanisms.accumulation = {
    id: "accumulation", score: accumulationScore, present: accumulationScore >= MECHANISM_PRESENT_THRESHOLD,
    at: 0, detail: { riseDb: rise, bars: opener.length },
  }

  const arcScore = 100 * (Object.keys(ARC_WEIGHTS) as EmotionalMechanismId[])
    .reduce((sum, id) => sum + ARC_WEIGHTS[id] * (mechanisms[id]?.score ?? 0), 0)
  return { bars, mechanisms, arcScore: Math.round(arcScore * 10) / 10 }
}

// ---------------------------------------------------------------------------
// 生成した音から曲線を作る
// ---------------------------------------------------------------------------
const DB_FLOOR_OFFSET = 48
const BRIGHT_IDS = new Set([
  "dr-closed-hat", "dr-open-hat", "dr-shaker", "dr-ride", "dr-crash", "dr-cymbal-swell",
  "syn-high-glass", "syn-arp-high", "str-upper", "str-high-octave", "syn-pad-air",
])
const LOW_IDS = new Set(["dr-kick", "dr-kick-sub", "dr-kick-click", "syn-bass", "syn-sub-bass", "syn-bass-mid", "str-contrabass"])

/** 小節ごとの強さを足し合わせ、dB へ。0 の小節は、最大より48dB下の床に置く。 */
function toDb(linear: number[]): number[] {
  const peak = Math.max(...linear, 1e-9)
  const floor = 20 * Math.log10(peak) - DB_FLOOR_OFFSET
  return linear.map((value) => value > 0 ? Math.max(floor, 20 * Math.log10(value)) : floor)
}

export function emotionCurvesFromTracks(
  project: ComposerProject,
  tracks: GeneratedArrangementTrack[],
): EmotionCurves {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const sections = normalizeSectionTimeline(project.sections)
  const bars = sections.reduce((max, section) => Math.max(max, section.startBar + section.lengthBars - 1), 0)
  const weight = new Array<number>(bars).fill(0)
  const brightness = new Array<number>(bars).fill(0)
  const energy = new Array<number>(bars).fill(0)
  const sounding = Array.from({ length: bars }, () => new Set<string>())
  for (const track of tracks) {
    if (track.muted) continue
    const isDrum = track.family === "drums"
    for (const note of track.notes) {
      const amplitude = note.velocity / 127
      const firstBar = Math.max(0, Math.floor(note.startBeat / beatsPerBar))
      const lastBar = Math.min(bars - 1, Math.floor((note.startBeat + Math.max(note.durationBeats, 0.01) - 1e-6) / beatsPerBar))
      for (let bar = firstBar; bar <= lastBar; bar++) {
        // 打楽器は鳴った回数で、持続する音は小節の中で鳴っていた長さで数える
        const overlap = isDrum
          ? (bar === firstBar ? 0.25 : 0)
          : Math.max(0, Math.min(note.startBeat + note.durationBeats, (bar + 1) * beatsPerBar) - Math.max(note.startBeat, bar * beatsPerBar)) / beatsPerBar
        if (overlap <= 0) continue
        const value = amplitude * overlap
        energy[bar] += value
        sounding[bar].add(track.id)
        if (LOW_IDS.has(track.id) || (!isDrum && note.pitch < 48)) weight[bar] += value
        if (BRIGHT_IDS.has(track.id) || (!isDrum && note.pitch >= 76)) brightness[bar] += value
      }
    }
  }
  const entries = sounding.map((set, bar) => bar === 0
    ? 0
    : [...set].filter((id) => !sounding[bar - 1].has(id) && (bar < 2 || !sounding[bar - 2].has(id))).length)
  return { weightDb: toDb(weight), brightnessDb: toDb(brightness), energyDb: toDb(energy), entries }
}

export function measureArrangementEmotion(
  project: ComposerProject,
  arrangement: { plan: ArrangementPlan, tracks: GeneratedArrangementTrack[] },
): EmotionReport {
  return measureEmotionFromCurves(emotionCurvesFromTracks(project, arrangement.tracks))
}
