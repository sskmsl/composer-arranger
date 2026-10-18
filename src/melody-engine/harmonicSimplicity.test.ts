import { describe, expect, it } from "vitest"
import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import { harmonicMotionInBar, simplifyAgainstHarmony } from "./harmonicSimplicity"
import { exportMelodyMidi } from "@/midi/exportMelody"
import { parseMidi } from "@/midi/importMidi"

const chord = (symbol: string, startBeat: number, durationBeats: number): ChordEvent =>
  ({ id: `${symbol}:${startBeat}`, sectionId: "s", symbol, startBeat, durationBeats, bass: null })
const notes: MelodyNote[] = Array.from({ length: 8 }, (_, i) => ({
  id: `${i}`, startBeat: i / 2, durationBeats: .5, pitch: [60, 72, 67, 76][i % 4], velocity: 80, locks: [],
}))
const busy = [chord("Cm", 0, 1), chord("Ab", 1, 1), chord("G7", 2, 2)]

describe("harmonic and melodic activity balance", () => {
  it("ignores editorial splits and keeps stable harmony output intact", () => {
    const stable = [chord("Cm", 0, 2), chord("Cm", 2, 2)]
    expect(harmonicMotionInBar(stable, 0, 4)).toBe(0)
    expect(simplifyAgainstHarmony(notes, stable, { low: 60, high: 79 }, "standard")).toEqual(notes)
  })
  it("reduces weak attacks and leaps in harmonically active bars, including MIDI", () => {
    const result = simplifyAgainstHarmony(notes, busy, { low: 60, high: 79 }, "standard")
    expect(result.length).toBeLessThan(notes.length)
    const leaps = (ns: MelodyNote[]) => ns.slice(1).reduce((sum, n, i) => sum + Math.abs(n.pitch - ns[i].pitch), 0) / (ns.length - 1)
    expect(leaps(result)).toBeLessThan(leaps(notes))
    const bytes = exportMelodyMidi({ title: "Balance", sectionName: "s", tempo: 110, timeSignature: "4/4", chords: busy, melodyNotes: result, includeChords: false })
    const read = parseMidi(bytes).tracks.flatMap((t) => t.notes)
    expect(read.map((n) => n.pitch)).toEqual(result.map((n) => n.pitch))
    expect(read).toHaveLength(result.length)
  })
  it("responds to explicit altered colour without treating an ordinary seventh as busy", () => {
    expect(harmonicMotionInBar([chord("G7", 0, 4)], 0, 4)).toBe(0)
    const altered = [chord("G7(b9)", 0, 4)]
    expect(harmonicMotionInBar(altered, 0, 4)).toBeGreaterThanOrEqual(2)
    const result = simplifyAgainstHarmony(notes, altered, { low: 60, high: 79 }, "minimal")
    expect(result.length).toBeLessThan(notes.length)
    expect(simplifyAgainstHarmony(result, altered, { low: 60, high: 79 }, "minimal")).toEqual(result)
  })
  it("simplifies two-beat harmonic changes without requiring three chords per bar", () => {
    const twoBeat = [chord("Ab", 0, 2), chord("Bb", 2, 2)]
    const result = simplifyAgainstHarmony(notes, twoBeat, { low: 60, high: 79 }, "cinematic")
    expect(result.length).toBeLessThan(notes.length)
    const stable = [chord("Ab", 0, 4)]
    expect(simplifyAgainstHarmony(notes, stable, { low: 60, high: 79 }, "cinematic")).toEqual(notes)
  })
  it("respects explicit locks and profile identities", () => {
    const locked = notes.map((n) => ({ ...n, locks: ["pitch" as const] }))
    expect(simplifyAgainstHarmony(locked, busy, { low: 60, high: 79 }, "minimal")).toEqual(locked)
    expect(simplifyAgainstHarmony(notes, busy, { low: 60, high: 79 }, "leaping")).toEqual(notes)
  })
})
