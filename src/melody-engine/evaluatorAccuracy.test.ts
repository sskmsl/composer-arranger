import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { parseChordInputText } from "@/core/chordInput"
import { classifyMotifRelation, measureMotifDevelopment } from "./motifRecognition"
import { measureMelodyCraft } from "./melodyCraftMetrics"
import { generateSectionContent } from "./generateSectionContent"
import { RANGE_PRESETS } from "./generationParams"
import { assessEmotionalArc, deferEarlySummit } from "./emotionalArc"
import { buildHarmonicMap } from "./harmonicMap"

/**
 * 物差しが名前どおりのことを測っているかの確認(Codex の追加レビュー、PR #166 のコメント)。
 * いずれも人工的な最小例で、既存楽曲の素材ではない。
 */
const note = (startBeat: number, pitch: number, durationBeats = 1): MelodyNote => ({ id: `${startBeat}`, startBeat, durationBeats, pitch, velocity: 80, locks: [] })

describe("完全な反復は、音価と休符も同じときだけ", () => {
  const core = [note(0, 60, 1), note(1, 62, 1), note(2, 64, 1), note(3, 67, 1)]
  it("音程と発音位置が同じでも、伸ばす・切るが違えば「完全反復」ではなく articulation", () => {
    const same = core.map((n) => ({ ...n, startBeat: n.startBeat + 8 }))
    expect(classifyMotifRelation(core, 0, same, 8).relation).toBe("exact")
    const clipped = core.map((n) => ({ ...n, startBeat: n.startBeat + 8, durationBeats: 0.1 }))
    expect(classifyMotifRelation(core, 0, clipped, 8).relation).toBe("articulation")
  })
  it("等間隔のリズムを共有するだけで音程が別なら、核の変形(rhythm)とは数えない", () => {
    const otherPitches = [note(8, 71), note(9, 65), note(10, 72), note(11, 60)]
    expect(classifyMotifRelation(core, 0, otherPitches, 8).relation).not.toBe("rhythm")
    // 等間隔でない特徴的なリズムを保っていれば rhythm
    const dotted = [note(0, 60, 1.5), note(1.5, 62, .5), note(2, 64, 1), note(3, 67, 1)]
    const dottedOther = [note(8, 71, 1.5), note(9.5, 65, .5), note(10, 72, 1), note(11, 60, 1)]
    expect(classifyMotifRelation(dotted, 0, dottedOther, 8).relation).toBe("rhythm")
  })
})

describe("終盤の回帰は、最後の2窓(無音の窓も数える)で判定する", () => {
  const core = [note(0, 60), note(1, 64), note(2, 67), note(3, 64, 2)]
  const again = (start: number) => core.map((n) => ({ ...n, startBeat: n.startBeat + start }))
  it("8拍で戻して後半が無音なら、終盤の回帰ではない", () => {
    expect(measureMotifDevelopment([...core, ...again(8)], 8, 32).lateReturn).toBe(false)
  })
  it("24拍で戻せば終盤の回帰", () => {
    expect(measureMotifDevelopment([...core, ...again(24)], 8, 32).lateReturn).toBe(true)
  })
})

describe("跳躍の後に戻るかは、同じ句の中の跳躍だけで数える", () => {
  const chords: ChordEvent[] = [{ id: "c", sectionId: "s", startBeat: 0, durationBeats: 16, symbol: "C", bass: null }]
  it("休んでから高い音で新しい句を始めた所は、戻らない跳躍と数えない", () => {
    const afterRest = measureMelodyCraft([note(0, 60), note(8, 67), note(9, 69)], chords, "C")
    expect(afterRest.leapCount).toBe(0)
    expect(afterRest.leapRecovery).toBe(1)
    const inPhrase = measureMelodyCraft([note(0, 60), note(1, 67), note(2, 69)], chords, "C")
    expect(inPhrase.leapCount).toBe(1)
    expect(inPhrase.leapRecovery).toBe(0)
  })
})

describe("頂点が核の中にしかないサビでは、後半の1音を同じ高さへ上げる", () => {
  const map = buildHarmonicMap(parseChordInputText("C | Am | F | G | C | Am | F | G", "s1", 4, "c"))
  // 核(0〜8拍)の中の E5 が最高音。後半は C5 止まり
  const melody = [
    note(0, 67), note(1, 76), note(2, 72), note(4, 69), note(6, 67),
    note(8, 64), note(10, 65), note(12, 62), note(16, 72), note(20, 72), note(22, 69), note(24, 74), note(28, 67), note(30, 60, 2),
  ]
  it("核の音は変えず、目標位置(72%)に近い後半の音が頂点になる", () => {
    const result = deferEarlySummit(melody, map, 32, "chorus", 8)
    expect(result.filter((n) => n.startBeat < 8).map((n) => n.pitch)).toEqual(melody.filter((n) => n.startBeat < 8).map((n) => n.pitch))
    // 24拍目の D5(F の上)は E5 が構成音でないので上げず、目標に近い20拍目の C5(Am の上)を E5 へ
    expect(result.find((n) => n.startBeat === 20)!.pitch).toBe(76)
    expect(assessEmotionalArc(result, map, 32, "chorus", 4).climaxTiming).toBeGreaterThan(assessEmotionalArc(melody, map, 32, "chorus", 4).climaxTiming)
    // 最後の音(終止)は動かさない
    expect(result.at(-1)!.pitch).toBe(60)
  })
})

describe("「おまかせ」で歌の旋律を作るときも、調が届く", () => {
  it("同じコード・seedでも、調が違えば別の旋律になる", () => {
    const run = (key: string) => generateSectionContent({
      chords: parseChordInputText("Am | F | C | G", "s1", 4, "c"), sectionId: "s1", sectionRole: "chorus", songProfile: "dark-romantic",
      content: { lead: "auto", accompaniment: "chords", entryOffsetBeats: 0, pickup: false }, range: RANGE_PRESETS.middle,
      totalBeats: 16, beatsPerBar: 4, seed: 12345, key,
    }).candidates.map((candidate) => candidate.notes.map((n) => [n.startBeat, n.pitch, n.durationBeats]))
    expect(run("Am")).not.toEqual(run("A"))
  }, 60000)
})
