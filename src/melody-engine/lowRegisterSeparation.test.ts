import { describe, expect, it } from "vitest"
import type { GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { separateLowRegister } from "./lowRegisterSeparation"

function track(id: GeneratedArrangementTrack["id"], family: GeneratedArrangementTrack["family"], pitch: number): GeneratedArrangementTrack {
  return { id, name: id, family, muted: false, generationRevision: 0, purpose: "test", notes: [{
    id: `${id}:note`, sectionId: "s", pitch, startBeat: 0, durationBeats: 4, velocity: 70, locks: [], character: "safe", reason: "test",
  }] }
}
describe("低域の分離", () => {
  it("低音の近いパッドと低弦を上げ、音名・音数・ベース・ドラムは保持する", () => {
    const tracks = [track("syn-bass", "bass", 45), track("syn-dark-pad", "synth", 48), track("str-cello", "strings", 50), track("dr-kick", "drums", 36)]
    const before = structuredClone(tracks)
    const result = separateLowRegister(tracks)
    expect(result[0]).toEqual(tracks[0])
    expect(result[3]).toEqual(tracks[3])
    expect(result[1].notes[0].pitch).toBe(60)
    expect(result[2].notes[0].pitch).toBe(62)
    expect(result.flatMap((t) => t.notes)).toHaveLength(4)
    expect(tracks).toEqual(before)
    expect(separateLowRegister(tracks, new Set(["str-cello"]))[1]).toEqual(tracks[1])
  })
})
