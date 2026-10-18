import { afterEach, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { effectiveSectionKey } from "@/core/project"
import { selectConsonantMelodyPitches } from "./melodyConsonance"
type Note = { pitch: number; startBeat: number; durationBeats: number }
function lcs(a: Note[], b: Note[]) {
  const signs = (ns: Note[]) => ns.slice(1).map((n, i) => Math.sign(n.pitch - ns[i].pitch))
  const x = signs(a), y = signs(b); let row = Array(y.length + 1).fill(0)
  for (const sign of x) { const next = [0]; y.forEach((v, j) => next.push(sign === v ? row[j] + 1 : Math.max(row[j + 1], next[j]))); row = next }
  return row[y.length] / Math.max(1, x.length, y.length)
}
afterEach(() => vi.restoreAllMocks())
it("半音衝突対策単体は旧13回の全音数・発音位置・長さを維持し輪郭LCS0.85以上", () => {
  let id = 0
  vi.spyOn(Math, "random").mockReturnValue(.25)
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`)
  const baseline: { which: "A" | "B"; sections: { notes: Note[] }[] }[] = JSON.parse(readFileSync(new URL("../../docs/reviews/melody-consonance-before-2026-10-18.json", import.meta.url), "utf8"))
  for (const run of baseline) {
    const project = arrangementReviewSong(run.which)
    const output = run.sections.map((s, i) => selectConsonantMelodyPitches(s.notes.map((n, j) => ({ ...n, id: `n${j}`, locks: [], velocity: 80 })),
      project.chords.filter((c) => c.sectionId === project.sections[i].id), effectiveSectionKey(project, project.sections[i].id), { low: 60, high: 79 }))
    expect(output.reduce((s, ns) => s + ns.length, 0)).toBeGreaterThanOrEqual(run.sections.reduce((s, ns) => s + ns.notes.length, 0) * .9)
    expect(output.reduce((s, ns, i) => s + lcs(run.sections[i].notes, ns), 0) / output.length).toBeGreaterThanOrEqual(.85)
    output.forEach((ns, i) => expect(ns.map((n) => [n.startBeat, n.durationBeats])).toEqual(run.sections[i].notes.map((n) => [n.startBeat, n.durationBeats])))
  }
})
