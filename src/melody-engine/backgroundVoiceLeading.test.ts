import { afterEach, describe, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { ArrangementPlan, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { minimizeBackgroundVoiceMovement } from "./backgroundVoiceLeading"

afterEach(() => vi.restoreAllMocks())
function fixture() {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001")
  const project = { ...createEmptyProject("voicing"), sections: [{ id: "s", name: "Verse", role: "verse" as const, startBar: 1, lengthBars: 4 }], chords: [] }
  const plan = { directive: undefined } as ArrangementPlan
  const track: GeneratedArrangementTrack = { id: "syn-dark-pad", name: "pad", family: "synth", purpose: "background",
    muted: false, generationRevision: 0, notes: [64, 53, 65, 52].map((pitch, i) => ({ id: `n${i}`,
      sectionId: "s", voiceId: "voice:0", startBeat: i * 4, durationBeats: 3, pitch, velocity: 60,
      locks: [], character: "safe" as const, reason: "test" })) }
  return { project, plan, track }
}
describe("背景和音のオクターブ配置", () => {
  it("音名・発音・長さ・音数を固定し、セクション全体の大跳躍を小さくする", () => {
    const { project, plan, track } = fixture(), snapshot = structuredClone(track)
    const notes = minimizeBackgroundVoiceMovement(project, plan, [track])[0].notes
    expect(notes).toHaveLength(track.notes.length)
    notes.forEach((note, i) => {
      expect({ ...note, pitch: note.pitch % 12 }).toEqual({ ...track.notes[i], pitch: track.notes[i].pitch % 12 })
      expect(note.pitch).toBeGreaterThanOrEqual(55)
      expect(note.pitch).toBeLessThanOrEqual(84)
      if (i) expect(Math.abs(note.pitch - notes[i - 1].pitch)).toBeLessThanOrEqual(2)
    })
    expect(track).toEqual(snapshot)
  })
  it("保護された主旋律との衝突を作らず、取り込み旋律を一切変えない", () => {
    const { project, plan, track } = fixture()
    project.sourceImport = { type: "midi", sourceKind: "external-song", fileName: "lead.mid", importedAt: "2026-10-15",
      format: 1, ppq: 480, trackCount: 1, melodyTrackName: "lead", melodyTrackConfidence: 1,
      chordInferenceConfidence: 1, sectionsFromMarkers: true, warnings: [] }
    project.importedArrangement = { version: "1.0.0", sourceKind: "external-song", totalBeats: 16,
      tracks: [{ sourceTrackIndex: 1, name: "lead", role: "melody", notes: [[0, 16, 65, 80, 0]] }] }
    const imported = structuredClone(project.importedArrangement)
    const result = minimizeBackgroundVoiceMovement(project, plan, [track])
    expect(result[0].notes.every((n) => Math.abs(n.pitch - 65) > 2)).toBe(true)
    expect(project.importedArrangement).toEqual(imported)
  })
  it("編集範囲外と声部IDのない保存データを変更しない", () => {
    const { project, plan, track } = fixture()
    expect(minimizeBackgroundVoiceMovement(project, plan, [track], new Set(["str-cello"]))[0]).toBe(track)
    expect(minimizeBackgroundVoiceMovement(project, plan, [track], undefined, new Set(["other"]))[0]).toEqual(track)
    const legacy = { ...track, notes: track.notes.map(({ voiceId: _voice, ...n }) => n) }
    expect(minimizeBackgroundVoiceMovement(project, plan, [legacy])[0]).toEqual(legacy)
  })
})
