import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES } from "@/core/arrangementGeneration"
import {
  analyzeFullSongArrangement,
  buildFullSongArrangementPlan,
  generateFullSongArrangement,
  regenerateFullSongArrangementTarget,
} from "./arrangementGenerator"
import { exportArrangementMidi, exportArrangementTrackMidi } from "@/midi/exportArrangement"

function project(): ComposerProject {
  const base = createEmptyProject("Arrangement Test")
  const sections: ComposerProject["sections"] = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
    { id: "verse", name: "Verse 1", role: "verse", startBar: 5, lengthBars: 4 },
    { id: "pre", name: "Pre", role: "pre-chorus", startBar: 9, lengthBars: 4 },
    { id: "chorus-1", name: "Chorus 1", role: "chorus", startBar: 13, lengthBars: 4 },
    { id: "chorus-2", name: "Chorus 2", role: "chorus", startBar: 17, lengthBars: 4 },
    { id: "final", name: "Final Chorus", role: "grand-chorus", startBar: 21, lengthBars: 4 },
    { id: "outro", name: "Outro", role: "outro", startBar: 25, lengthBars: 4 },
  ]
  const chords = sections.flatMap((section) => [
    { id: `${section.id}:1`, sectionId: section.id, startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
    { id: `${section.id}:2`, sectionId: section.id, startBeat: 4, durationBeats: 4, symbol: "Fmaj7", bass: null },
    { id: `${section.id}:3`, sectionId: section.id, startBeat: 8, durationBeats: 4, symbol: "Cmaj7", bass: null },
    { id: `${section.id}:4`, sectionId: section.id, startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
  ])
  const melodyNotes = sections.flatMap((section) => {
    const offset = (section.startBar - 1) * 4
    return Array.from({ length: 8 }, (_, index) => [
      offset + index * 2,
      index === 7 ? 0.5 : 1,
      69 + [0, 2, 3, 7][index % 4],
      82,
      0,
    ] as [number, number, number, number, number])
  })
  return {
    ...base,
    sections,
    chords,
    sourceImport: {
      type: "midi",
      sourceKind: "external-song",
      fileName: "test.mid",
      importedAt: "2026-08-30T00:00:00.000Z",
      format: 1,
      ppq: 480,
      trackCount: 2,
      melodyTrackName: "Lead",
      melodyTrackConfidence: 1,
      chordInferenceConfidence: 1,
      sectionsFromMarkers: true,
      warnings: [],
    },
    importedArrangement: {
      version: "1.0.0",
      sourceKind: "external-song",
      totalBeats: 112,
      tracks: [{ sourceTrackIndex: 1, name: "Lead", role: "melody", notes: melodyNotes }],
    },
  }
}

describe("Arrangement Generator", () => {
  it("曲全体を解析して反復サビをコピーせず段階的に拡張する", () => {
    const input = project()
    const analysis = analyzeFullSongArrangement(input)
    const plan = buildFullSongArrangementPlan(input, analysis, 1234)
    const chorus1 = plan.sections.find((section) => section.sectionId === "chorus-1")!
    const chorus2 = plan.sections.find((section) => section.sectionId === "chorus-2")!
    const final = plan.sections.find((section) => section.sectionId === "final")!

    expect(chorus2.energy).toBeGreaterThan(chorus1.energy)
    expect(final.energy).toBeGreaterThan(chorus2.energy)
    expect(chorus2.activeRoles).not.toEqual(chorus1.activeRoles)
    expect(final.activeRoles).toContain("str-upper")
    expect(final.activeRoles).toContain("dr-gran-cassa")
  })

  it("TransitionはSafe/Edge/Surpriseと無音判断を持ち、理由を説明する", () => {
    const input = project()
    const result = generateFullSongArrangement(input, { seed: 44, brief: "意外性のあるセクション間フレーズ" })
    const pre = result.plan.sections.find((section) => section.sectionId === "pre")!

    expect(pre.transitionCandidates.map((candidate) => candidate.character)).toEqual(["safe", "edge", "surprise"])
    expect(pre.transitionCandidates.every((candidate) => candidate.reason.length > 10)).toBe(true)
    expect(pre.selectedTransitionCharacter).toBe("surprise")
    expect(result.tracks.find((track) => track.id === "syn-transition-phrase")?.notes.some((note) => note.character === "surprise")).toBe(true)
  })

  it("必要な役割だけを固定名の独立トラックとして生成する", () => {
    const result = generateFullSongArrangement(project(), { seed: 9 })
    const names = result.tracks.map((track) => track.name)

    expect(names).toContain(ARRANGEMENT_TRACK_NAMES["dr-kick"])
    expect(names).toContain(ARRANGEMENT_TRACK_NAMES["syn-bass"])
    expect(names).toContain(ARRANGEMENT_TRACK_NAMES["str-violin-1"])
    expect(result.tracks.every((track) => track.notes.every((note) => note.sectionId.length > 0))).toBe(true)
    expect(result.plan.sections.every((section) => section.activeRoles.length < Object.keys(ARRANGEMENT_TRACK_NAMES).length)).toBe(true)
    expect(result.plan.sections.find((section) => section.sectionId === "intro")?.activeRoles).not.toContain("dr-snare")
  })

  it("BassのSection部分再生成で他トラックと他Sectionを変更しない", () => {
    const input = project()
    const before = generateFullSongArrangement(input, { seed: 11 })
    const otherTracks = before.tracks.filter((track) => track.id !== "syn-bass")
    const otherBassNotes = before.tracks.find((track) => track.id === "syn-bass")!.notes.filter((note) => note.sectionId !== "final")
    const after = regenerateFullSongArrangementTarget(input, before, {
      trackId: "syn-bass",
      sectionId: "final",
      energyDelta: 10,
    })

    expect(after.tracks.filter((track) => track.id !== "syn-bass")).toEqual(otherTracks)
    expect(after.tracks.find((track) => track.id === "syn-bass")!.notes.filter((note) => note.sectionId !== "final")).toEqual(otherBassNotes)
    expect(after.tracks.find((track) => track.id === "syn-bass")!.generationRevision).toBe(1)
    expect(after.plan.sections.find((section) => section.sectionId === "final")!.energy).toBe(100)
  })

  it("AI Partnerの構造化指示を対象SectionのEnergyと役割へ反映する", () => {
    const input = project()
    const result = generateFullSongArrangement(input, {
      seed: 21,
      directive: {
        sectionId: "chorus-2",
        intention: "最後の力を振り絞る直前の拡張",
        energyDelta: 12,
        add: ["str-upper", "dr-gran-cassa"],
        preserve: ["syn-bass", "dr-kick"],
        surpriseLevel: 0.45,
      },
    })
    const chorus2 = result.plan.sections.find((section) => section.sectionId === "chorus-2")!
    const chorus1 = result.plan.sections.find((section) => section.sectionId === "chorus-1")!

    expect(chorus2.intention).toBe("最後の力を振り絞る直前の拡張")
    expect(chorus2.energy).toBeGreaterThan(chorus1.energy)
    expect(chorus2.activeRoles).toContain("str-upper")
    expect(chorus2.activeRoles).toContain("dr-gran-cassa")
  })

  it("指定SectionだけをSafe/Edge/Surpriseへ切り替えられる", () => {
    const input = project()
    const before = generateFullSongArrangement(input, { seed: 31 })
    const afterTransition = regenerateFullSongArrangementTarget(input, before, {
      trackId: "syn-transition-phrase",
      sectionId: "pre",
      character: "surprise",
    })
    const afterDecoration = regenerateFullSongArrangementTarget(input, afterTransition, {
      trackId: "syn-high-glass",
      sectionId: "pre",
      character: "edge",
    })
    const pre = afterDecoration.plan.sections.find((section) => section.sectionId === "pre")!

    expect(pre.selectedTransitionCharacter).toBe("surprise")
    expect(pre.selectedDecorationCharacter).toBe("edge")
    expect(afterDecoration.tracks.find((track) => track.id === "syn-transition-phrase")?.notes.some((note) => note.sectionId === "pre" && note.character === "surprise")).toBe(true)
    expect(afterDecoration.tracks.find((track) => track.id === "syn-high-glass")?.notes.some((note) => note.sectionId === "pre" && note.character === "edge")).toBe(true)
  })

  it("全パートMIDIと単独MIDIをSoftware Instrument向けの別トラックで出力する", () => {
    const input = project()
    const result = generateFullSongArrangement(input, { seed: 55 })
    const all = new TextDecoder().decode(exportArrangementMidi(input, result))
    const bass = new TextDecoder().decode(exportArrangementTrackMidi(input, result, "syn-bass"))

    expect(all).toContain("DR_Kick")
    expect(all).toContain("SYN_Bass")
    expect(all).toContain("STR_Violin1")
    expect(bass).toContain("SYN_Bass")
    expect(bass).not.toContain("DR_Kick")
  })
})
