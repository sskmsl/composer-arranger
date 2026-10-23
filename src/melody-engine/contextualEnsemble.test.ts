import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ArrangementPlan, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { arrangeContextualEnsemble } from "./contextualEnsemble"

function fixture(rhythmic = false, withLead = false) {
  const p = createEmptyProject("Ensemble roles")
  p.song.tempo = rhythmic ? 132 : 84
  p.song.genreBlend = [{ id: rhythmic ? "electronica" : "neoclassical", weight: 1 }]
  p.sections = [{ id: "s", name: "Verse", role: "verse", startBar: 1, lengthBars: 4 }]
  p.chords = ["C", "F", "Am", "G"].map((symbol, i) => ({ id: `c${i}`, sectionId: "s", symbol, startBeat: i * 4, durationBeats: 4, bass: null }))
  if (withLead) {
    p.melodyVariants = [{ id: "lead", sectionId: "s", name: "Lead", sourceMode: "generate", phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "fixture", seed: 1, songProfile: "original-custom", parentMelodyId: null, batchId: "fixture", createdAt: "2026-10-21T00:00:00Z", notes: [{ id: "lead-note", pitch: 72, startBeat: 0, durationBeats: 10, velocity: 80, locks: [] }] }]
    p.activeMelodyId = "lead"
    p.sectionMelodyAssignments = { s: "lead" }
  }
  const plan = { version: "1.0.0", seed: 19, brief: "", sections: [{ sectionId: "s", semanticRole: "verse", energy: 80, roleEntryBeats: { "syn-pulse": 2, "syn-arp-high": 2 } }] } as unknown as ArrangementPlan
  const track = (id: GeneratedArrangementTrack["id"]): GeneratedArrangementTrack => ({ id, name: id, family: id.startsWith("dr-") ? "drums" : "synth", muted: false, purpose: "test", generationRevision: 0,
    notes: [{ id: `n${id}`, sectionId: "s", startBeat: 2, durationBeats: 1, pitch: id.startsWith("dr-") ? 36 : 60, velocity: 70, locks: [], character: "safe", reason: "source" }] })
  return { p, plan, tracks: [track("syn-pulse"), track("syn-arp-high"), track("dr-kick"), track("dr-kick-click"), track("dr-snare-body")] }
}

describe("contextual ensemble performances", () => {
  it("plays chord-specific distributed voices, rather than transposing or copying the source", () => {
    const { p, plan, tracks } = fixture()
    const output = arrangeContextualEnsemble(p, plan, tracks)
    const comp = output.find((t) => t.id === "syn-pulse")!
    expect(comp.instrument?.program).toBe(24) // calm, slowly changing harmony: arpeggio on nylon guitar
    expect(comp.notes.length).toBeGreaterThan(tracks[0].notes.length)
    expect(new Set(comp.notes.map((n) => n.pitch % 12)).size).toBeGreaterThan(3)
    expect(comp.notes.every((n) => n.startBeat >= 2 && n.startBeat + n.durationBeats <= 16)).toBe(true)
    expect(output.find((t) => t.id === "syn-arp-high")!.notes).toEqual([]) // no invented replacement lead
    expect(output.find((t) => t.id === "dr-kick-click")!.notes).toEqual([])
    expect(output.find((t) => t.id === "dr-kick")!.notes).toEqual(tracks[2].notes)
  })
  it("answers only in real lead rests and leaves dense lead space", () => {
    const { p, plan, tracks } = fixture(false, true)
    const output = arrangeContextualEnsemble(p, plan, tracks)
    const response = output.find((t) => t.id === "syn-arp-high")!
    expect(response.notes.length).toBeGreaterThan(0)
    expect(response.notes.every((n) => n.startBeat >= 10.12)).toBe(true)
    const comp = output.find((t) => t.id === "syn-pulse")!
    expect(comp.notes.every((n) => n.startBeat >= 10 || Math.abs(n.pitch - 72) >= 7)).toBe(true)
  })
  it("retains useful percussion support and the electronic pulse in a rhythm-led song", () => {
    const { p, plan, tracks } = fixture(true)
    const output = arrangeContextualEnsemble(p, plan, tracks)
    expect(output.find((t) => t.id === "dr-kick-click")!.notes).toEqual(tracks[3].notes)
    expect(output.find((t) => t.id === "syn-pulse")!.notes).toEqual(tracks[0].notes)
  })
  it("does not override a requested or preserved part", () => {
    const { p, plan, tracks } = fixture()
    plan.directive = { intention: "", preserve: ["syn-pulse", "dr-kick-click"] }
    const output = arrangeContextualEnsemble(p, plan, tracks)
    expect(output[0]).toBe(tracks[0])
    expect(output[3]).toBe(tracks[3])
  })
  it("plays arpeggios and chord strums on guitar unless the song is electronic", () => {
    const { p, plan, tracks } = fixture()
    const withChords = [...tracks, ...(["syn-stabs", "syn-chord-wide"] as const).map((id) => ({ ...tracks[0], id, name: id }))]
    const program = (list: GeneratedArrangementTrack[], id: string) => list.find((t) => t.id === id)?.instrument?.program
    const calm = arrangeContextualEnsemble(p, plan, withChords)
    expect([program(calm, "syn-pulse"), program(calm, "syn-stabs"), program(calm, "syn-chord-wide")]).toEqual([24, 27, 24])
    p.song.tempo = 120
    expect(program(arrangeContextualEnsemble(p, plan, withChords), "syn-pulse")).toBe(27)
    const electronic = fixture(true)
    const kept = arrangeContextualEnsemble(electronic.p, electronic.plan, withChords)
    expect([program(kept, "syn-pulse"), program(kept, "syn-stabs"), program(kept, "syn-chord-wide")]).toEqual([81, undefined, undefined])
  })
  it("keeps keys for dense harmony that changes faster than a bar", () => {
    const { p, plan, tracks } = fixture()
    p.chords = p.chords.map((c, i) => ({ ...c, startBeat: i * 2, durationBeats: 2 }))
    expect(arrangeContextualEnsemble(p, plan, tracks).find((t) => t.id === "syn-pulse")!.instrument?.program).toBe(0)
  })
  it("decides the sound, not the notes, when no genre or reference is set", () => {
    const { p, plan, tracks } = fixture()
    p.song.genreBlend = []
    const output = arrangeContextualEnsemble(p, plan, tracks)
    expect(output.map((t) => t.notes)).toEqual(tracks.map((t) => t.notes))
    expect(output.find((t) => t.id === "syn-pulse")!.instrument?.program).toBe(24)
    expect(output.find((t) => t.id === "dr-kick")!.instrument).toBeUndefined()
    plan.directive = { intention: "", preserve: ["syn-pulse"] }
    expect(arrangeContextualEnsemble(p, plan, tracks)[0]).toBe(tracks[0])
  })
})
