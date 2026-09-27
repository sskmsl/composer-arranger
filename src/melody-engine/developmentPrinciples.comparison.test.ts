import { describe, expect, it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { classifyMotifRelation, measureMotifDevelopment } from "./motifRecognition"
import { classicalLikeness } from "./classicalLikeness"
import { CLASSICAL_MODELS } from "./classicalModels"
import { measureMelodyCraft } from "./melodyCraftMetrics"
import { judgeCoreMotif } from "./hookFirst"
import { assessEmotionalArc } from "./emotionalArc"
import { buildHarmonicMap } from "./harmonicMap"
import type { ChordEvent } from "@/core/project"

/**
 * 同じコード・テンポ・セクション・シードで、動機の育て方を測る(変更前後の比較用)。
 * 環境変数 DEVELOPMENT_COMPARISON_OUT にファイル名を渡すと、測った値を書き出す。
 */

const SONGS = [
  { key: "C", chords: "F | G | Em | Am | Dm | G | C | C" },
  { key: "Am", chords: "Am | F | G | E7 | Am | F | E7 | Am" },
  { key: "G", chords: "G | D/F# | Em | C | Am | D | G | G" },
  { key: "Dm", chords: "Dm | Bb | F | C | Gm | Bb | A7 | Dm" },
]
const SEEDS = [101, 202, 303]
const ROLES: SectionRole[] = ["verse", "chorus"]
const PHRASE_BEATS = 8

interface Sample { notes: MelodyNote[]; chords: ChordEvent[]; bars: number; role: SectionRole; hum: number; hook: number; arc: number; classical: number; coreRhythm?: "varied" | "plain" }

function generate(bars: 8 | 16): Sample[] {
  const samples: Sample[] = []
  for (const song of SONGS) {
    const text = bars === 16 ? `${song.chords} | ${song.chords}` : song.chords
    const chords = parseChordInputText(text, "s1", 4, "c")
    for (const role of ROLES) for (const seed of SEEDS) {
      const { candidates } = generateFromChordsWithProfiles({
        chords, sectionId: "s1", sectionRole: role, songProfile: "dark-romantic", density: "balanced",
        range: RANGE_PRESETS.middle, drama: "growing", totalBeats: bars * 4, seed, profiles: ["standard", "cinematic"], key: song.key,
      })
      for (const candidate of candidates) {
        samples.push({
          notes: candidate.notes, chords, bars, role,
          hum: candidate.coreHumability ?? 0, hook: candidate.coreHookability ?? 0, arc: candidate.emotionalArcScore ?? 0,
          classical: classicalLikeness(measureMelodyCraft(candidate.notes, chords, song.key), CLASSICAL_MODELS).score,
          coreRhythm: candidate.coreRhythm,
        })
      }
    }
  }
  return samples
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)

/** フレーズごとの最高音が、頂点まで少しずつ上がっていくか(一度に跳ね上がらない) */
function gradualGrowth(notes: MelodyNote[], totalBeats: number): number {
  const peaks: number[] = []
  for (let start = 0; start < totalBeats; start += PHRASE_BEATS) {
    const phrase = notes.filter((note) => note.startBeat >= start && note.startBeat < start + PHRASE_BEATS)
    if (phrase.length) peaks.push(Math.max(...phrase.map((note) => note.pitch)))
  }
  const top = peaks.indexOf(Math.max(...peaks))
  if (top <= 0) return 0
  const steps = peaks.slice(0, top + 1).slice(1).map((peak, index) => peak - peaks[index])
  const rising = steps.filter((step) => step >= 0 && step <= 5).length / steps.length
  return rising * Math.min(1, top / Math.max(1, peaks.length - 1) / .6)
}

/** 各フレーズの頭(最初の4音)が、最初のフレーズの頭と同じ Hook だと分かる割合 */
function phraseHeads(notes: MelodyNote[], totalBeats: number): number {
  const heads: MelodyNote[][] = []
  for (let start = 0; start < totalBeats; start += PHRASE_BEATS) {
    heads.push(notes.filter((note) => note.startBeat >= start && note.startBeat < start + PHRASE_BEATS).slice(0, 4))
  }
  const first = heads[0]
  if (!first || first.length < 3) return 0
  const later = heads.slice(1).filter((head) => head.length >= 2)
  return later.filter((head) => classifyMotifRelation(first, first[0].startBeat, head, head[0].startBeat).relation !== "other").length / Math.max(1, later.length)
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0
}

/**
 * 小節ごとに、それより前の小節と、その小節で発音した音の音高・発音位置・音価(16分音符単位に丸める)が
 * まったく同じ小節の数。前の小節から持続して入ってくる音は数えない(その小節で発音した音だけの一致)
 */
export function exactBarRepeats(notes: readonly MelodyNote[], totalBeats: number): number {
  const q = (beat: number) => Math.round(beat * 4) / 4
  const bars = Array.from({ length: Math.ceil(totalBeats / 4) }, (_, bar) => JSON.stringify(notes
    .filter((note) => note.startBeat >= bar * 4 - 1e-6 && note.startBeat < bar * 4 + 4 - 1e-6)
    .map((note) => [q(note.startBeat - bar * 4), note.pitch, q(note.durationBeats)])))
  return bars.filter((bar, index) => bar !== "[]" && bars.indexOf(bar) !== index).length
}

/** 区間の中で鳴っていない時間の割合(音の重なりと区間の外への持続を除いた、発音区間の和で測る) */
export function restShare(notes: readonly MelodyNote[], totalBeats: number): number {
  const spans = notes
    .map((note) => [Math.max(0, note.startBeat), Math.min(totalBeats, note.startBeat + note.durationBeats)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  let sounding = 0
  let coveredUntil = 0
  for (const [start, end] of spans) {
    if (end <= coveredUntil) continue
    sounding += end - Math.max(start, coveredUntil)
    coveredUntil = end
  }
  return 1 - sounding / totalBeats
}

/**
 * サビの核の型(従来 varied / 素直 plain)ごとの内訳(サビの候補だけ)。型ごとの覚えやすさは相互に較正していないので、
 * 混ぜた平均で下限を通るだけでは素直な型の品質を独立に確かめたことにならない(Codex desktop のレビュー、PR #174)。
 * 記録用で、下限は設けていない
 */
function byCoreRhythm(samples: Sample[]) {
  // 型を分けるのはサビだけ(Aメロの核はすべて従来の型なので、混ぜると比べられない)
  const withCore = samples.filter((s) => s.role === "chorus" && s.coreRhythm !== undefined)
  return Object.fromEntries((["varied", "plain"] as const).map((style) => {
    const rows = withCore.filter((s) => s.coreRhythm === style)
    const r = (value: number) => Math.round(value * 1000) / 1000
    return [style, {
      samples: rows.length,
      // 最終候補(選ばれた3案)の中での構成比。プールからの採用率ではない
      shareOfSelected: r(rows.length / Math.max(1, withCore.length)),
      hookabilityMean: r(mean(rows.map((s) => s.hook))),
      hookabilityP10: r(quantile(rows.map((s) => s.hook), .1)),
      hookabilityP50: r(quantile(rows.map((s) => s.hook), .5)),
      humabilityMean: r(mean(rows.map((s) => s.hum))),
      exactBarRepeats: r(mean(rows.map((s) => exactBarRepeats(s.notes, s.bars * 4)))),
      restShare: r(mean(rows.map((s) => restShare(s.notes, s.bars * 4)))),
      recognizable: r(mean(rows.map((s) => measureMotifDevelopment(s.notes, PHRASE_BEATS, s.bars * 4).recognizableShare))),
    }]
  }))
}

function summarize(samples: Sample[]) {
  const dev = samples.map((s) => measureMotifDevelopment(s.notes, PHRASE_BEATS, s.bars * 4))
  const cores = samples.map((s) => judgeCoreMotif(s.notes.filter((note) => note.startBeat < PHRASE_BEATS), PHRASE_BEATS))
  const headCores = samples.map((s) => judgeCoreMotif(s.notes.filter((note) => note.startBeat < 4), 4))
  return {
    samples: samples.length,
    recognizable: mean(dev.map((d) => d.recognizableShare)),
    literalOnly: mean(dev.map((d) => Number(d.literalOnly))),
    transformKinds: mean(dev.map((d) => d.transformKinds)),
    tooManyKinds: mean(dev.map((d) => Number(d.transformKinds > 2))),
    lateReturn: mean(dev.map((d) => Number(d.lateReturn))),
    newPitchShare: mean(dev.map((d) => d.newPitchShare)),
    meanChange: mean(dev.map((d) => d.meanChange)),
    developmentScore: mean(dev.map((d) => d.score)),
    coreHumability: mean(samples.map((s) => s.hum)),
    coreHookability: mean(samples.map((s) => s.hook)),
    firstPhraseHumability: mean(cores.map((c) => c.humability)),
    coreOneThorn: mean(headCores.map((c) => Number(c.thornCount === 1))),
    coreNoThorn: mean(headCores.map((c) => Number(c.thornCount === 0))),
    coreManyThorns: mean(headCores.map((c) => Number(c.thornCount >= 2))),
    phraseHeadRecognized: mean(samples.map((s) => phraseHeads(s.notes, s.bars * 4))),
    emotionalArc: mean(samples.map((s) => s.arc)),
    gradualGrowth: mean(samples.map((s) => gradualGrowth(s.notes, s.bars * 4))),
    classical: mean(samples.map((s) => s.classical)),
    notesPerBeat: mean(samples.map((s) => s.notes.length / (s.bars * 4))),
    arcParts: Object.fromEntries(Object.entries(samples
      .map((s) => assessEmotionalArc(s.notes, buildHarmonicMap(s.chords), s.bars * 4, s.role, 4))
      .reduce<Record<string, number>>((sum, arc) => {
        for (const [key, value] of Object.entries(arc)) sum[key] = (sum[key] ?? 0) + value / samples.length
        return sum
      }, {})).map(([key, value]) => [key, Math.round(value * 1000) / 1000])),
    peakByRole: Object.fromEntries(ROLES.map((role) => {
      const rows = samples.filter((s) => s.role === role).map((s) => assessEmotionalArc(s.notes, buildHarmonicMap(s.chords), s.bars * 4, s.role, 4))
      return [role, { peakPosition: Math.round(mean(rows.map((row) => row.peakPosition)) * 1000) / 1000, climaxTiming: Math.round(mean(rows.map((row) => row.climaxTiming)) * 1000) / 1000 }]
    })),
    byCoreRhythm: byCoreRhythm(samples),
    relationCounts: dev.flatMap((d) => d.relations).reduce<Record<string, number>>((counts, relation) => ({ ...counts, [relation]: (counts[relation] ?? 0) + 1 }), {}),
  }
}

describe("動機の育て方(Core Hook → 反復 → 小変形 → 発展 → 頂点)", () => {
  const eight = summarize(generate(8))
  const sixteen = summarize(generate(16))
  if (process.env.DEVELOPMENT_COMPARISON_OUT) writeFileSync(process.env.DEVELOPMENT_COMPARISON_OUT, JSON.stringify({ eight, sixteen }, null, 2))

  // 変更前(提示→応答→対照→回帰のみ、頭の復元なし)の値をコメントに残す
  it("核が最後まで分かる形で戻る(8小節: 再登場 0.21→0.29、最後の2フレーズで戻る 0.34→0.45)", () => {
    expect(eight.recognizable).toBeGreaterThanOrEqual(.27)
    expect(eight.lateReturn).toBeGreaterThanOrEqual(.4)
    expect(sixteen.recognizable).toBeGreaterThanOrEqual(.28)
    expect(eight.developmentScore).toBeGreaterThanOrEqual(.57)
  })
  it("単純反復だけにならず、変形は散らからない(変形は2種類まで、3種類以上は5%以下)", () => {
    expect(eight.literalOnly).toBeLessThanOrEqual(.05)
    expect(eight.tooManyKinds).toBeLessThanOrEqual(.05)
    expect(sixteen.tooManyKinds).toBeLessThanOrEqual(.06)
    expect(eight.meanChange).toBeLessThanOrEqual(.4)
  })
  it("核の覚えやすさ・歌いやすさ・音数・作りの良さを保つ(変更前 覚えやすさ0.885 / 歌いやすさ0.917 / 0.81音/拍 / 古典らしさ99)", () => {
    expect(eight.coreHookability).toBeGreaterThanOrEqual(.87)
    expect(eight.coreHumability).toBeGreaterThanOrEqual(.9)
    expect(eight.notesPerBeat).toBeLessThanOrEqual(.9)
    expect(sixteen.notesPerBeat).toBeLessThanOrEqual(.9)
    expect(eight.classical).toBeGreaterThanOrEqual(94)
    // 引っかかりが2つ以上(ランダムに聞こえやすい)核を増やさない(変更前 0.27)
    expect(eight.coreManyThorns).toBeLessThanOrEqual(.3)
  })
  it("16小節でも、頂点までの段階的な成長を下げない(変更前 0.38)", () => {
    expect(sixteen.gradualGrowth).toBeGreaterThanOrEqual(.37)
  })
  it("頂点の前後に息継ぎを残し、16小節の頂点を急がない(変更前 息継ぎ 0.71 / 0.70、16小節の頂点の時機 0.865)", () => {
    expect(eight.arcParts.phraseBreathing).toBeGreaterThanOrEqual(.72)
    expect(sixteen.arcParts.phraseBreathing).toBeGreaterThanOrEqual(.71)
    expect(sixteen.arcParts.climaxTiming).toBeGreaterThanOrEqual(.85)
    // 8小節の頂点の時機(変更前 0.858、頂点を急がない下限を入れる前 0.831)
    expect(eight.arcParts.climaxTiming).toBeGreaterThanOrEqual(.84)
  })
})

describe("方式別の内訳に使う集計の定義", () => {
  const n = (startBeat: number, pitch: number, durationBeats: number): MelodyNote =>
    ({ id: `${startBeat}`, startBeat, durationBeats, pitch, velocity: 80, locks: [] })
  it("音高・発音位置が同じでも、音価が違えば完全反復と数えない", () => {
    expect(exactBarRepeats([n(0, 60, 1), n(1, 62, 1), n(4, 60, .5), n(5, 62, .5)], 8)).toBe(0)
    expect(exactBarRepeats([n(0, 60, 1), n(1, 62, 1), n(4, 60, 1), n(5, 62, 1)], 8)).toBe(1)
  })
  it("休符の割合は、重なりと区間の外への持続を数えない", () => {
    expect(restShare([n(0, 60, 2), n(1, 62, 2)], 8)).toBeCloseTo(1 - 3 / 8)
    expect(restShare([n(6, 60, 4)], 8)).toBeCloseTo(1 - 2 / 8)
  })
})

