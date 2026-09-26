import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"

/**
 * 「刻みと跳躍」: 同じ音の刻みと、主音・属音を結ぶ4度・5度の跳躍が旋律の骨格になる。
 * 録音(My_Recording_3)の音列は保存しておらず、そこから測った割合だけを目安にしている
 * (同音の割合 0.38、4度・5度の跳躍 0.29、刻みのまとまり 8小節あたり 3.65)。
 */
describe("刻みと跳躍(pulse-leap)", () => {
  const chords = parseChordInputText("D#m | B | C# | A#m | D#m | B | C# | A#m", "s1", 4, "c")
  const samples = [101, 202, 303].flatMap((seed) =>
    generateFromChordsWithProfiles({
      chords, sectionId: "s1", sectionRole: "verse", songProfile: "dark-romantic", density: "balanced",
      range: RANGE_PRESETS.middle, drama: "growing", totalBeats: 32, seed, profiles: ["pulse-leap"], key: "D#m",
    }).candidates,
  )

  it("3案が出て、同音の刻みと4度・5度の跳躍を持つ", () => {
    expect(samples.length).toBeGreaterThanOrEqual(6)
    for (const candidate of samples) {
      const notes = [...candidate.notes].sort((a, b) => a.startBeat - b.startBeat)
      const moves = notes.slice(1).map((note, index) => Math.abs(note.pitch - notes[index].pitch))
      const repeats = moves.filter((move) => move === 0).length / moves.length
      const fourthsFifths = moves.filter((move) => move === 5 || move === 7).length / moves.length
      expect(repeats).toBeGreaterThanOrEqual(0.2)
      expect(fourthsFifths).toBeGreaterThanOrEqual(0.1)
      for (const note of notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(RANGE_PRESETS.middle.low)
        expect(note.pitch).toBeLessThanOrEqual(RANGE_PRESETS.middle.high)
      }
    }
  })
})
