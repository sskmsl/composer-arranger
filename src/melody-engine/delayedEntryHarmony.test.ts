import { expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import { analyzeFullSongArrangement, buildFullSongArrangementPlan, finalizeFullSongArrangement } from "./arrangementGenerator"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"

it("revoices a delayed safe entrance for its actual chord without changing its scheduled entry", () => {
  const p = createEmptyProject("Delayed entrance")
  p.sections = [{ id: "s", name: "Verse", role: "verse", startBar: 1, lengthBars: 8 }]
  p.chords = [{ id: "c", sectionId: "s", symbol: "C", bass: null, startBeat: 0, durationBeats: 4 },
    { id: "g", sectionId: "s", symbol: "G", bass: null, startBeat: 4, durationBeats: 28 }]
  const analysis = analyzeFullSongArrangement(p)
  const plan = buildFullSongArrangementPlan(p, analysis, 19)
  plan.sections[0].activeRoles = ["str-viola"]
  plan.sections[0].roleEntryBeats = { "str-viola": 4 }
  const a = finalizeFullSongArrangement(p, { version: "1.0.0", id: "entry", createdAt: "2026-10-21", analysis, plan,
    tracks: [{ id: "str-viola", name: "Viola", family: "strings", muted: false, purpose: "inner", generationRevision: 0,
      notes: [{ id: "held-E", sectionId: "s", startBeat: 0, durationBeats: 8, pitch: 64, velocity: 60, character: "safe", reason: "inner", locks: [] }] }] },
    { refine: false, editableTrackIds: new Set(["str-viola"]), editableSectionIds: new Set(["s"]) })
  expect(a.quality!.metrics.harmonicViolationCount).toBe(0)
  const n = parseMidi(exportArrangementMidi(p, a)).tracks.flatMap((t) => t.notes)[0]
  expect(n.startTick / 480).toBe(4)
  expect([7, 11, 2]).toContain(n.pitch % 12)
  expect(Math.abs(n.pitch - 64)).toBeLessThanOrEqual(3)
  expect(a.plan.sections[0].roleEntryBeats?.["str-viola"]).toBe(4)
})
