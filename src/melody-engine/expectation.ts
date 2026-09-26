import type { MelodyNote } from "@/core/melody"
import { parseKey } from "@/core/scale"
import songExpectationJson from "./reference/songExpectation.json"

/**
 * 旋律の「予想しやすさ」(IDyOM を簡単にしたもの。作り方は tools/melody-reference/build_expectation_model.py)。
 *
 * 聴き手は聴き慣れた歌から「次はこう動くだろう」という予想を持っている(Huron 2006)。
 *   - 覚えやすい部分・耳に残る曲は、音の動きが「よくある形」に近い(Van Balen et al. 2015、Jakubowski et al. 2017)
 *   - 好まれるのは予想しやすさが中くらいのもの(Gold et al. 2019)。予想どおりすぎても外れすぎても好まれにくい
 * 物差しはパブリックドメインの歌502曲(OpenEWLD)の音程の出やすさだけで作っている(旋律そのものは持たない)。
 * 音高の低次の統計モデルで、IDyOM と同等ではない。音価・休符・拍・和音・テンポは確率に入らないので、
 * リズムや和声の良し悪しはこの値で代用できない。歌の25〜75パーセンタイルは「よくある範囲」であって、
 * 人が最も好む範囲の実測値ではない(過度な予想外さを抑えるための仮説的な重みとして使う)。
 * 生成した旋律は、長調・短調とも歌の上位25%より予想しにくいものが半分以上あった(歌では25%)。
 */
type Percentiles = Record<"p5" | "p10" | "p25" | "p50" | "p75" | "p90" | "p95", number>

interface SongExpectationModel {
  bins: number
  beta: number
  betaShort: number
  /** 窓の長さ(拍)ごと・長調/短調ごとの、窓の平均情報量の分布 */
  calibration: Record<string, Record<"major" | "minor", Percentiles>>
  windowBeats: number[]
  minNotes: Record<string, number>
  counts3: number[][][][]
  counts2: number[][][]
  counts1: number[][]
}

const MODEL = songExpectationJson as unknown as SongExpectationModel
const TOTALS1 = MODEL.counts1.map((row) => row.reduce((sum, value) => sum + value, 0))
const TOTALS2 = MODEL.counts2.map((mode) => mode.map((row) => row.reduce((sum, value) => sum + value, 0)))
const TOTALS3 = MODEL.counts3.map((mode) => mode.map((degree) => degree.map((row) => row.reduce((sum, value) => sum + value, 0))))

const intervalBin = (interval: number) => Math.max(-13, Math.min(13, interval)) + 13

function previousClass(interval: number): number {
  if (interval <= -5) return 0
  if (interval <= -3) return 1
  if (interval < 0) return 2
  if (interval === 0) return 3
  if (interval <= 2) return 4
  if (interval <= 4) return 5
  return 6
}

/** 各音(2音目以降)の情報量(ビット)。大きいほど予想外 */
export function noteInformation(source: readonly MelodyNote[], key: string): number[] {
  const parsed = parseKey(key)
  if (!parsed) return []
  const notes = [...source].sort((a, b) => a.startBeat - b.startBeat)
  const mode = parsed.isMinor ? 1 : 0
  const { bins, beta, betaShort } = MODEL
  const shortTerm = new Map<string, number[]>()
  const values: number[] = []
  for (let index = 1; index < notes.length; index++) {
    const degree = (((notes[index - 1].pitch - parsed.rootPc) % 12) + 12) % 12
    const previous = index >= 2 ? previousClass(notes[index - 1].pitch - notes[index - 2].pitch) : 3
    const x = intervalBin(notes[index].pitch - notes[index - 1].pitch)
    const p1 = (MODEL.counts1[mode][x] + 1) / (TOTALS1[mode] + bins)
    const p2 = (MODEL.counts2[mode][degree][x] + beta * p1) / (TOTALS2[mode][degree] + beta)
    const p3 = (MODEL.counts3[mode][degree][previous][x] + beta * p2) / (TOTALS3[mode][degree][previous] + beta)
    // その曲の中でくり返された動きは予想しやすくなる(短期の予想)
    const contextKey = `${degree}:${previous}`
    const seen = shortTerm.get(contextKey) ?? new Array<number>(bins).fill(0)
    const seenTotal = seen.reduce((sum, value) => sum + value, 0)
    const p = (seen[x] + betaShort * p3) / (seenTotal + betaShort)
    seen[x] += 1
    shortTerm.set(contextKey, seen)
    values.push(-Math.log2(p))
  }
  return values
}

