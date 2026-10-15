import { afterEach, describe, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ArrangementPlan, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { repairBackgroundOctaveConflicts } from "./backgroundConflictRepair"

// この単体テストでは時間編集の許可条件だけを分離する。実際のDPは測定テストでも通す。
vi.mock("./backgroundVoiceLeading", () => ({ minimizeBackgroundVoiceMovement: (_p: unknown, _a: unknown, tracks: GeneratedArrangementTrack[]) => tracks }))
afterEach(() => vi.restoreAllMocks())

function fixture(melodyStart = 6) {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001")
  const project = createEmptyProject("protected lead")
  project.sections = [{ id: "s", name: "Verse", role: "verse", startBar: 1, lengthBars: 24 }]
  project.chords = []
  project.sourceImport = { type: "midi", sourceKind: "external-song", fileName: "lead.mid", importedAt: "2026-10-15",
    format: 1, ppq: 480, trackCount: 1, melodyTrackName: "lead", melodyTrackConfidence: 1,
    chordInferenceConfidence: 1, sectionsFromMarkers: true, warnings: [] }
  project.importedArrangement = { version: "1.0.0", sourceKind: "external-song", totalBeats: 96,
    tracks: [{ sourceTrackIndex: 1, name: "lead", role: "melody", notes: [[melodyStart, 1, 67, 80, 0]] }] }
  const notes = Array.from({ length: 18 }, (_, i) => ({ id: `n${i}`, sectionId: "s", voiceId: "v:2",
    startBeat: i * 4, durationBeats: i === 1 ? 4 : 1, pitch: i === 1 ? 77 : 64, velocity: 60,
    locks: [], character: "safe" as const, reason: "test" }))
  notes.push(...[55, 60].map((pitch, i) => ({ ...notes[0], id: `other${i}`, voiceId: `v:${i}`, startBeat: 4, durationBeats: 4, pitch })))
  const pad: GeneratedArrangementTrack = { id: "syn-dark-pad", name: "pad", family: "synth", purpose: "background",
    muted: false, generationRevision: 0, notes }
  return { project, plan: {} as ArrangementPlan, pad }
}

describe("主旋律と接触する背景音だけの限定修理", () => {
  it("近いオクターブが衝突するときだけ主旋律の直前まで短縮し、開始と他声部は保つ", () => {
    const { project, plan, pad } = fixture(), before = structuredClone(project)
    const result = repairBackgroundOctaveConflicts(project, plan, [pad])
    expect(result.report.records).toHaveLength(1)
    expect(result.report.records[0]).toMatchObject({ noteId: "n1", action: "shorten", startBeat: 4,
      durationBeats: 2, collisionStartBeat: 6, bar: 2, trackId: "syn-dark-pad" })
    expect(result.tracks[0].notes.find((n) => n.id === "n1")).toMatchObject({ startBeat: 4, durationBeats: 2, pitch: 65 })
    expect(result.tracks[0].notes.filter((n) => n.id.startsWith("other"))).toEqual(pad.notes.filter((n) => n.id.startsWith("other")))
    expect(result.report.records.length).toBeLessThanOrEqual(result.report.sourcePadNoteCount * .05)
    expect(project).toEqual(before)
    expect(pad.notes.find((n) => n.id === "n1")!.durationBeats).toBe(4)
  })
  it("同時に主旋律が始まる場合だけ休符化し、他の声部は残す", () => {
    const { project, plan, pad } = fixture(4)
    const result = repairBackgroundOctaveConflicts(project, plan, [pad])
    expect(result.report.records).toHaveLength(1)
    expect(result.report.records[0].action).toBe("rest")
    expect(result.tracks[0].notes).toHaveLength(19)
    expect(result.tracks[0].notes.filter((n) => n.id.startsWith("other"))).toHaveLength(2)
  })
  it("安全なオクターブがある場合、時間・ノート数には一切触れない", () => {
    const { project, plan, pad } = fixture(40)
    const result = repairBackgroundOctaveConflicts(project, plan, [pad])
    expect(result.report.records).toEqual([])
    expect(result.tracks[0].notes).toHaveLength(20)
    expect(result.tracks[0].notes.map((n) => [n.id, n.startBeat, n.durationBeats])).toEqual(pad.notes.map((n) => [n.id, n.startBeat, n.durationBeats]))
  })
  it("5%未満の予算・編集範囲外・残す声部のない場合は時間を変更しない", () => {
    const { project, plan, pad } = fixture()
    const small = { ...pad, notes: pad.notes.slice(0, 18) }
    expect(repairBackgroundOctaveConflicts(project, plan, [small]).report.records).toEqual([])
    expect(repairBackgroundOctaveConflicts(project, plan, [pad], undefined, new Set(["str-cello"])).tracks).toEqual([pad])
    expect(repairBackgroundOctaveConflicts(project, plan, [pad], undefined, undefined, new Set(["other"])).tracks).toEqual([pad])
    const rest = fixture(4)
    const singleVoice = { ...rest.pad, notes: [...rest.pad.notes.slice(0, 18), ...rest.pad.notes.slice(0, 2).map((n) => ({ ...n, id: `fill-${n.id}`, startBeat: 80 + n.startBeat }))] }
    expect(repairBackgroundOctaveConflicts(rest.project, rest.plan, [singleVoice]).report.records).toEqual([])
    // 休符化だけでなく、孤立した持続音の短縮も禁止する（予算は1音ある）。
    expect(repairBackgroundOctaveConflicts(project, plan, [singleVoice]).report.records).toEqual([])
  })
  it("再評価で同じ音を再編集せず、過去の休符化も5%の予算に含める", () => {
    const { project, plan, pad } = fixture(4)
    const first = repairBackgroundOctaveConflicts(project, plan, [pad])
    const second = repairBackgroundOctaveConflicts(project, plan, first.tracks, first.report)
    expect(second).toEqual(first)
    expect(second.report.sourcePadNoteCount).toBe(20)
    expect(second.report.maximumEditedNotes).toBe(1)
  })
})
