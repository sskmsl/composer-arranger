import { describe, expect, it } from "vitest"
import type { MelodyNote } from "./melody"
import { applyArrangementTimelineToMelody, applySilenceRanges } from "./arrangementTimelineConstraints"

function note(id: string, startBeat: number, durationBeats: number): MelodyNote {
  return { id, startBeat, durationBeats, pitch: 60, velocity: 90, locks: [] }
}

describe("arrangement timeline constraints", () => {
  it("主旋律を変更せず、指定開始小節より前だけを再生対象から外す", () => {
    const original = [note("early", 0, 2), note("kept", 32, 1)]
    const result = applyArrangementTimelineToMelody(original, {
      preserveMelody: true,
      fullSilenceRanges: [],
      melodySilenceRanges: [],
      melodyStartBar: 9,
    }, 4)
    expect(result.map((candidate) => candidate.id)).toEqual(["kept"])
    expect(original).toEqual([note("early", 0, 2), note("kept", 32, 1)])
  })

  it("無音小節を跨ぐ持続音を切り、無音後だけ再開する", () => {
    const result = applySilenceRanges(
      [note("pad", 94, 24)],
      [{ startBar: 25, endBar: 28 }],
      4,
    )
    expect(result).toEqual([
      expect.objectContaining({ id: "pad", startBeat: 94, durationBeats: 2 }),
      expect.objectContaining({ id: "pad:after-silence:1", startBeat: 112, durationBeats: 6 }),
    ])
  })
})
