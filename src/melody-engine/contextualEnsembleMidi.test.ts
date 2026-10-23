import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { normalizeProject } from "@/core/project"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { generateFullSongArrangement } from "./arrangementGenerator"

const measurements: unknown[] = []

describe("contextual ensemble final MIDI", () => {
  for (const style of ["neoclassical", "electronica"] as const) for (const withLead of [false, true]) {
    it(`${style}, lead=${withLead}, fixed seeds 19/41/73`, () => {
      for (const seed of [19, 41, 73]) {
        const p = arrangementReviewSong(style === "neoclassical" ? "A" : "B")
        p.song.genreBlend = [{ id: style, weight: 1 }]
        p.song.tempo = style === "neoclassical" ? 84 : 132
        if (withLead) for (const s of p.sections) {
          const id = `lead:${s.id}`
          p.melodyVariants.push({ id, name: "Synthetic lead", sectionId: s.id, sourceMode: "generate", notes: Array.from({ length: s.lengthBars }, (_, i) => [0, .5, 1].map((beat, j) => ({ id: `${id}:${i}:${j}`, pitch: [72, 74, 76][j], startBeat: i * 4 + beat, durationBeats: .4, velocity: 80, locks: [] }))).flat(),
            phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "fixture", seed: 1, songProfile: "original-custom", parentMelodyId: null, batchId: "fixture", createdAt: "2026-10-21T00:00:00Z" })
          p.sectionMelodyAssignments[s.id] = id
        }
        const before = structuredClone(p)
        const lead = buildSongPlaybackMaterial(p).lead
        const a = generateFullSongArrangement(p, { seed })
        expect(p).toEqual(before)
        expect(a.quality?.passed).toBe(true)
        expect(a.audition?.passed).toBe(true)
        const loaded = normalizeProject(JSON.parse(JSON.stringify({ ...p, fullSongArrangement: a })))
        const midi = exportArrangementMidi(p, a)
        expect(exportArrangementMidi(loaded, loaded.fullSongArrangement!)).toEqual(midi)
        const parsed = parseMidi(midi)
        const stats = a.tracks.filter((t) => t.notes.length).map((t) => {
          const exported = parsed.tracks.find((m) => m.name === t.name)
          expect(exported?.notes.length).toBe(t.notes.length)
          const ns = exported!.notes
          return { id: t.id, program: t.instrument?.program, notes: ns.length,
            pitchRange: [Math.min(...ns.map((n) => n.pitch)), Math.max(...ns.map((n) => n.pitch))],
            meanDurationBeats: ns.reduce((sum, n) => sum + n.durationTicks / parsed.ppq, 0) / ns.length }
        })
        const responses = a.tracks.find((t) => t.id === "syn-arp-high")?.notes ?? []
        // Measure the final performance, including subsequent critic and boundary repairs.
        const responseOverlap = responses.filter((n) => lead.some((l) => l.startBeat < n.startBeat + n.durationBeats && l.startBeat + l.durationBeats > n.startBeat)).length
        if (style === "neoclassical") {
          expect(responseOverlap).toBe(0)
          expect(responses.length > 0).toBe(withLead)
        }
        measurements.push({ style, withLead, seed, approach: a.plan.candidateApproach, quality: a.quality?.score, audition: a.audition?.score, responseOverlap, tracks: stats })
      }
      if (process.env.ENSEMBLE_MEASUREMENT_PATH) writeFileSync(process.env.ENSEMBLE_MEASUREMENT_PATH, JSON.stringify(measurements, null, 2))
    }, 120_000)
  }
})
