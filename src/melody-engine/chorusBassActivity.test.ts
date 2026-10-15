import { afterEach, describe, expect, it, vi } from "vitest"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import type { ArrangementPlan, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { parseChordSymbol } from "@/core/chord"
import { chorusBassActivity, shapeChorusBass } from "./chorusBassActivity"
import { measureBass } from "@/store/arrangementPerformanceMeasurements"

afterEach(() => vi.restoreAllMocks())
function fixture(which: "A" | "B") {
  let id = 0
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`)
  const project = arrangementReviewSong(which)
  const plan = { sections: project.sections.map((s) => ({ sectionId: s.id, developmentStage: 0 })) } as ArrangementPlan
  const track = (id: GeneratedArrangementTrack["id"]): GeneratedArrangementTrack => ({ id, name: id,
    family: id === "dr-kick" ? "drums" : "bass", purpose: "test", muted: false, generationRevision: 0,
    notes: project.sections.flatMap((section) => project.chords.filter((c) => c.sectionId === section.id).map((c, i) => ({
      id: `${id}:${section.id}:${i}`, sectionId: section.id, startBeat: (section.startBar - 1) * 4 + c.startBeat,
      durationBeats: 1, velocity: 80, pitch: id === "dr-kick" ? 36 : 36 + parseChordSymbol(c.symbol)!.bassPc,
      locks: [], character: "safe" as const, reason: "test" }))) })
  return { project, plan, tracks: [track("syn-bass"), track("syn-sub-bass"), track("syn-bass-mid"), track("dr-kick")] }
}
describe("曲調に応じたサビの低音", () => {
  it("90〜110bpmを連続補間し、曲調と歌の密度も活動量へ反映する", () => {
    const { project } = fixture("A"), id = project.sections[3].id
    const values = [76, 90, 95, 100, 105, 110, 118].map((tempo) => chorusBassActivity({ ...project, song: { ...project.song, tempo } }, id, .3).value)
    expect(values[0]).toBeLessThan(.2)
    expect(values.at(-1)!).toBeGreaterThan(.8)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(chorusBassActivity(project, id, .9).value).toBeLessThanOrEqual(chorusBassActivity(project, id, .2).value)
  })
  for (const which of ["A", "B"] as const) it(`${which}: サビだけを整理し、音数・低音・サブの持続を保つ`, () => {
    const { project, plan, tracks } = fixture(which), snapshot = structuredClone(tracks)
    const shaped = shapeChorusBass(project, plan, tracks)
    const stats = measureBass(project, { tracks: shaped } as Parameters<typeof measureBass>[1])
    for (const section of stats.filter((s) => ["chorus", "grand-chorus"].includes(s.role))) {
      expect(section.matchedRoots).toBe(section.roots)
      expect(section.matchedSlashes).toBe(section.slashes)
      expect(section.layers[0].notesPerBar).toBeLessThanOrEqual(which === "A" ? 3.5 : 6)
      expect(section.layers[1].notesPerBar).toBeLessThanOrEqual(2.5)
      expect(section.layers[2].notesPerBar).toBeLessThanOrEqual(2)
      expect(section.layers[2].approaches).toBe(0)
    }
    for (const [i, track] of shaped.entries()) expect(track.notes.filter((n) => !project.sections.some((s) => s.id === n.sectionId && ["chorus", "grand-chorus"].includes(s.role))))
      .toEqual(tracks[i].notes.filter((n) => !project.sections.some((s) => s.id === n.sectionId && ["chorus", "grand-chorus"].includes(s.role))))
    expect(tracks).toEqual(snapshot)
    expect(shaped[3]).toEqual(tracks[3])
    expect(shapeChorusBass(project, plan, tracks, new Set(["dr-kick"]))).toEqual(tracks)
  })
})
