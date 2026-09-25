import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote } from "@/core/melody"
import { buildHarmonicMap } from "./harmonicMap"
import { buildFeatureModel, classicalLikeness, densityAt, jointPercentile, type ClassicalModel } from "./classicalLikeness"
import { refineTowardClassical } from "./classicalRefinement"
import { measureMelodyCraft } from "./melodyCraftMetrics"
import modelJson from "./reference/classicalModel.json"
import { CLASSICAL_MODELS } from "./classicalModels"

const model = modelJson as ClassicalModel
const chords = parseChordInputText("C | Am | F | G | C | F | G | C", "s1", 4, "c")
const n = (startBeat: number, pitch: number, durationBeats = 1, extra: Partial<MelodyNote> = {}): MelodyNote => ({
  id: `${startBeat}`, startBeat, durationBeats, pitch, velocity: 90, locks: [], plannedToneRole: "chord-tone", ...extra,
})
// コードの音の間を大きく跳び回る旋律(古典らしさが低い)
const leaping = [0, 4, 8, 12, 16, 20, 24, 28].flatMap((bar, index) => {
  const tones = [[60, 67, 76, 64], [69, 60, 76, 64], [65, 72, 60, 69], [67, 74, 62, 71], [72, 64, 67, 60], [65, 77, 69, 72], [71, 62, 74, 67], [72, 64, 60, 72]][index]
  return tones.map((pitch, beat) => n(bar + beat, pitch))
})

describe("古典らしさ(古典=100)", () => {
  it("学習に使っていない古典の旋律の真ん中が100になるよう目盛りを合わせてある", () => {
    expect(model.holdout.p50).toBeCloseTo(100, 0)
    expect(model.holdout.p25).toBeLessThan(100)
    expect(model.units.fit).toBeGreaterThan(500)
    expect(model.units.holdout).toBeGreaterThan(80)
  })

  it("物差しの組み合わせの分布も、学習に使っていない古典の旋律で目盛りを合わせてある", () => {
    const joint = CLASSICAL_MODELS.joint
    expect(joint.components.length).toBeGreaterThanOrEqual(4)
    expect(joint.holdoutLogDensityQuantiles).toHaveLength(101)
    // 真ん中の古典の旋律は 0.5(= 古典らしさ100)、下位1割は 0.1
    expect(jointPercentile(joint.holdoutLogDensityQuantiles[50], joint)).toBeCloseTo(0.5, 2)
    expect(jointPercentile(joint.holdoutLogDensityQuantiles[10], joint)).toBeCloseTo(0.1, 2)
  })

  it("なめらかな分布を作り、よくある値ほど高くなる", () => {
    const feature = buildFeatureModel([0.4, 0.5, 0.5, 0.55, 0.6, 0.6, 0.65, 0.7].map((value) => ({ value, weight: 1 })), { label: "x", weight: 1, minimumBandwidth: 0.02 })
    expect(densityAt(feature, 0.58)).toBeGreaterThan(densityAt(feature, 0.9))
    expect(densityAt(feature, 5)).toBe(0)
  })

  it("跳び回る旋律は古典らしさが低く、内訳に古典の中央値が付く", () => {
    const result = classicalLikeness(measureMelodyCraft(leaping, chords, "C"), CLASSICAL_MODELS)
    expect(result.score).toBeLessThan(80)
    const stepwise = result.items.find((item) => item.key === "stepwise")!
    expect(stepwise.classicalMedian).toBeGreaterThan(0.5)
  })

  it("推敲すると古典らしさが上がり、形(音の数・リズム)と冒頭・最後の音・固定した音は変えない", () => {
    const locked = leaping.map((note) => (note.startBeat === 9 ? { ...note, locks: ["pitch" as const] } : note))
    const result = refineTowardClassical(locked, {
      harmonicMap: buildHarmonicMap(chords), range: { low: 55, high: 81 }, totalBeats: 32, sectionRole: "verse", key: "C", models: CLASSICAL_MODELS,
    })
    // 推敲は分布の高さ(対数)を上げる。点数(古典=100)でもはっきり上がる
    expect(result.after).toBeGreaterThan(result.before)
    const score = (notes: MelodyNote[]) => classicalLikeness(measureMelodyCraft(notes, chords, "C"), CLASSICAL_MODELS).score
    expect(score(result.notes)).toBeGreaterThan(score(locked) + 5)
    expect(result.notes.map((note) => [note.startBeat, note.durationBeats])).toEqual(locked.map((note) => [note.startBeat, note.durationBeats]))
    for (const beat of [0, 1, 2, 3, 9, 31]) {
      expect(result.notes.find((note) => note.startBeat === beat)!.pitch).toBe(locked.find((note) => note.startBeat === beat)!.pitch)
    }
    // 拍頭(1・3拍目)はコードの音のまま
    const harmonicMap = buildHarmonicMap(chords)
    for (const note of result.notes.filter((item) => item.startBeat % 2 === 0)) {
      const entry = harmonicMap.find((item) => note.startBeat >= item.chord.startBeat && note.startBeat < item.chord.startBeat + item.chord.durationBeats)!
      expect(entry.parsed.tones.map((tone) => tone.pitchClass)).toContain(note.pitch % 12)
    }
    expect(result.notes.every((note) => note.pitch >= 55 && note.pitch <= 81)).toBe(true)
  })
})
