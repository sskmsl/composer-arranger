import { afterEach, expect, it, vi } from "vitest"
import { writeFileSync } from "node:fs"
import { melodyCharacterReviewSong } from "./melodyCharacterReviewFixtures"
import { useProjectStore } from "./useProjectStore"
import { traceStages, type StageNote, type StageRecord } from "@/melody-engine/stageTrace"
import { notesByPartRole } from "@/core/sectionLayers"
import * as classical from "@/melody-engine/classicalRefinement"
import * as craft from "@/melody-engine/melodicCraft"
import { measureMelodyCraft } from "@/melody-engine/melodyCraftMetrics"
import { classicalLikeness } from "@/melody-engine/classicalLikeness"
import { CLASSICAL_MODELS } from "@/melody-engine/classicalModels"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { computeMelodyFeatures } from "@/melody-engine/features"
import * as generationInputs from "./generationInputs"
import { normalizeProject } from "@/core/project"

export function characterMetrics(notes: readonly Pick<StageNote, "pitch" | "startBeat" | "durationBeats">[]) {
  const end = Math.max(...notes.map((n) => n.startBeat + n.durationBeats)), start = Math.min(...notes.map((n) => n.startBeat))
  return { range: Math.max(...notes.map((n) => n.pitch)) - Math.min(...notes.map((n) => n.pitch)),
    long: notes.filter((n) => n.durationBeats >= 1).length / notes.length,
    offbeat: notes.filter((n) => Math.abs(n.startBeat - Math.round(n.startBeat)) > .05).length / notes.length,
    density: notes.length / Math.max(.01, end - start) }
}
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), average = mean(values)
  const percentile = (p: number) => {
    const index = (sorted.length - 1) * p, low = Math.floor(index)
    return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
  }
  return { p10: percentile(.1), median: percentile(.5), p90: percentile(.9), sd: Math.sqrt(mean(values.map((v) => (v - average) ** 2))) }
}
function lastPerPool(records: StageRecord[], stage: string, phase?: string) {
  const map = new Map<string, StageRecord>()
  for (const r of records) if (r.stage === stage && (!phase || r.context.phase === phase)) map.set(`${r.context.profile}:${r.context.poolIndex}`, r)
  return [...map.values()]
}
afterEach(() => vi.restoreAllMocks())
it("24曲48旋律の性格・品質基準と段階別ablationを検証する", () => {
  const rows = []
  for (const mode of ["normal", "without-classical", "without-craft"] as const) {
    if (mode === "without-classical") vi.spyOn(classical, "refineTowardClassical").mockImplementation((notes) => ({ notes: notes.map((n) => ({ ...n })), before: 0, after: 0 }))
    if (mode === "without-craft") vi.spyOn(craft, "applyMelodicCraft").mockImplementation((notes) => notes.map((n) => ({ ...n })))
    for (let index = 0; index < 24; index++) {
      let id = 0, random = 5000 + index
      vi.spyOn(Math, "random").mockImplementation(() => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296 })
      vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`)
      const fixture = melodyCharacterReviewSong(index)
      useProjectStore.setState({ project: fixture.project, persist: () => {}, history: [], future: [],
        generationSettings: { density: "balanced", rangePreset: "middle", customRange: { low: 60, high: 77 }, drama: "growing", selectedGeneratorProfiles: ["standard"], techniqueExperimentPresetId: null } })
      for (const section of fixture.project.sections) {
        const performance: { before: ReturnType<typeof characterMetrics>; after: ReturnType<typeof characterMetrics> }[] = []
        const perform = generationInputs.performGeneratedNotes
        const performanceSpy = vi.spyOn(generationInputs, "performGeneratedNotes").mockImplementation((...args) => {
          const result = perform(...args)
          performance.push({ before: characterMetrics(args[2]), after: characterMetrics(result.notes) })
          return result
        })
        const { records } = traceStages(() => useProjectStore.getState().generateForSection(section.id))
        performanceSpy.mockRestore()
        const state = useProjectStore.getState(), variants = state.project.melodyVariants.filter((v) => v.sectionId === section.id && v.batchId === state.activeBatchId)
        const notes = notesByPartRole(variants[0], "lead"), chords = state.project.chords.filter((c) => c.sectionId === section.id)
        const output = records.filter((r) => r.stage === "output")
        const crafted = lastPerPool(records, "harmonicIntegrity", "craft")
        const selectedBeforeFinal = output.flatMap((r) => crafted.filter((c) => c.context.profile === r.context.profile && c.context.poolIndex === r.context.poolIndex))
        const quality = measureMelodyCraft(notes, chords, fixture.key)
        rows.push({ mode, index, key: fixture.key, tempo: fixture.tempo, style: fixture.style, seed: fixture.seed, role: section.role,
          progression: chords.map((c) => c.symbol),
          stages: { assembled: lastPerPool(records, "assemble").map((r) => characterMetrics(r.notes)),
            crafted: crafted.map((r) => characterMetrics(r.notes)), selected: selectedBeforeFinal.map((r) => characterMetrics(r.notes)),
            classical: lastPerPool(records, "refineTowardClassical").map((r) => characterMetrics(r.notes)),
            output: output.map((r) => characterMetrics(r.notes)), beforePerformance: performance.map((r) => r.before),
            afterPerformance: performance.map((r) => r.after), performed: variants.map((v) => characterMetrics(notesByPartRole(v, "lead"))) },
          first: characterMetrics(notes), quality, classical: classicalLikeness(quality, CLASSICAL_MODELS), features: computeMelodyFeatures(notes, buildHarmonicMap(chords), 0, 32),
          target: variants[0].melodyCharacter,
          notes: notes.map(({ pitch, startBeat, durationBeats }) => ({ pitch, startBeat, durationBeats })) })
      }
      const project = useProjectStore.getState().project
      const loaded = normalizeProject(JSON.parse(JSON.stringify(project)))
      expect(loaded.melodyVariants.map((v) => [v.melodyCharacter, v.performanceSpec]))
        .toEqual(project.melodyVariants.map((v) => [v.melodyCharacter, v.performanceSpec]))
      vi.mocked(Math.random).mockRestore(); vi.mocked(crypto.randomUUID).mockRestore()
    }
    vi.restoreAllMocks()
  }
  if (process.env.MELODY_CHARACTER_RESULT_PATH) writeFileSync(process.env.MELODY_CHARACTER_RESULT_PATH, JSON.stringify(rows, null, 2))
  expect(rows).toHaveLength(144)
  expect(rows.every((r) => r.stages.assembled.length > 0 && r.stages.output.length === 3)).toBe(true)
  const normal = rows.filter((r) => r.mode === "normal")
  const span = distribution(normal.map((r) => r.first.range)), long = distribution(normal.map((r) => r.first.long))
  const offbeat = distribution(normal.map((r) => r.first.offbeat)), density = distribution(normal.map((r) => r.first.density))
  expect(span.sd).toBeGreaterThanOrEqual(3.5); expect(span.p90).toBeGreaterThanOrEqual(15); expect(span.p10).toBeLessThanOrEqual(9)
  expect(long.sd).toBeGreaterThanOrEqual(.20); expect(long.p10).toBeLessThanOrEqual(.12)
  expect(long.p90).toBeGreaterThanOrEqual(.60); expect(long.median).toBeGreaterThanOrEqual(.35)
  expect(offbeat.median).toBeLessThanOrEqual(.42); expect(offbeat.p10).toBeLessThanOrEqual(.15)
  expect(density.sd).toBeGreaterThanOrEqual(.28); expect(density.p90).toBeGreaterThanOrEqual(1.3)
  expect(mean(normal.filter((r) => r.role === "chorus").map((r) => r.first.range))
    - mean(normal.filter((r) => r.role === "verse").map((r) => r.first.range))).toBeGreaterThanOrEqual(2)
  expect(mean(normal.filter((r) => r.tempo < 90).map((r) => r.first.long))
    - mean(normal.filter((r) => r.tempo >= 120).map((r) => r.first.long))).toBeGreaterThanOrEqual(.10)
  // 98b71b6の同じ48旋律。定義・重みを変えず、分布の幅と既存品質を同時に守る。
  for (const [key, baseline] of [["stepwise", .3723842177542176], ["leapRate", .15459717705586912], ["repeatedPitch", .2541492698652176]] as const) {
    expect(Math.abs(mean(normal.map((r) => r.quality[key])) - baseline), key).toBeLessThanOrEqual(.05)
  }
  expect(mean(normal.map((r) => r.quality.strongBeatChordTone))).toBeGreaterThanOrEqual(.9334426857864359 * .98)
  expect(normal.every((r) => r.features.hookStrength !== undefined)).toBe(true)
  expect(mean(normal.map((r) => r.features.hookStrength!))).toBeGreaterThanOrEqual(.5896610067687686 * .98)
  expect(mean(normal.map((r) => r.classical.typicality * 100))).toBeGreaterThanOrEqual(57.830911207328136 * .98)
  expect(normal.every((r) => r.notes.every((n) => n.pitch >= 60 && n.pitch <= 77))).toBe(true)
}, 240_000)
