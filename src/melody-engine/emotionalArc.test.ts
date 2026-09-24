import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { buildHarmonicMap } from "./harmonicMap"
import { assessEmotionalArc, shapeEmotionalArc } from "./emotionalArc"

const chords = ["Cmaj7", "Dm9", "G7", "Cmaj7"].map((symbol, index) => ({
  id: String(index), sectionId: "s", startBeat: index * 4, durationBeats: 4, symbol, bass: null,
}))
const harmony = buildHarmonicMap(chords)
const makeNotes = (pitches: number[]): MelodyNote[] => pitches.map((pitch, index) => ({
  id: String(index), pitch, startBeat: index, durationBeats: .85, velocity: 80, locks: [],
}))

describe("Hookを育てる感情曲線", () => {
  it("同じ核と音数を保ち、和声境界の同音再解釈と頂点前の吸気を一度だけ作る", () => {
    const notes = makeNotes([60, 62, 64, 64, 65, 67, 69, 65, 67, 69, 71, 74, 72, 71, 67, 64])
    const result = shapeEmotionalArc(notes, harmony, { low: 60, high: 77 }, 16, "chorus", 4)
    expect(result).toHaveLength(notes.length)
    expect(result.slice(0, 4)).toEqual(notes.slice(0, 4))
    expect(result[8].pitch).toBe(65) // Dm9の3rdがG7の7thとして残る
    expect(result[8].plannedToneRole).toBe("common-tone")
    expect(result[10].durationBeats).toBeLessThan(notes[10].durationBeats)
    expect(result.at(-1)!.durationBeats).toBeGreaterThan(notes.at(-1)!.durationBeats)
    expect(result.filter((note, index) => note.pitch !== notes[index].pitch)).toHaveLength(1)
  })

  it("最高音の高さ自体ではなく、反復後の到達と後続の余韻を評価する", () => {
    const late = makeNotes([60, 62, 64, 64, 65, 67, 69, 69, 67, 69, 71, 74, 72, 71, 67, 64])
    const early = late.map((note) => ({ ...note }))
    early[2].pitch = 74
    early[11].pitch = 64
    const lateScore = assessEmotionalArc(late, harmony, 16, "chorus", 4)
    const earlyScore = assessEmotionalArc(early, harmony, 16, "chorus", 4)
    expect(lateScore.climaxTiming).toBeGreaterThan(earlyScore.climaxTiming)
    expect(lateScore.registerDevelopment).toBeGreaterThan(earlyScore.registerDevelopment)
    expect(lateScore.score).toBeGreaterThan(earlyScore.score)
  })

  it("短すぎる素材には頂点を無理に追加しない", () => {
    const source = makeNotes([60, 62, 64])
    expect(shapeEmotionalArc(source, harmony, { low: 60, high: 77 }, 4, "verse", 4)).toEqual(source)
  })
})
