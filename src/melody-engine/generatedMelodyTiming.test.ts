import { expect, it } from "vitest"
import { mergeCoincidentMelodyNotes } from "./generatedMelodyTiming"
import type { MelodyNote } from "@/core/melody"

it("完全同時の入口だけをまとめ、強拍の和声音を優先する。元の旋律は変更しない", () => {
  const note = (id: string, startBeat: number, pitch: number, velocity: number): MelodyNote => ({ id, startBeat, pitch, velocity, durationBeats: .5, locks: [] })
  const source = [note("color", 2, 66, 110), note("chord", 2, 67, 70), note("later", 2.25, 69, 80)]
  const before = structuredClone(source)
  const result = mergeCoincidentMelodyNotes(source, [{ id: "c", sectionId: "s", symbol: "C", bass: null, startBeat: 0, durationBeats: 4 }])
  expect(result.map((n) => n.id)).toEqual(["chord", "later"])
  expect(result.map((n) => n.startBeat)).toEqual([2, 2.25])
  expect(source).toEqual(before)
})
