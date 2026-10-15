import { describe, expect, it } from "vitest"
import type { GeneratedArrangementNote } from "@/core/arrangementGeneration"
import { supportVoiceLeaps } from "./supportVoiceLeaps"

const note = (pitch: number, startBeat: number, voiceId?: string): GeneratedArrangementNote => ({
  id: `${startBeat}:${pitch}`, sectionId: "section", startBeat, pitch, durationBeats: 1,
  velocity: 80, locks: [], reason: "背景", character: "safe", ...(voiceId ? { voiceId } : {}),
})
describe("背景声部の跳躍", () => {
  it("間引き後も同じ声部だけを比較し、他声部への誤った跳躍を数えない", () => {
    const notes = [note(55, 0, "low"), note(64, 0, "mid"), note(76, 0, "high"),
      note(57, 4, "low"), note(65, 4, "mid"), note(59, 8, "low"), note(67, 8, "mid"), note(77, 8, "high")]
    expect(supportVoiceLeaps(notes, 3)).toHaveLength(0)
    expect(supportVoiceLeaps(notes, 3, true).length).toBeGreaterThan(0)
  })
  it("10半音以上の実際の跳躍を検出し、9半音は数えない", () => {
    const notes = [note(55, 0, "one"), note(64, 4, "one"), note(74, 8, "one"), note(63, 12, "one")]
    expect(supportVoiceLeaps(notes, 3).map(({ note, previous }) => note.pitch - previous.pitch)).toEqual([10, -11])
  })
  it("声部IDのない旧データでは配列の3個前との比較を変更しない", () => {
    const notes = [55, 64, 76, 57, 65, 59, 67, 77].map((p, i) => note(p, i))
    expect(supportVoiceLeaps(notes, 3)).toEqual(supportVoiceLeaps(notes, 3, true))
    expect(supportVoiceLeaps(notes, 1)).toEqual(supportVoiceLeaps(notes, 1, true))
  })
  it("タイミング修理で配列順が前後しても、発音時刻順で同じ声部を比べる", () => {
    const notes = [note(55, 0, "one"), note(65, 8, "one"), note(60, 4, "one")]
    expect(supportVoiceLeaps(notes, 1)).toHaveLength(0)
  })
})
