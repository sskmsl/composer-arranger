import { afterEach, describe, expect, it, vi } from "vitest"
import { writeFileSync } from "node:fs"
import { arrangementReviewSong } from "./arrangementReviewFixtures"
import { useProjectStore } from "./useProjectStore"
import { notesByPartRole } from "@/core/sectionLayers"
import type { MelodyNote } from "@/core/melody"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { parseChordSymbol } from "@/core/chord"

function lcs(a: number[], b: number[]) {
  let row = Array(b.length + 1).fill(0) as number[]
  for (const x of a) {
    const next = [0]
    for (let j = 0; j < b.length; j++) next.push(x === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]))
    row = next
  }
  return row[b.length] / Math.max(1, a.length, b.length)
}
function similarity(a: MelodyNote[], b: MelodyNote[]) {
  const set = (notes: MelodyNote[], pitch = false) => new Set(notes.map((n) => `${Math.round(n.startBeat * 4)}${pitch ? `:${n.pitch}` : ""}`))
  const jaccard = (x: Set<string>, y: Set<string>) => [...x].filter((v) => y.has(v)).length / Math.max(1, new Set([...x, ...y]).size)
  const contour = (notes: MelodyNote[]) => notes.slice(1).map((n, i) => Math.sign(n.pitch - notes[i].pitch))
  return { rhythm: jaccard(set(a), set(b)), exact: jaccard(set(a, true), set(b, true)), contour: lcs(contour(a), contour(b)) }
}
afterEach(() => vi.restoreAllMocks())

