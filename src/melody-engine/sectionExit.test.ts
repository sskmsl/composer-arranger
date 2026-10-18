import { describe, expect, it } from "vitest"
import { createEmptyProject, type ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import { applySectionExit, buildSectionExitContext, type SectionTransitionContext } from "./sectionTransition"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { exportMelodyMidi } from "@/midi/exportMelody"
import { parseMidi } from "@/midi/importMidi"

const chords: ChordEvent[] = ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({
  id: `${i}`, sectionId: "s", startBeat: i * 8, durationBeats: 8, symbol, bass: null,
}))
const notes: MelodyNote[] = [{ id: "end", startBeat: 30, durationBeats: 2, pitch: 71, velocity: 80, locks: [] }]
const exit = { targetSectionId: "next", targetRole: "chorus" as const, targetFirstChord: "Cm", targetFirstPitch: 72 }

describe("forward section context", () => {
  it("uses the next section even when the previous lead is not assigned", () => {
    const project = createEmptyProject("Context")
    project.sections = [{ id: "s", name: "Verse", role: "verse", startBar: 1, lengthBars: 8 },
      { id: "next", name: "Chorus", role: "chorus", startBar: 9, lengthBars: 8 }]
    project.chords = [...chords, { ...chords[0], id: "next", sectionId: "next" }]
    expect(buildSectionExitContext(project, "s")).toMatchObject({ targetFirstChord: "Cm", targetRole: "chorus" })
    expect(buildSectionExitContext(project, "next")).toBeUndefined()
    expect(buildSectionExitContext(project, "missing")).toBeUndefined()
  })
  it("connects the last note through a shared tone, retains locks and leaves a breath", () => {
    const result = applySectionExit(notes, exit, 32, { low: 60, high: 79 }, chords)
    expect(result[0].pitch % 12).toBe(7)
    expect(result[0].startBeat + result[0].durationBeats).toBeLessThan(32)
    expect(notes[0].pitch).toBe(71)
    expect(applySectionExit([{ ...notes[0], locks: ["pitch"] }], exit, 32, { low: 60, high: 79 }, chords)[0].pitch).toBe(71)
  })
  it.each(["minimal", "standard"] as const)("changes actual eight-bar %s output and its exported MIDI across fixed seeds", (profile) => {
    let changed = 0, previousChanged = 0
    for (const seed of [19, 41, 73]) {
      const input = { chords, sectionId: "s", sectionRole: "verse" as const, songProfile: "original-custom" as const,
        density: "balanced" as const, range: { low: 60, high: 79 }, drama: "open" as const,
        totalBeats: 32, seed, profiles: [profile] }
      const previous: SectionTransitionContext = { sourceSectionId: "before", sourceVariantId: "adopted", targetSectionId: "s",
        targetRole: "verse", targetFirstChord: "Cm", contextFingerprint: "eight-bar-test", previousTailNotes: notes,
        previousLastPitch: 67, previousDirection: 1, previousRegisterCenter: 65, previousTension: 0,
        previousMotifIntervals: [0, 1, -1], targetEnergy: .5 }
      const baseline = generateFromChordsWithProfiles(input).candidates
      const connected = generateFromChordsWithProfiles({ ...input, transitionContext: previous }).candidates
      expect(connected.every((c) => c.transitionPlan?.sourceVariantId === "adopted")).toBe(true)
      previousChanged += connected.filter((c, i) => JSON.stringify(c.notes.map((n) => [n.startBeat, n.pitch]))
        !== JSON.stringify(baseline[i]?.notes.map((n) => [n.startBeat, n.pitch]))).length
      const contextual = generateFromChordsWithProfiles({ ...input, exitContext: exit }).candidates
      for (let i = 0; i < contextual.length; i++) {
        const n = contextual[i].notes
        if (JSON.stringify(n.map((x) => [x.startBeat, x.pitch, x.durationBeats])) !== JSON.stringify(baseline[i]?.notes.map((x) => [x.startBeat, x.pitch, x.durationBeats]))) changed++
        const midi = parseMidi(exportMelodyMidi({ title: "Context", sectionName: "s", tempo: 110,
          timeSignature: "4/4", chords, melodyNotes: n, includeChords: false }))
        expect(midi.tracks.flatMap((t) => t.notes).map((x) => x.pitch)).toEqual(n.map((x) => x.pitch))
      }
    }
    expect(changed).toBeGreaterThan(0)
    expect(previousChanged).toBeGreaterThan(0)
  })
})
