import { afterEach, describe, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ArrangementPlan, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { budgetedBackgroundVoiceLeading } from "./budgetedBackgroundVoiceLeading"

afterEach(() => vi.restoreAllMocks())
function fixture() {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001")
  const project = createEmptyProject("global budget")
  project.sections = [
    { id: "fixed", name: "Intro", role: "intro", startBar: 1, lengthBars: 1 },
    { id: "edit", name: "Verse", role: "verse", startBar: 2, lengthBars: 20 },
  ]
  project.chords = []
  project.sourceImport = { type: "midi", sourceKind: "external-song", fileName: "lead.mid", importedAt: "2026-10-16",
    format: 1, ppq: 480, trackCount: 1, melodyTrackName: "lead", melodyTrackConfidence: 1,
    chordInferenceConfidence: 1, sectionsFromMarkers: true, warnings: [] }
  project.importedArrangement = { version: "1.0.0", sourceKind: "external-song", totalBeats: 84,
    tracks: [{ sourceTrackIndex: 1, name: "lead", role: "melody", notes: [[6, 1, 67, 80, 0]] }] }
  const notes = Array.from({ length: 18 }, (_, i) => ({ id: `n${i}`, sectionId: i ? "edit" : "fixed", voiceId: "v:2",
    startBeat: i * 4, durationBeats: i === 1 ? 4 : 1, pitch: i === 1 ? 77 : 64, velocity: 60,
    locks: [], character: "safe" as const, reason: "test" }))
  notes.push(...[55, 60].map((pitch, i) => ({ ...notes[1], id: `support${i}`, voiceId: `v:${i}`, pitch })))
  const pad: GeneratedArrangementTrack = { id: "syn-dark-pad", name: "pad", family: "synth", purpose: "background", muted: false, generationRevision: 0, notes }
  const bass: GeneratedArrangementTrack = { ...pad, id: "syn-bass", family: "bass", notes: [{ ...notes[1], id: "bass", pitch: 52 }] }
  return { project, plan: {} as ArrangementPlan, pad, bass, scope: new Set(["edit"]) }
}
describe("全曲の配置と編集予算の同時最適化", () => {
  it("固定声部を動かさず、低域・主旋律を避ける短縮を1音だけ選ぶ", () => {
    const { project, plan, pad, bass, scope } = fixture()
    const original = structuredClone({ project, pad, bass })
    const result = budgetedBackgroundVoiceLeading(project, plan, [pad, bass], undefined, undefined, scope)
    expect(result.report.records).toHaveLength(1)
    expect(result.report.records[0]).toMatchObject({ noteId: "n1", action: "shorten", startBeat: 4, durationBeats: 2, attemptedPitch: 65 })
    const notes = result.tracks[0].notes
    expect(notes.find((n) => n.id === "n0")).toEqual(pad.notes[0])
    expect(notes.find((n) => n.id === "n1")).toMatchObject({ pitch: 65, startBeat: 4, durationBeats: 2 })
    expect(notes).toHaveLength(20)
    expect(result.tracks[1]).toBe(bass)
    expect({ project, pad, bass }).toEqual(original)
    expect(result).toEqual(budgetedBackgroundVoiceLeading(project, plan, [pad, bass], undefined, undefined, scope))
  })
  it("予算不足では時間を変えず、範囲外・旧データの音も保持する", () => {
    const { project, plan, pad, bass, scope } = fixture()
    const small = { ...pad, notes: pad.notes.slice(0, 19) }
    const result = budgetedBackgroundVoiceLeading(project, plan, [small, bass], undefined, undefined, scope)
    expect(result.report.records).toEqual([])
    expect(result.tracks[0]).toBe(small)
    expect(budgetedBackgroundVoiceLeading(project, plan, [pad, bass], undefined, new Set(["str-cello"])).tracks).toEqual([pad, bass])
    const legacy = { ...pad, notes: pad.notes.map(({ voiceId: _voice, ...n }) => n) }
    expect(budgetedBackgroundVoiceLeading(project, plan, [legacy, bass]).tracks).toEqual([legacy, bass])
  })
})
