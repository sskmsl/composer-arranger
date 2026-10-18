import { afterEach, expect, it, vi } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { arrangementReviewSong } from "./arrangementReviewFixtures"
import { useProjectStore } from "./useProjectStore"
import { notesByPartRole } from "@/core/sectionLayers"
import { exportMelodyMidi } from "@/midi/exportMelody"
import { parseMidi } from "@/midi/importMidi"
import * as repeated from "@/melody-engine/repeatedSectionMelody"
import { measureBreathing } from "./arrangementPerformanceMeasurements"
import { allUsablePitchClasses, parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"

type Note = Pick<MelodyNote, "pitch" | "startBeat" | "durationBeats">
function similarity(a: Note[], b: Note[]) {
  const set = (ns: Note[], pitch = false) => new Set(ns.map((n) => `${Math.round(n.startBeat * 4)}${pitch ? `:${n.pitch}` : ""}`))
  const j = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size
  const contour = (ns: Note[]) => ns.slice(1).map((n, i) => Math.sign(n.pitch - ns[i].pitch))
  const x = contour(a), y = contour(b)
  let row = Array(y.length + 1).fill(0) as number[]
  for (const v of x) { const next = [0]; y.forEach((w, i) => next.push(v === w ? row[i] + 1 : Math.max(row[i + 1], next[i]))); row = next }
  return { exact: j(set(a, true), set(b, true)), rhythm: j(set(a), set(b)), contour: row[y.length] / Math.max(1, x.length, y.length) }
}

afterEach(() => vi.restoreAllMocks())
it("指定LCG12回の全セクション全候補の音価と変奏入力を記録する", () => {
  const rows = [], traces: unknown[] = [], comparisons = [], baselineMetrics = [], arrangements = []
  const baseline: { rows: { which: string; run: number; section: string; pattern: number; notes: Note[] }[] } | null = process.env.MELODY_DURATION_COMPARE_PATH
    ? JSON.parse(readFileSync(process.env.MELODY_DURATION_COMPARE_PATH, "utf8")) : null
  for (const which of ["A", "B"] as const) for (let run = 0; run < 6; run++) {
    let random = 5000 + run * 31, id = 0
    vi.spyOn(Math, "random").mockImplementation(() => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296 })
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`)
    const vary = repeated.varyRepeatedSection
    vi.spyOn(repeated, "varyRepeatedSection").mockImplementation((...args) => {
      const result = vary(...args)
      const bad = result.flatMap((n, i) => n.durationBeats < .1 ? [{ index: i, before: result[i - 1], note: n, after: result[i + 1] }] : [])
      if (bad.length) traces.push({ which, run, section: args[1].sections.find((s) => s.id === args[2])!.name,
        pattern: args[7], source: notesByPartRole(args[0], "lead"), bad })
      return result
    })
    useProjectStore.setState({ project: arrangementReviewSong(which), persist: () => {}, history: [], future: [],
      generationSettings: { density: "balanced", rangePreset: "middle", customRange: { low: 60, high: 77 }, drama: "growing", selectedGeneratorProfiles: ["standard"], techniqueExperimentPresetId: null } })
    for (const section of useProjectStore.getState().project.sections) {
      const protectedNotes = structuredClone(useProjectStore.getState().project.melodyVariants)
      useProjectStore.getState().generateForSection(section.id)
      const state = useProjectStore.getState(), variants = state.project.melodyVariants.filter((v) => v.sectionId === section.id && v.batchId === state.activeBatchId)
      expect(variants).toHaveLength(3)
      expect(state.project.melodyVariants.filter((v) => protectedNotes.some((p) => p.id === v.id))).toEqual(protectedNotes)
      for (const [index, variant] of variants.entries()) {
        const notes = notesByPartRole(variant, "lead")
        const chords = state.project.chords.filter((c) => c.sectionId === section.id)
        const metrics = (notes: Note[]) => {
          const strong = (n: Note) => Math.abs(n.startBeat - Math.round(n.startBeat / 2) * 2) <= .06 || n.durationBeats >= .75
          const tones = (n: Note) => { const c = chords.find((c) => n.startBeat >= c.startBeat && n.startBeat < c.startBeat + c.durationBeats)!; const p = parseChordSymbol(c.symbol, c.bass ?? undefined)!; return p.tones.map((t) => t.pitchClass).concat(p.tensions.map((t) => t.pitchClass), p.bassPc) }
          const strongNotes = notes.filter(strong)
          const tail = notes.filter((n) => n.startBeat >= section.lengthBars * 4 - 8)
          const usable = (n: Note) => { const c = chords.find((c) => n.startBeat >= c.startBeat && n.startBeat < c.startBeat + c.durationBeats)!; return allUsablePitchClasses(parseChordSymbol(c.symbol, c.bass ?? undefined)!) }
          const last = notes.at(-1)!
          return { strong: strongNotes.length, clashes: strongNotes.filter((n) => !tones(n).includes(n.pitch % 12) && tones(n).some((p) => [1, 11].includes((n.pitch - p + 120) % 12))).length,
            tailCount: tail.length, tailOutside: tail.filter((n) => !usable(n).includes(n.pitch % 12)).length,
            cadence: last.durationBeats >= 1 && tones(last).includes(last.pitch % 12),
            breathing: measureBreathing(notes.map((n, i) => ({ ...n, id: `m${i}`, velocity: 80, locks: [] })), section.lengthBars * 4), bars: section.lengthBars }
        }
        const midi = parseMidi(exportMelodyMidi({ title: "duration", sectionName: section.name, tempo: state.project.song.tempo,
          timeSignature: state.project.song.timeSignature, chords: state.project.chords.filter((c) => c.sectionId === section.id), melody: variant, includeChords: false }))
        rows.push({ which, run, section: section.name, role: section.role, pattern: index + 1, count: notes.length,
          short: notes.filter((n) => n.durationBeats < .1).length, tiny: notes.filter((n) => n.durationBeats <= .05).length,
          duplicates: notes.filter((n, i) => notes.some((p, j) => j < i && Math.abs(p.startBeat - n.startBeat) < 1e-6)).length,
          midiMinimum: Math.min(...midi.tracks.flatMap((t) => t.notes.map((n) => n.durationTicks))),
          metrics: metrics(notes),
          notes: notes.map(({ pitch, startBeat, durationBeats }) => ({ pitch, startBeat, durationBeats })) })
        const old = baseline?.rows.find((r) => r.which === which && r.run === run && r.section === section.name && r.pattern === index + 1)
        if (old) baselineMetrics.push({ which, run, section: section.name, pattern: index + 1, ...metrics(old.notes) })
      }
      state.assignVariantToSection(section.id, variants[0].id)
    }
    for (const role of ["verse", "chorus"]) {
      const variants = rows.filter((r) => r.which === which && r.run === run && r.role === role)
      const source = variants[0], repeats = variants.slice(3)
      const pairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => similarity(repeats[a].notes, repeats[b].notes).exact)
      const old = baseline?.rows.filter((r) => r.which === which && r.run === run && r.section === repeats[0].section)
      comparisons.push({ which, run, role, pairs, candidates: repeats.map((r) => ({ pattern: r.pattern, ...similarity(source.notes, r.notes),
        hookSame: JSON.stringify(source.notes.filter((n) => n.startBeat < 8)) === JSON.stringify(r.notes.filter((n) => n.startBeat < 8)) })),
        beforePairs: old && [[0, 1], [0, 2], [1, 2]].map(([a, b]) => similarity(old[a].notes, old[b].notes).exact) })
    }
    if (run < 3) {
      const project = useProjectStore.getState().project
      const protectedVariants = structuredClone(project.melodyVariants)
      const arrangement = generateFullSongArrangement(project, { seed: 5000 + run * 31 })
      expect(project.melodyVariants).toEqual(protectedVariants)
      const nonDrumShorts = arrangement.tracks.filter((t) => t.family !== "drums").flatMap((t) => t.notes
        .filter((n) => n.durationBeats <= .05).map((n) => ({ track: t.id, sectionId: n.sectionId, startBeat: n.startBeat, durationBeats: n.durationBeats, pitch: n.pitch })))
      arrangements.push({ which, run, quality: arrangement.quality, audition: arrangement.audition, eligible: arrangement.selection?.eligibleCount,
        drumErrors: arrangement.tracks.filter((t) => t.family === "drums").flatMap((t) => t.notes).filter((n) => n.pitch < 35 || n.pitch > 81 && n.pitch !== 82).length,
        nonDrumShorts })
    }
    vi.restoreAllMocks()
  }
  if (process.env.MELODY_DURATION_RESULT_PATH) writeFileSync(process.env.MELODY_DURATION_RESULT_PATH, JSON.stringify({ rows, traces, comparisons, baselineMetrics, arrangements }, null, 2))
  expect(rows).toHaveLength(324)
  expect(rows.every((r) => r.short === 0 && r.duplicates === 0 && r.midiMinimum >= 48)).toBe(true)
  const oldCounts = JSON.parse(readFileSync(new URL("../../docs/reviews/melody-duration-baseline-2026-10-18.json", import.meta.url), "utf8"))
  expect(rows.map(({ which, run, section, pattern, count, notes }) => ({ which, run, section, pattern, count,
    pitchHash: createHash("sha256").update(JSON.stringify(notes.map((n) => n.pitch))).digest("hex") }))).toEqual(oldCounts)
  const avg = (ns: number[]) => ns.reduce((sum, n) => sum + n, 0) / ns.length
  expect(avg(comparisons.flatMap((r) => r.pairs))).toBeLessThanOrEqual(.70)
  for (const pattern of [1, 2, 3]) {
    const cs = comparisons.flatMap((r) => r.candidates.filter((c) => c.pattern === pattern))
    expect(avg(cs.map((c) => c.rhythm))).toBeGreaterThanOrEqual(.6)
    expect(avg(cs.map((c) => c.rhythm))).toBeLessThan(.95)
    expect(avg(cs.map((c) => c.contour))).toBeGreaterThanOrEqual(.8)
    expect(cs.every((c) => c.hookSame)).toBe(true)
  }
  expect(rows.reduce((s, r) => s + r.metrics.clashes, 0) / rows.reduce((s, r) => s + r.metrics.strong, 0)).toBeLessThanOrEqual(.05)
  const adopted = rows.filter((r) => r.pattern === 1)
  expect(adopted.filter((r) => r.metrics.bars >= 8 && !r.metrics.breathing.hasBreath).length).toBeLessThanOrEqual(5)
  expect(arrangements).toHaveLength(6)
  expect(arrangements.every((a) => (a.eligible ?? 0) >= 1 && a.quality?.metrics.harmonicViolationCount === 0 && a.quality.metrics.melodyCollisionCount === 0 && a.drumErrors === 0)).toBe(true)
  expect(avg(arrangements.map((a) => a.audition!.score))).toBeGreaterThanOrEqual(95)
}, 120_000)
