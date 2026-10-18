import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { selectConsonantMelodyPitches } from "./melodyConsonance"
const note = (pitch: number, startBeat: number, durationBeats = 1): MelodyNote => ({ id: `n:${startBeat}`, pitch, startBeat, durationBeats, velocity: 80, locks: [] })
const chord = (symbol: string, startBeat = 0, durationBeats = 8): ChordEvent => ({ id: symbol, sectionId: "s", symbol, bass: null, startBeat, durationBeats })
const range = { low: 48, high: 84 }
describe("新規旋律候補の音高選択", () => {
  it.each([["Dm7", 68], ["F", 68], ["E7", 67]])("%s上の強い半音衝突を、音数・位置・長さを変えず避ける", (symbol, pitch) => {
    const notes = [note(69, 0), note(pitch, 2), note(69, 4)], snapshot = structuredClone(notes)
    const result = selectConsonantMelodyPitches(notes, [chord(symbol)], "Am", range)
    expect(result[1].pitch).not.toBe(pitch)
    expect(result.map((n) => ({ ...n, pitch: 0, plannedToneRole: undefined, plannedResolution: undefined })))
      .toEqual(notes.map((n) => ({ ...n, pitch: 0, plannedToneRole: undefined, plannedResolution: undefined })))
    expect(notes).toEqual(snapshot)
  })
  it("E7のG#は構成音として維持し、短い導音も実際にAへ解決する場合は残す", () => {
    expect(selectConsonantMelodyPitches([note(68, 0, 2)], [chord("E7")], "Am", range)[0].pitch).toBe(68)
    expect(selectConsonantMelodyPitches([note(67, 0, 2)], [chord("E7(#9)")], "Am", range)[0].pitch).toBe(67)
    const ornament = [note(69, 0), note(68, 1.5, .25), note(69, 1.75, 1)]
    expect(selectConsonantMelodyPitches(ornament, [chord("Am")], "Am", range).map((n) => n.pitch)).toEqual([69, 68, 69])
    const unresolved = [note(69, 0), note(68, 1.5, .25), note(72, 1.75, 1)]
    expect(selectConsonantMelodyPitches(unresolved, [chord("Am")], "Am", range)[1].pitch).not.toBe(68)
    // キー内のGであっても、E7上で半音接触する短音を無根拠には残さない。
    expect(selectConsonantMelodyPitches([note(64, 0), note(67, 1.5, .25), note(72, 1.75)], [chord("E7")], "Am", range)[1].pitch).not.toBe(67)
  })
  it("拍位置の許容差・長い弱拍音・半音上と下・スラッシュ低音を含めて判定する", () => {
    for (const onset of [1.95, 2.05, 1.5]) {
      const result = selectConsonantMelodyPitches([note(68, onset, onset === 1.5 ? .75 : .25)], [chord("F")], "Am", range)
      expect(result[0].pitch).not.toBe(68)
    }
    expect(selectConsonantMelodyPitches([note(65, 0, 1)], [chord("C/E")], "C", range)[0].pitch).not.toBe(65)
    expect(selectConsonantMelodyPitches([note(66, 0, 1)], [chord("C/F#")], "C", range)[0].pitch).toBe(66)
  })
  it("2コード小節・長調・転調後にもその時点のコードとキーを使い、範囲を超えない", () => {
    const notes = [note(65, 0), note(65, 2), note(65, 4)]
    const result = selectConsonantMelodyPitches(notes, [chord("F", 0, 2), chord("C", 2, 2), chord("D", 4, 4)], "D", { low: 60, high: 79 })
    expect(result[0].pitch).toBe(65)
    expect(result[1].pitch).not.toBe(65)
    expect(result[2].pitch).not.toBe(65)
    expect(result.every((n) => n.pitch >= 60 && n.pitch <= 79)).toBe(true)
  })
})
