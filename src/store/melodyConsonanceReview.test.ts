import { afterEach, expect, it, vi } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import { arrangementReviewSong } from "./arrangementReviewFixtures"
import { useProjectStore } from "./useProjectStore"
import { notesByPartRole } from "@/core/sectionLayers"
import { parseChordSymbol } from "@/core/chord"
import { effectiveSectionKey } from "@/core/project"
import { keyScalePitchClasses } from "@/core/scale"

const baselinePath = new URL("../../docs/reviews/melody-consonance-before-2026-10-18.json", import.meta.url)
type Note = { pitch: number; startBeat: number; durationBeats: number }
type Row = { which: string; seed: number; sections: { name: string; bar: number; notes: Note[]; strong: number; clashes: number; chromaticExceptions: number; unresolvedChromatic?: number; cadence: boolean }[] }
function contourLcs(a: Note[], b: Note[]) {
  const signs = (ns: Note[]) => ns.slice(1).map((n, i) => Math.sign(n.pitch - ns[i].pitch))
  const x = signs(a), y = signs(b)
  let row = Array(y.length + 1).fill(0)
  for (const sign of x) { const next = [0]; y.forEach((v, j) => next.push(sign === v ? row[j] + 1 : Math.max(row[j + 1], next[j]))); row = next }
  return row[y.length] / Math.max(1, x.length, y.length)
}
afterEach(() => vi.restoreAllMocks())
it("12回の旋律とseed5000でコードとの半音衝突・輪郭・終止を検証する", () => {
  const baseline: Row[] = JSON.parse(readFileSync(baselinePath, "utf8"))
  const results: Row[] = []
  for (const which of ["A", "B"] as const) for (const seed of which === "A" ? [1, 2, 3, 4, 5, 6, 5000] : [1, 2, 3, 4, 5, 6]) {
    let random = seed, id = 0
    vi.spyOn(Math, "random").mockImplementation(() => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296 })
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`)
    useProjectStore.setState({ project: arrangementReviewSong(which), persist: () => {}, history: [], future: [],
      generationSettings: { density: "balanced", rangePreset: "middle", customRange: { low: 60, high: 77 }, drama: "growing", selectedGeneratorProfiles: ["standard"], techniqueExperimentPresetId: null } })
    for (const section of useProjectStore.getState().project.sections) {
      const protectedVariants = structuredClone(useProjectStore.getState().project.melodyVariants)
      useProjectStore.getState().generateForSection(section.id)
      const state = useProjectStore.getState(), candidate = state.project.melodyVariants.find((v) => v.sectionId === section.id && v.batchId === state.activeBatchId)!
      expect(state.project.melodyVariants.filter((v) => protectedVariants.some((old) => old.id === v.id))).toEqual(protectedVariants)
      state.assignVariantToSection(section.id, candidate.id)
    }
    const project = useProjectStore.getState().project
    results.push({ which, seed, sections: project.sections.map((section) => {
      const notes = notesByPartRole(project.melodyVariants.find((v) => v.id === project.sectionMelodyAssignments[section.id])!, "lead")
      const chords = project.chords.filter((c) => c.sectionId === section.id)
      const tonesAt = (beat: number) => { const c = chords.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats)!; const parsed = parseChordSymbol(c.symbol, c.bass ?? undefined)!; return [...new Set([...parsed.tones, ...parsed.tensions].map((t) => t.pitchClass).concat(parsed.bassPc))] }
      const strong = (n: Note) => Math.abs(n.startBeat - Math.round(n.startBeat / 2) * 2) <= .06 || n.durationBeats >= .75
      const clashes = (n: Note) => { const tones = tonesAt(n.startBeat), pc = n.pitch % 12; return !tones.includes(pc) && tones.some((p) => [1, 11].includes((pc - p + 12) % 12)) }
      const scale = keyScalePitchClasses(effectiveSectionKey(project, section.id))
      const last = notes.at(-1)!
      const chromatic = notes.flatMap((n, i) => {
        if (scale.includes(n.pitch % 12) || tonesAt(n.startBeat).includes(n.pitch % 12)) return []
        const next = notes[i + 1]
        const valid = !strong(n) && n.durationBeats <= .5 && next && Math.abs(next.pitch - n.pitch) >= 1 && Math.abs(next.pitch - n.pitch) <= 2
          && tonesAt(next.startBeat).includes(next.pitch % 12)
        return [{ pitch: n.pitch, startBeat: n.startBeat, durationBeats: n.durationBeats, nextPitch: next?.pitch, nextBeat: next?.startBeat, valid: !!valid }]
      })
      return { name: section.name, bar: section.startBar, notes: notes.map(({ pitch, startBeat, durationBeats }) => ({ pitch, startBeat, durationBeats })),
        key: effectiveSectionKey(project, section.id), chords: chords.map(({ symbol, startBeat, durationBeats, bass }) => ({ symbol, startBeat, durationBeats, bass })),
        strong: notes.filter(strong).length, clashes: notes.filter((n) => strong(n) && clashes(n)).length,
        chromaticExceptions: chromatic.filter((n) => n.valid).length, unresolvedChromatic: chromatic.filter((n) => !n.valid).length,
        exceptionDetails: chromatic.filter((n) => n.valid),
        cadence: last.durationBeats >= 1 && tonesAt(last.startBeat).includes(last.pitch % 12) }
    }) })
    vi.restoreAllMocks()
  }
  if (process.env.MELODY_CONSONANCE_RESULT_PATH) writeFileSync(process.env.MELODY_CONSONANCE_RESULT_PATH, JSON.stringify(results, null, 2))
  for (const r of results.filter((r) => r.seed !== 5000)) {
    const total = r.sections.reduce((s, x) => s + x.strong, 0), clashes = r.sections.reduce((s, x) => s + x.clashes, 0)
    expect.soft(clashes / total, `${r.which}/${r.seed}の半音衝突`).toBeLessThanOrEqual(.05)
    expect(r.sections.reduce((s, x) => s + (x.unresolvedChromatic ?? 0), 0), "例外の条件を満たさないスケール外音は残さない").toBe(0)
    const old = baseline.find((b) => b.which === r.which && b.seed === r.seed)
    expect(old).toBeDefined()
    if (old) {
      expect(r.sections.reduce((s, x) => s + x.notes.length, 0)).toBeGreaterThanOrEqual(old.sections.reduce((s, x) => s + x.notes.length, 0) * .9)
      expect(r.sections.reduce((s, x, i) => s + contourLcs(old.sections[i].notes, x.notes), 0) / r.sections.length).toBeGreaterThanOrEqual(.85)
      expect(r.sections.filter((s) => s.cadence).length).toBeGreaterThanOrEqual(old.sections.filter((s) => s.cadence).length)
      r.sections.forEach((section, i) => expect(section.notes.map((n) => [n.startBeat, n.durationBeats]))
        .toEqual(old.sections[i].notes.map((n) => [n.startBeat, n.durationBeats])))
    }
  }
  const verse = results.find((r) => r.which === "A" && r.seed === 5000)!.sections[1]
  for (const [bar, pc] of [[7, 8], [9, 8], [10, 7]]) expect.soft(verse.notes.filter((n) => Math.floor(n.startBeat / 4) + verse.bar === bar
    && n.pitch % 12 === pc && (Math.abs(n.startBeat - Math.round(n.startBeat / 2) * 2) <= .06 || n.durationBeats >= .75))).toHaveLength(0)
}, 120_000)

it("再生成でも取り込み・採用済みの主旋律は一切変更しない", () => {
  let id = 0, random = 5000
  vi.spyOn(Math, "random").mockImplementation(() => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296 })
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`)
  useProjectStore.setState({ project: arrangementReviewSong("A"), persist: () => {}, history: [], future: [],
    generationSettings: { density: "balanced", rangePreset: "middle", customRange: { low: 60, high: 77 }, drama: "growing", selectedGeneratorProfiles: ["standard"], techniqueExperimentPresetId: null } })
  const section = useProjectStore.getState().project.sections[1]
  useProjectStore.getState().generateForSection(section.id)
  const state = useProjectStore.getState(), candidate = state.project.melodyVariants.find((v) => v.sectionId === section.id)!
  state.assignVariantToSection(section.id, candidate.id)
  const imported = { version: "1.0.0" as const, sourceKind: "external-song" as const, totalBeats: 256,
    tracks: [{ sourceTrackIndex: 1, name: "lead", role: "melody" as const, notes: [[16, 4, 68, 80, 0] as [number, number, number, number, number]] }] }
  useProjectStore.setState({ project: { ...useProjectStore.getState().project, importedArrangement: imported } })
  const before = structuredClone({ candidate, imported })
  useProjectStore.getState().generateForSection(section.id)
  const after = useProjectStore.getState().project
  expect(after.melodyVariants.find((v) => v.id === candidate.id)).toEqual(before.candidate)
  expect(after.importedArrangement).toEqual(before.imported)
})
