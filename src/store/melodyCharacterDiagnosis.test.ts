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

export function characterMetrics(notes: readonly Pick<StageNote, "pitch" | "startBeat" | "durationBeats">[]) {
  const end = Math.max(...notes.map((n) => n.startBeat + n.durationBeats)), start = Math.min(...notes.map((n) => n.startBeat))
  return { range: Math.max(...notes.map((n) => n.pitch)) - Math.min(...notes.map((n) => n.pitch)),
    long: notes.filter((n) => n.durationBeats >= 1).length / notes.length,
    offbeat: notes.filter((n) => Math.abs(n.startBeat - Math.round(n.startBeat)) > .05).length / notes.length,
    density: notes.length / Math.max(.01, end - start) }
}
function lastPerPool(records: StageRecord[], stage: string, phase?: string) {
  const map = new Map<string, StageRecord>()
  for (const r of records) if (r.stage === stage && (!phase || r.context.phase === phase)) map.set(`${r.context.profile}:${r.context.poolIndex}`, r)
  return [...map.values()]
}
afterEach(() => vi.restoreAllMocks())
it("24曲48旋律の段階別分布と推敲ablationを記録する（生成ロジックは変更しない）", () => {
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
          notes: notes.map(({ pitch, startBeat, durationBeats }) => ({ pitch, startBeat, durationBeats })) })
      }
      vi.mocked(Math.random).mockRestore(); vi.mocked(crypto.randomUUID).mockRestore()
    }
    vi.restoreAllMocks()
  }
  if (process.env.MELODY_CHARACTER_RESULT_PATH) writeFileSync(process.env.MELODY_CHARACTER_RESULT_PATH, JSON.stringify(rows, null, 2))
  expect(rows).toHaveLength(144)
  expect(rows.every((r) => r.stages.assembled.length > 0 && r.stages.output.length === 3)).toBe(true)
}, 240_000)