export interface ExpectationProfile {
  /** 平均情報量(ビット/音) */
  meanInformation: number
  /** 歌502曲の8小節ごとの分布での位置(0〜100) */
  songPercentile: number
  /**
   * 予想しやすさの適切さ(0〜1)。歌の25〜75パーセンタイルなら1。
   * それより予想しにくいと下がり、95パーセンタイルで0。予想どおりすぎる(5パーセンタイル未満)ときは0.85まで下げる
   */
  score: number
}

/**
 * 較正と同じ窓で測る: 最初の発音から windowBeats 拍ごとに区切り、窓ごとに短期の予想をリセットして平均する。
 * 候補全体を一度に測ると、長いセクションほど短期の予想が効いて値が下がり、較正した分位点と比べられない。
 * 32拍に満たないセクションは16拍の窓と、その較正を使う。
 */
function windowsOf(notes: readonly MelodyNote[], totalBeats?: number): { windowBeats: number; windows: MelodyNote[][] } {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  // 窓の長さはセクションの長さで決める(8小節の旋律は最後の音が32拍目より前にあるので、音の広がりでは決めない)
  const length = totalBeats ?? sorted[sorted.length - 1].startBeat + sorted[sorted.length - 1].durationBeats
  const windowBeats = length >= 32 - 1e-6 ? 32 : 16
  const minimum = MODEL.minNotes[String(windowBeats)] ?? 8
  const windows: MelodyNote[][] = []
  for (let start = sorted[0].startBeat; start < sorted[sorted.length - 1].startBeat + 1e-6; start += windowBeats) {
    const window = sorted.filter((note) => note.startBeat >= start - 1e-6 && note.startBeat < start + windowBeats - 1e-6)
    if (window.length >= minimum) windows.push(window)
  }
  return { windowBeats, windows }
}

export function measureExpectation(
  notes: readonly MelodyNote[],
  key: string | undefined,
  /** セクションの長さ(拍)。32拍以上なら32拍、未満なら16拍の窓と較正を使う */
  totalBeats?: number,
): ExpectationProfile | null {
  if (!key || notes.length < 5) return null
  const parsed = parseKey(key)
  if (!parsed) return null
  const { windowBeats, windows } = windowsOf(notes, totalBeats)
  const means = windows
    .map((window) => noteInformation(window, key))
    .filter((values) => values.length > 0)
    .map((values) => values.reduce((sum, value) => sum + value, 0) / values.length)
  if (means.length === 0) return null
  const meanInformation = means.reduce((sum, value) => sum + value, 0) / means.length
  const c = MODEL.calibration[String(windowBeats)][parsed.isMinor ? "minor" : "major"]
  const anchors: [number, number][] = [[c.p5, 5], [c.p10, 10], [c.p25, 25], [c.p50, 50], [c.p75, 75], [c.p90, 90], [c.p95, 95]]
  let songPercentile = meanInformation <= c.p5 ? 5 * meanInformation / c.p5 : 100
  for (let index = 1; index < anchors.length; index++) {
    const [low, lowQ] = anchors[index - 1]
    const [high, highQ] = anchors[index]
    if (meanInformation >= low && meanInformation <= high) {
      songPercentile = lowQ + (highQ - lowQ) * (meanInformation - low) / Math.max(1e-9, high - low)
    }
  }
  if (meanInformation > c.p95) songPercentile = Math.min(100, 95 + 5 * (meanInformation - c.p95) / Math.max(1e-9, c.p95 - c.p75))
  const score = meanInformation > c.p75
    ? Math.max(0, 1 - (meanInformation - c.p75) / Math.max(1e-9, c.p95 - c.p75))
    : meanInformation < c.p25
      ? 0.85 + 0.15 * Math.max(0, Math.min(1, (meanInformation - c.p5) / Math.max(1e-9, c.p25 - c.p5)))
      : 1
  return { meanInformation, songPercentile, score }
}
