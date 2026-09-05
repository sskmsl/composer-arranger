import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES } from "@/core/arrangementGeneration"
import { parseChordSymbol } from "@/core/chord"
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

function longFormProject(): ComposerProject {
  const base = createEmptyProject("Long Form Arrangement Test")
  const definitions = [
    ["intro", "INTRO", "intro", 16],
    ["verse-1", "VERSE 1", "verse", 8],
    ["pre-1", "PRE-CHORUS", "pre-chorus", 8],
    ["chorus-1", "CHORUS 1", "chorus", 8],
    ["verse-2", "VERSE 2 / INSTRUMENTAL DEVELOPMENT", "verse", 8],
    ["pre-2", "PRE-CHORUS 2", "pre-chorus", 8],
    ["chorus-2", "CHORUS 2", "chorus", 8],
    ["breakdown", "BREAKDOWN", "breakdown-chorus", 8],
    ["bridge", "CINEMATIC BRIDGE", "bridge", 8],
    ["build", "FINAL BUILD", "pre-chorus", 8],
    ["final", "FINAL CHORUS", "grand-chorus", 16],
    ["reprise", "OUTRO / INTRO REPRISE", "outro", 8],
    ["hold", "FINAL HOLD", "outro", 5],
  ] as const
  let nextBar = 1
  const sections: ComposerProject["sections"] = definitions.map(([id, name, role, lengthBars]) => {
    const section = { id, name, role, startBar: nextBar, lengthBars } as ComposerProject["sections"][number]
    nextBar += lengthBars
    return section
  })
  const chords = sections.flatMap((section) => Array.from({ length: Math.ceil(section.lengthBars / 2) }, (_, index) => ({
    id: `${section.id}:${index}`,
    sectionId: section.id,
    startBeat: index * 8,
    durationBeats: Math.min(8, section.lengthBars * 4 - index * 8),
    symbol: ["F#m(add9)", "Dmaj7", "A", "Esus4"][index % 4],
    bass: null,
  })))
  const melodyNotes = sections.flatMap((section) => {
    const offset = (section.startBar - 1) * 4
    return Array.from({ length: section.lengthBars * 2 }, (_, index) => [
      offset + index * 2,
      index % 4 === 3 ? 0.5 : 1,
      66 + [0, 2, 4, 7, 4, 2][index % 6],
      80,
      0,
    ] as [number, number, number, number, number])
  })
  return {
    ...base,
    sections,
    chords,
    sourceImport: {
      type: "midi", sourceKind: "external-song", fileName: "long-form.mid", importedAt: "2026-09-05T00:00:00.000Z",
      format: 1, ppq: 480, trackCount: 2, melodyTrackName: "Lead", melodyTrackConfidence: 1,
      chordInferenceConfidence: 1, sectionsFromMarkers: true, warnings: [],
    },
    importedArrangement: {
      version: "1.0.0", sourceKind: "external-song", totalBeats: (nextBar - 1) * 4,
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

  it("読み込んだコードと主旋律、およびコードからのMelody生成用データを変更しない", () => {
    const input = project()
    const chordsBefore = structuredClone(input.chords)
    const variantsBefore = structuredClone(input.melodyVariants)
    const assignmentsBefore = structuredClone(input.sectionMelodyAssignments)
    const importedBefore = structuredClone(input.importedArrangement)

    generateFullSongArrangement(input, { seed: 10, brief: "主旋律は保持して伴奏だけを設計" })

    expect(input.chords).toEqual(chordsBefore)
    expect(input.melodyVariants).toEqual(variantsBefore)
    expect(input.sectionMelodyAssignments).toEqual(assignmentsBefore)
    expect(input.importedArrangement).toEqual(importedBefore)
  })

  it("全曲案の作り直しでseedとrevisionを更新し、同じ案を返さない", () => {
    const input = project()
    const before = generateFullSongArrangement(input, { seed: 90, revision: 0 })
    const after = generateFullSongArrangement(input, { seed: 91, revision: 1 })

    expect(after.plan.seed).toBe(91)
    expect(after.tracks.every((track) => track.generationRevision === 1)).toBe(true)
    expect(after.tracks.find((track) => track.id === "syn-pulse")?.notes)
      .not.toEqual(before.tracks.find((track) => track.id === "syn-pulse")?.notes)
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

  it("AI Partnerで選んだ全曲方針を説明だけでなく実際の編成へ反映する", () => {
    const input = project()
    const minimal = generateFullSongArrangement(input, {
      seed: 22,
      directive: { intention: "余白を守る", character: "minimal", energyDelta: -8 },
    })
    const cinematic = generateFullSongArrangement(input, {
      seed: 22,
      directive: { intention: "弦で頂点へ向かう", character: "cinematic", energyDelta: 8 },
    })
    const rhythmic = generateFullSongArrangement(input, {
      seed: 22,
      directive: { intention: "身体的な前進を作る", character: "rhythmic", energyDelta: 5 },
    })
    const minimalChorus = minimal.plan.sections.find((section) => section.sectionId === "chorus-1")!
    const cinematicChorus = cinematic.plan.sections.find((section) => section.sectionId === "chorus-1")!
    const rhythmicChorus = rhythmic.plan.sections.find((section) => section.sectionId === "chorus-1")!

    expect(minimalChorus.activeRoles).not.toContain("syn-pulse")
    expect(cinematicChorus.activeRoles).toContain("str-cello")
    expect(cinematicChorus.activeRoles).toContain("str-viola")
    expect(rhythmicChorus.grooveFamily).toBe("driving")
    expect(rhythmicChorus.bassStrategy).toBe("syncopated")
    expect(rhythmic.tracks.find((track) => track.id === "syn-pulse")?.notes.length).toBeGreaterThan(0)
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

  it("長い曲では導入を段階化し、真のFinalをピークとして役割を展開する", () => {
    const result = generateFullSongArrangement(longFormProject(), { seed: 20260905 })
    const intro = result.plan.sections.find((section) => section.sectionId === "intro")!
    const chorus2 = result.plan.sections.find((section) => section.sectionId === "chorus-2")!
    const final = result.plan.sections.find((section) => section.sectionId === "final")!

    expect(result.analysis.peakSectionId).toBe("final")
    expect(final.energy).toBe(100)
    expect(final.energy).toBeGreaterThan(chorus2.energy)
    expect(intro.roleEntryBeats?.["syn-bass"]).toBe(16)
    expect(intro.roleEntryBeats?.["dr-kick"]).toBe(32)
    expect(intro.roleEntryBeats?.["syn-high-glass"]).toBe(24)
    expect(final.developmentStage).toBe(2)
  })

  it("自動推定で連続分割された同一役割を、別の再登場と誤認しない", () => {
    const input = project()
    input.sourceImport = { ...input.sourceImport!, sectionsFromMarkers: false }
    input.sections = input.sections.map((section) => ({ ...section, id: `inferred:${input.projectId}:${section.id}` }))
    const oldIds = project().sections.map((section) => section.id)
    const idMap = new Map(oldIds.map((id, index) => [id, input.sections[index].id]))
    input.chords = input.chords.map((chord) => ({ ...chord, sectionId: idMap.get(chord.sectionId)! }))
    const analysis = analyzeFullSongArrangement(input)
    const chorus1 = analysis.sections.find((section) => section.sectionName === "Chorus 1")!
    const chorus2 = analysis.sections.find((section) => section.sectionName === "Chorus 2")!

    expect(chorus1.occurrence).toBe(1)
    expect(chorus2.occurrence).toBe(1)
    expect(chorus2.semanticSegmentIndex).toBe(1)
  })

  it("1小節ループではなく役割別フレーズを生成し、全曲品質を検証する", () => {
    const result = generateFullSongArrangement(longFormProject(), { seed: 81 })
    const notesFor = (trackId: string, sectionId?: string) => result.tracks
      .find((track) => track.id === trackId)?.notes.filter((note) => !sectionId || note.sectionId === sectionId) ?? []
    const sectionDensity = (sectionId: string) => result.tracks.reduce(
      (sum, track) => sum + track.notes.filter((note) => note.sectionId === sectionId).length,
      0,
    )

    expect(notesFor("syn-bass").length).toBeGreaterThan(30)
    expect(notesFor("syn-stabs").length).toBeGreaterThan(10)
    expect(notesFor("str-cello").length).toBeGreaterThan(20)
    expect(sectionDensity("final")).toBeGreaterThan(sectionDensity("breakdown"))
    expect(result.plan.sections.filter((section) => section.activeRoles.includes("syn-high-glass")).length).toBeLessThanOrEqual(4)
    expect(result.plan.sections.every((section) => section.activeRoles.length <= 16)).toBe(true)
    expect(result.quality?.metrics.peakIsLate).toBe(true)
    expect(result.quality?.metrics.densityContrastRatio).toBeGreaterThan(1.8)
    expect(result.quality?.passed).toBe(true)
  })

  it("単一の決め打ち案ではなく8つの実音候補を比較して品質下限から選抜する", () => {
    const result = generateFullSongArrangement(longFormProject(), { seed: 8101 })
    const selection = result.selection!

    expect(selection.poolSize).toBe(8)
    expect(selection.eligibleCount).toBeGreaterThan(0)
    expect(selection.candidates.filter((candidate) => candidate.selected)).toHaveLength(1)
    expect(new Set(selection.candidates.map((candidate) => candidate.approach)).size).toBe(5)
    expect(new Set(selection.candidates.map((candidate) => candidate.originalityScore)).size).toBeGreaterThan(1)
    expect(result.plan.candidateSeed).toBe(selection.selectedSeed)
    expect(result.quality!.score).toBeGreaterThanOrEqual(selection.qualityFloor)
    expect(result.quality!.metrics.harmonicViolationCount).toBe(0)
    expect(result.quality!.metrics.melodyCollisionCount).toBe(0)
  })

  it("同じseedでは候補選抜と全実音が再現し、別seedでは異なる解釈を生成する", () => {
    const input = longFormProject()
    const first = generateFullSongArrangement(input, { seed: 9012, brief: "主旋律を守り、後半で開く" })
    const repeated = generateFullSongArrangement(input, { seed: 9012, brief: "主旋律を守り、後半で開く" })
    const changed = generateFullSongArrangement(input, { seed: 9013, brief: "主旋律を守り、後半で開く" })

    expect(repeated.selection).toEqual(first.selection)
    expect(repeated.tracks).toEqual(first.tracks)
    expect(changed.tracks).not.toEqual(first.tracks)
  })

  it("Safe系の全音程を発音時点のコードトーンまたは明示テンション内へ保つ", () => {
    const input = longFormProject()
    const result = generateFullSongArrangement(input, { seed: 20260905 })
    const harmonicTrackIds = new Set(["syn-bass", "syn-pulse", "syn-stabs", "syn-dark-pad", "str-cello", "str-viola", "str-violin-1"])
    const violations: string[] = []

    result.tracks.filter((track) => harmonicTrackIds.has(track.id)).forEach((track) => {
      track.notes.filter((note) => note.character === "safe").forEach((note) => {
        const section = input.sections.find((item) => item.id === note.sectionId)!
        const localBeat = note.startBeat - (section.startBar - 1) * 4
        const chord = input.chords.filter((item) => item.sectionId === section.id)
          .find((item) => localBeat >= item.startBeat && localBeat < item.startBeat + item.durationBeats)
        const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
        if (!parsed) return
        const allowed = new Set([...parsed.tones, ...parsed.tensions].map((tone) => tone.pitchClass))
        if (!allowed.has(((note.pitch % 12) + 12) % 12)) violations.push(`${track.id}:${note.startBeat}:${note.pitch}`)
      })
    })

    expect(violations).toEqual([])
  })
})