describe("レビュー指定2曲の決定的測定", () => {
  it("各6seedで採用・全曲生成し、測定値を記録する", () => {
    const results = []
    for (const which of ["A", "B"] as const) for (let seed = 1; seed <= 6; seed++) {
      let randomState = seed
      let uuidIndex = 0
      vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, "0")}`)
      vi.spyOn(Math, "random").mockImplementation(() => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
        return randomState / 4294967296
      })
      useProjectStore.setState({ project: arrangementReviewSong(which), persist: () => {}, history: [], future: [],
        generationSettings: { density: "balanced", rangePreset: "middle", customRange: { low: 60, high: 77 }, drama: "growing", selectedGeneratorProfiles: ["standard"], techniqueExperimentPresetId: null },
      })
      for (const section of useProjectStore.getState().project.sections) {
        useProjectStore.getState().generateForSection(section.id)
        const state = useProjectStore.getState()
        const candidate = state.project.melodyVariants.find((v) => v.sectionId === section.id && v.batchId === state.activeBatchId)!
        expect(candidate).toBeDefined()
        expect(candidate.notes.every((n) => n.pitch >= 60 && n.pitch <= 77)).toBe(true)
        state.assignVariantToSection(section.id, candidate.id)
      }
      const project = useProjectStore.getState().project
      const lead = (index: number) => notesByPartRole(project.melodyVariants.find((v) => v.id === project.sectionMelodyAssignments[project.sections[index].id])!, "lead")
      const avg = (notes: MelodyNote[]) => notes.reduce((s, n) => s + n.pitch, 0) / notes.length
      const peak = (notes: MelodyNote[]) => Math.max(...notes.map((n) => n.pitch))
      const arrangement = seed <= 3 ? generateFullSongArrangement(project, { seed }) : null
      results.push({ which, seed, pairs: [similarity(lead(1), lead(4)), similarity(lead(3), lead(5))],
        means: [avg(lead(3)), avg(lead(5)), avg(lead(7))], peaks: [peak(lead(3)), peak(lead(5)), peak(lead(7))],
        sections: arrangement ? project.sections.map((s) => {
          const start = (s.startBar - 1) * 4, end = start + s.lengthBars * 4
          const tracks = arrangement.tracks.filter((t) => !t.muted && t.notes.some((n) => n.startBeat >= start && n.startBeat < end))
          const notes = tracks.filter((t) => t.family !== "drums").flatMap((t) => t.notes.filter((n) => n.startBeat >= start && n.startBeat < end))
          const finalTracks = tracks.filter((t) => t.notes.some((n) => n.startBeat < end && n.startBeat + n.durationBeats > end - 4))
          const lastChord = project.chords.filter((c) => c.sectionId === s.id).sort((a, b) => a.startBeat - b.startBeat).at(-1)
          const bassPc = lastChord ? parseChordSymbol(lastChord.symbol, lastChord.bass ?? undefined)?.bassPc : undefined
          return { name: s.name, role: s.role, layers: tracks.length, velocity: notes.reduce((a, n) => a + n.velocity, 0) / Math.max(1, notes.length),
            crash: arrangement.tracks.some((t) => t.id === "dr-crash" && t.notes.some((n) => Math.abs(n.startBeat - start) < 0.1)),
            fill: arrangement.tracks.some((t) => ["dr-low-tom", "dr-high-tom"].includes(t.id) && t.notes.some((n) => n.startBeat >= start - 4 && n.startBeat < start))
              || arrangement.tracks.some((t) => t.id === "dr-snare" && t.notes.filter((n) => n.startBeat >= start - 4 && n.startBeat < start).length >= 3),
            rise: arrangement.tracks.some((t) => ["dr-cymbal-swell", "dr-impact"].includes(t.id) && t.notes.some((n) => n.startBeat >= start - 8 && n.startBeat < start)),
            finalLayers: finalTracks.length, finalHeld: finalTracks.filter((t) => t.notes.some((n) => Math.abs(n.startBeat + n.durationBeats - end) <= 0.25)).length,
            finalBass: finalTracks.some((t) => t.family !== "drums" && t.notes.some((n) => n.pitch < 52 && n.pitch % 12 === bassPc && n.startBeat < end && n.startBeat + n.durationBeats > end - 4)),
            ending: s.role === "outro" ? finalTracks.map((t) => ({ id: t.id, notes: t.notes.filter((n) => n.sectionId === s.id && n.startBeat + n.durationBeats > end - 4) })) : undefined,
          }
        }) : null, quality: arrangement?.quality, audition: arrangement?.audition,
      })
      vi.restoreAllMocks()
    }
    const path = process.env.ARRANGEMENT_REVIEW_RESULT_PATH
    if (path) writeFileSync(path, JSON.stringify(results, null, 2))
    expect(results).toHaveLength(12)
    const pairs = results.flatMap((r) => r.pairs)
    const mean = (key: keyof ReturnType<typeof similarity>) => pairs.reduce((sum, pair) => sum + pair[key], 0) / pairs.length
    expect(mean("rhythm")).toBeGreaterThanOrEqual(0.6)
    expect(mean("rhythm")).toBeLessThan(0.95)
    expect(mean("contour")).toBeGreaterThanOrEqual(0.8)
    expect(mean("exact")).toBeLessThan(0.9)
    for (const result of results.filter((r) => r.sections)) {
      const choruses = result.sections!.filter((s) => s.role === "chorus" || s.role === "grand-chorus")
      for (const section of choruses) {
        expect(section.crash).toBe(true)
        expect(section.fill).toBe(true)
        expect(section.rise).toBe(true)
      }
      expect(choruses[1].layers - choruses[0].layers).toBeGreaterThanOrEqual(2)
      expect(choruses[2].layers - choruses[1].layers).toBeLessThanOrEqual(10)
      expect(choruses[2].velocity - choruses[1].velocity).toBeGreaterThanOrEqual(4)
      expect(choruses[2].velocity - choruses[1].velocity).toBeLessThanOrEqual(10)
      expect(choruses[0].velocity - result.sections!.find((s) => s.role === "verse")!.velocity).toBeGreaterThanOrEqual(6)
      const outro = result.sections!.at(-1)!
      expect(outro.finalLayers).toBeGreaterThanOrEqual(3)
      expect(outro.finalBass).toBe(true)
      expect(outro.finalHeld / outro.finalLayers).toBeGreaterThanOrEqual(0.8)
    }
    const otherBoundaries = results.flatMap((r) => r.sections?.slice(1).filter((s) => !["chorus", "grand-chorus", "outro"].includes(s.role)) ?? [])
    const otherFillRatio = otherBoundaries.filter((s) => s.fill).length / otherBoundaries.length
    expect(otherFillRatio).toBeGreaterThanOrEqual(0.4)
    expect(otherFillRatio).toBeLessThanOrEqual(0.8)
  }, 240000)
})
