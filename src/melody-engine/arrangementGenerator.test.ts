import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES } from "@/core/arrangementGeneration"
import { parseChordSymbol } from "@/core/chord"
import {
  analyzeFullSongArrangement,
  buildFullSongArrangementPlan,
  generateFullSongArrangement,
  regenerateFullSongArrangementTarget,
  reviewGeneratedArrangement,
} from "./arrangementGenerator"
import { arrangementTrackPlacement, exportArrangementMidi, exportArrangementTrackMidi } from "@/midi/exportArrangement"

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
  it("Bassは分数コードの低音を重心にし、短い和音打撃は主旋律の持続中に置かない", () => {
    const input = project()
    input.chords = input.chords.map((chord) => chord.sectionId === "verse" && chord.startBeat < 8
      ? { ...chord, symbol: "C/E" }
      : chord)
    const result = generateFullSongArrangement(input, {
      seed: 7351,
      brief: "",
      directive: { intention: "旋律と伴奏の配置を確認", add: ["syn-bass", "syn-stabs"] },
    })
    const verseStart = 16
    const bass = result.tracks.find((track) => track.id === "syn-bass")!.notes
      .filter((note) => note.sectionId === "verse" && note.startBeat >= verseStart && note.startBeat < verseStart + 8)
    expect(bass.some((note) => note.pitch % 12 === 4)).toBe(true)
    const lead = input.importedArrangement!.tracks[0].notes
    const stabs = result.tracks.find((track) => track.id === "syn-stabs")!.notes
      .filter((note) => note.sectionId === "verse")
    expect(stabs.every((stab) => lead.every((note) =>
      note[0] >= stab.startBeat + 0.25 || note[0] + note[1] <= stab.startBeat,
    ))).toBe(true)
  })

  it("和音を打撃として使う反復リフ指定をイントロの独立Stabsへ実音化する", () => {
    const result = generateFullSongArrangement(project(), {
      seed: 7351,
      brief: "イントロで和音を短い打撃として使う反復したリフを生成",
      directive: {
        intention: "イントロで和音を短い打撃として使う反復したリフを生成",
        add: ["syn-stabs"],
      },
    })
    const notes = result.tracks
      .find((track) => track.id === "syn-stabs")
      ?.notes.filter((note) => note.sectionId === "intro") ?? []
    expect(notes.length).toBeGreaterThanOrEqual(30)
    expect(notes.every((note) => note.durationBeats <= 0.25)).toBe(true)
    expect(notes.every((note) => note.reason.includes("反復") && note.reason.includes("和音"))).toBe(true)
    const attackCounts = new Map<number, number>()
    for (const note of notes) {
      const attack = Math.round(note.startBeat * 4) / 4
      attackCounts.set(attack, (attackCounts.get(attack) ?? 0) + 1)
    }
    expect([...attackCounts.values()].filter((count) => count >= 3).length).toBeGreaterThanOrEqual(8)
  })

  it("和音リフ以外の自然文指定も、対象Sectionと演奏内容を変えて実音化する", () => {
    const result = generateFullSongArrangement(project(), {
      seed: 7352,
      brief: "イントロで高い単音を少しずつ変えながら8分音符で反復する",
    })
    const pulse = result.tracks.find((track) => track.id === "syn-pulse")
    const introNotes = pulse?.notes.filter((note) => note.sectionId === "intro") ?? []
    const nonIntroNotes = pulse?.notes.filter((note) => note.sectionId !== "intro") ?? []
    expect(introNotes.length).toBeGreaterThanOrEqual(16)
    expect(Math.min(...introNotes.map((note) => note.pitch))).toBeGreaterThanOrEqual(66)
    expect(introNotes.every((note) => note.reason.startsWith("指定を実音化"))).toBe(true)
    expect(nonIntroNotes.every((note) => !note.reason.startsWith("指定を実音化"))).toBe(true)
  })

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
    expect(chorus2.activeRoles.length - chorus1.activeRoles.length).toBeLessThanOrEqual(1)
    expect(chorus2.activeRoles).not.toContain("str-violin-1")
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

  it("Section末尾に主旋律が続く場合は途中の休符が多くてもTransitionを置かない", () => {
    const input = project()
    const preStart = (input.sections.find((section) => section.id === "pre")!.startBar - 1) * 4
    const lead = input.importedArrangement!.tracks[0].notes
    const last = lead.find((note) => note[0] === preStart + 14)!
    last[1] = 2
    const result = generateFullSongArrangement(input, { seed: 44, brief: "意外性のあるセクション間フレーズ" })
    const pre = result.plan.sections.find((section) => section.sectionId === "pre")!
    expect(pre.transitionCandidates.every((candidate) => candidate.notes.length === 0)).toBe(true)
    expect(pre.selectedTransitionCharacter).toBe("silence")
    expect(result.tracks.find((track) => track.id === "syn-transition-phrase")?.notes.some((note) => note.sectionId === "pre")).not.toBe(true)
  })

  it("背景パッドは各声部の大跳躍を避け、和声の色だけを動かす", () => {
    const result = generateFullSongArrangement(project(), { seed: 44, brief: "意外性のあるセクション間フレーズ" })
    const notes = result.tracks.find((track) => track.id === "syn-dark-pad")!.notes
      .filter((note) => note.sectionId === "chorus-1")
    expect(notes).toHaveLength(12)
    const largestVoiceLeap = Math.max(...notes.map((note, index) =>
      index >= 3 ? Math.abs(note.pitch - notes[index - 3].pitch) : 0))
    expect(largestVoiceLeap).toBeLessThanOrEqual(9)
    for (let index = 0; index < notes.length; index += 3) {
      expect(notes[index].pitch).toBeLessThan(notes[index + 1].pitch)
      expect(notes[index + 1].pitch).toBeLessThan(notes[index + 2].pitch)
    }
  })

  it("候補評価は背景声部の不要な大跳躍を検出する", () => {
    const input = project()
    const result = generateFullSongArrangement(input, { seed: 44 })
    const before = reviewGeneratedArrangement(result, input)
    const pad = result.tracks.find((track) => track.id === "syn-dark-pad")!
    const note = pad.notes.find((item) => item.sectionId === "chorus-1")!
    note.pitch += 12
    const after = reviewGeneratedArrangement(result, input)
    expect(after.metrics.largeSupportLeapCount).toBeGreaterThan(before.metrics.largeSupportLeapCount)
    expect(after.score).toBeLessThan(before.score)
  })

  it("Kick/Fillは主旋律アタックを避け、拍頭の土台は保つ", () => {
    const input = project()
    const result = generateFullSongArrangement(input, { seed: 44 })
    const attacks = input.importedArrangement!.tracks[0].notes.map((note) => note[0])
    const drums = result.tracks.filter((track) => ["dr-kick", "dr-field-drum", "dr-low-tom", "dr-high-tom"].includes(track.id))
    const secondary = drums.flatMap((track) => track.notes.filter((note) => {
      const source = input.sections.find((section) => section.id === note.sectionId)!
      return track.id !== "dr-kick" || (note.startBeat - (source.startBar - 1) * 4) % 4 !== 0
    }))
    expect(secondary.every((note) => attacks.every((beat) => Math.abs(beat - note.startBeat) > 0.12))).toBe(true)
    expect(result.tracks.find((track) => track.id === "dr-kick")!.notes.some((note) => note.sectionId === "chorus-1")).toBe(true)
    expect(result.quality!.metrics.rhythmLeadAttackConflictCount).toBe(0)
  })

  it("歌が密な小節ではBass補助音とHatを引き、ルートの重心を残す", () => {
    const sparse = project()
    const dense = project()
    const verseStart = (dense.sections.find((section) => section.id === "verse")!.startBar - 1) * 4
    dense.importedArrangement!.tracks[0].notes = dense.importedArrangement!.tracks[0].notes
      .filter((note) => note[0] < verseStart || note[0] >= verseStart + 16)
      .concat(Array.from({ length: 16 }, (_, index) => [verseStart + index, 1, 69 + index % 3, 82, 0] as [number, number, number, number, number]))
    const directive = { intention: "旋律の呼吸を守る", character: "rhythmic" as const }
    const before = generateFullSongArrangement(sparse, { seed: 44, directive })
    const after = generateFullSongArrangement(dense, { seed: 44, directive })
    const notesFor = (result: typeof before, trackId: string) => result.tracks.find((track) => track.id === trackId)?.notes.filter((note) => note.sectionId === "verse") ?? []
    expect(notesFor(after, "syn-bass").length).toBeLessThan(notesFor(before, "syn-bass").length)
    expect(notesFor(after, "syn-bass")).toHaveLength(4)
    expect(notesFor(after, "dr-closed-hat").length).toBeLessThan(notesFor(before, "dr-closed-hat").length)
  })

  it("疎なSectionでは共通音の低音ペダルで和声を変え、明示分数ベースを優先する", () => {
    const input = project()
    const result = generateFullSongArrangement(input, { seed: 44 })
    expect(result.plan.sections.find((section) => section.sectionId === "intro")!.bassStrategy).toBe("sustain")
    const introBass = result.tracks.find((track) => track.id === "syn-bass")!.notes.filter((note) => note.sectionId === "intro")
    expect(introBass.length).toBeGreaterThan(0)
    expect(introBass.every((note) => note.pitch % 12 === 4)).toBe(true)
    input.chords.filter((chord) => chord.sectionId === "intro").forEach((chord) => { chord.bass = "C" })
    const withExplicitBass = generateFullSongArrangement(input, { seed: 44 })
    const directedBass = withExplicitBass.tracks.find((track) => track.id === "syn-bass")!.notes.filter((note) => note.sectionId === "intro")
    expect(directedBass.length).toBeGreaterThan(0)
    expect(directedBass.every((note) => note.pitch % 12 === 0)).toBe(true)
  })

  it("同じ境界にPhraseとDecorationを重ねず、明示的な音色指定は尊重する", () => {
    const input = project()
    const analysis = analyzeFullSongArrangement(input)
    const directive = { sectionId: "intro", intention: "境界を一箇所だけ変える", character: "dark-experimental" as const }
    const plan = buildFullSongArrangementPlan(input, analysis, 44, "", directive, "motif-led")
    const intro = plan.sections.find((section) => section.sectionId === "intro")!
    expect(intro.activeRoles).toContain("syn-transition-phrase")
    expect(intro.activeRoles).not.toContain("syn-high-glass")
    expect(intro.selectedDecorationCharacter).toBe("silence")
    const explicit = buildFullSongArrangementPlan(input, analysis, 44, "", { ...directive, add: ["syn-high-glass"] }, "motif-led")
    expect(explicit.sections.find((section) => section.sectionId === "intro")!.activeRoles).toContain("syn-high-glass")
  })

  it("候補評価は主旋律に重なる余分なKickを減点する", () => {
    const input = project()
    const result = generateFullSongArrangement(input, { seed: 44 })
    const before = reviewGeneratedArrangement(result, input)
    const kick = result.tracks.find((track) => track.id === "dr-kick")!
    const source = kick.notes.find((note) => note.sectionId === "verse")!
    kick.notes.push({ ...source, id: "unneeded-kick", startBeat: 18 })
    const after = reviewGeneratedArrangement(result, input)
    expect(after.metrics.rhythmLeadAttackConflictCount).toBe(before.metrics.rhythmLeadAttackConflictCount + 1)
    expect(after.score).toBeLessThan(before.score)
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
    input.phraseCandidates = [{
      id: "adopted-phrase",
      sectionId: "intro",
      batchId: "phrase-batch",
      name: "Phrase 1",
      seed: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "phrase-note", pitch: 76, startBeat: 1, durationBeats: 0.5, velocity: 78, locks: [] }],
      intent: {
        lengthBars: 2,
        contour: "arch",
        rhythmCharacter: "flowing",
        harmonicApproach: "chord-anchored",
        cadence: "resolved",
        density: 0.5,
        restRatio: 0.3,
        leapAmount: 0.2,
        climaxPosition: 0.7,
        pickupBeats: 0,
        motifIntervals: [2, -1],
        motifDurations: [0.5, 0.5],
      },
      phraseLengthBeats: 8,
      qualityScore: 80,
      selectionScore: 0.8,
      similarityToSelected: [],
    }]
    input.sectionPhraseAssignments = { intro: "adopted-phrase" }
    const result = generateFullSongArrangement(input, { seed: 55 })
    const all = new TextDecoder().decode(exportArrangementMidi(input, result))
    const bass = new TextDecoder().decode(exportArrangementTrackMidi(input, result, "syn-bass"))

    expect(all).toContain("DR_Kick")
    expect(all).toContain("SYN_Bass")
    expect(all).toContain("STR_Violin1")
    expect(all).toContain("Selected Phrases")
    expect(bass).toContain("SYN_Bass")
    expect(bass).not.toContain("DR_Kick")
    expect(bass).not.toContain("Selected Phrases")
  })

  it("個別MIDIは1小節目へ配置し、最初に鳴る小節を案内できる", () => {
    const input = project()
    const track = {
      id: "syn-high-glass",
      name: "SYN_HighGlass",
      family: "synth",
      muted: false,
      generationRevision: 0,
      purpose: "高域の反射",
      notes: [{
        id: "glass",
        sectionId: "pre",
        pitch: 81,
        startBeat: 34,
        durationBeats: 2,
        velocity: 64,
        character: "safe",
        reason: "試験",
        locks: [],
      }],
    } satisfies NonNullable<ComposerProject["fullSongArrangement"]>["tracks"][number]

    expect(arrangementTrackPlacement(input, track)).toEqual({
      importBar: 1,
      firstSoundingBar: 9,
      lastSoundingBar: 9,
    })
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

  it("全曲の各生成トラックへSection別の演奏表情を適用し、そのままMIDI対象へ保持する", () => {
    const result = generateFullSongArrangement(longFormProject(), { seed: 8102 })
    const soundingTracks = result.tracks.filter((track) => track.notes.length > 0)

    expect(soundingTracks.every((track) => track.performance?.applied)).toBe(true)
    expect(soundingTracks.some((track) => (track.performance?.changedVelocityCount ?? 0) > 0)).toBe(true)
    expect(soundingTracks.some((track) => (track.performance?.changedDurationCount ?? 0) > 0)).toBe(true)
    expect(soundingTracks.some((track) => (track.performance?.changedOnsetCount ?? 0) > 0)).toBe(true)
    expect(new Set(result.tracks.find((track) => track.id === "dr-closed-hat")?.notes.map((note) => note.velocity)).size).toBeGreaterThan(2)
    expect(result.tracks.find((track) => track.id === "syn-dark-pad")?.performance?.sectionPlans.some((section) => section.articulation === "sustained")).toBe(true)
    expect(result.tracks.find((track) => track.id === "syn-transition-phrase")?.performance?.sectionPlans.every((section) => section.timing === "slightly-ahead")).toBe(true)
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

  it("完全無音に指定した小節では全生成トラックの持続音も止める", () => {
    const result = generateFullSongArrangement(project(), {
      seed: 404,
      directive: {
        intention: "25〜28小節は完全無音",
        timelineConstraints: {
          preserveMelody: true,
          fullSilenceRanges: [{ startBar: 25, endBar: 28 }],
          melodySilenceRanges: [],
        },
      },
    })
    const silenceStartBeat = 24 * 4
    const silenceEndBeat = 28 * 4
    const overlaps = result.tracks.flatMap((track) => track.notes.filter((note) =>
      note.startBeat < silenceEndBeat && note.startBeat + note.durationBeats > silenceStartBeat,
    ))
    expect(overlaps).toEqual([])
    expect(result.plan.directive?.timelineConstraints?.fullSilenceRanges).toEqual([
      { startBar: 25, endBar: 28 },
    ])
  })

  it("同一のコード・歌メロ・Tempo・SectionでGenreだけを変えるとBassとRhythmの実音MIDIが変わる", () => {
    const input = project()
    const slow = { ...input, song: { ...input.song, genreBlend: [{ id: "sadcore-slowcore" as const, weight: 1 }] } }
    const energetic = { ...input, song: { ...input.song, genreBlend: [{ id: "hi-nrg" as const, weight: 1 }] } }
    const quietResult = generateFullSongArrangement(slow, { seed: 7462 })
    const activeResult = generateFullSongArrangement(energetic, { seed: 7462 })
    const count = (result: typeof quietResult, id: string, sectionId: string) => result.tracks
      .find((track) => track.id === id)?.notes.filter((note) => note.sectionId === sectionId).length ?? 0
    expect(count(activeResult, "syn-bass", "verse")).toBeGreaterThan(count(quietResult, "syn-bass", "verse"))
    expect(count(activeResult, "dr-closed-hat", "verse")).toBeGreaterThan(count(quietResult, "dr-closed-hat", "verse"))
    expect(activeResult.plan.sections.find((section) => section.sectionId === "verse")?.grooveFamily)
      .not.toBe(quietResult.plan.sections.find((section) => section.sectionId === "verse")?.grooveFamily)
    expect(exportArrangementMidi(energetic, activeResult)).not.toEqual(exportArrangementMidi(slow, quietResult))
  })

  it("Aestheticだけを変えると既存後景音の距離と余韻が変わり、パートを機械的に増やさない", () => {
    const input = project()
    const distant = { ...input, song: { ...input.song, aesthetic: { image: "atmospheric-depth" as const, amount: 1 } } }
    const baseline = generateFullSongArrangement(input, { seed: 7462 })
    const imageResult = generateFullSongArrangement(distant, { seed: 7462 })
    const baselinePad = baseline.tracks.find((track) => track.id === "syn-dark-pad")?.notes[0]
    const distantPad = imageResult.tracks.find((track) => track.id === "syn-dark-pad")?.notes[0]
    expect(baselinePad).toBeDefined()
    expect(distantPad).toBeDefined()
    expect(distantPad!.soundImage?.depth).toBeGreaterThan(baselinePad!.soundImage?.depth ?? 0)
    expect(distantPad!.soundImage?.decay).toBeGreaterThan(baselinePad!.soundImage?.decay ?? 0)
    expect(distantPad!.velocity).toBeLessThan(baselinePad!.velocity)
    expect(distantPad!.durationBeats).toBeGreaterThan(baselinePad!.durationBeats)
    expect(imageResult.tracks.length).toBeLessThanOrEqual(baseline.tracks.length)
    expect(exportArrangementMidi(distant, imageResult)).not.toEqual(exportArrangementMidi(input, baseline))
  })
})
