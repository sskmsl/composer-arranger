import { describe, expect, it } from "vitest"
import type { ArrangementPlan, ArrangementTrackId, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { evaluateArrangementAudition, refineArrangementByAudition } from "./arrangementAuditionCritic"

function project(): ComposerProject {
  const base = createEmptyProject("Audition Critic")
  return {
    ...base,
    sections: [{ id: "chorus", name: "Chorus", role: "chorus", startBar: 1, lengthBars: 4 }],
    chords: [{ id: "chord", sectionId: "chorus", startBeat: 0, durationBeats: 16, symbol: "Am", bass: null }],
    sourceImport: {
      type: "midi", sourceKind: "external-song", fileName: "critic.mid", importedAt: "2026-10-04T00:00:00.000Z",
      format: 1, ppq: 480, trackCount: 1, melodyTrackName: "Lead", melodyTrackConfidence: 1,
      chordInferenceConfidence: 1, sectionsFromMarkers: true, warnings: [],
    },
    importedArrangement: {
      version: "1.0.0", sourceKind: "external-song", totalBeats: 16,
      tracks: [{ sourceTrackIndex: 0, name: "Lead", role: "melody", notes: [
        [0, 2, 69, 92, 0], [4, 2, 72, 92, 0], [8, 2, 69, 92, 0], [12, 2, 72, 92, 0],
      ] }],
    },
  }
}

function plan(): ArrangementPlan {
  return {
    version: "1.0.0", brief: "", seed: 1, candidateApproach: "counterpoint-led",
    sections: [{
      sectionId: "chorus", sectionName: "Chorus", sectionRole: "chorus", semanticRole: "chorus",
      energy: 78, density: "medium-high", register: { low: "medium", mid: "strong", high: "medium" },
      intention: "主旋律を前に残す", activeRoles: [], transitionCandidates: [], selectedTransitionCharacter: "silence",
      decorationCandidates: [], selectedDecorationCharacter: "silence", sectionShape: "statement", motifTreatment: "none",
    }],
  }
}

const IDS: ArrangementTrackId[] = [
  "syn-pulse", "syn-stabs", "syn-high-glass", "syn-transition-phrase", "str-viola",
  "str-violin-2", "str-violin-1", "syn-arp-high", "syn-chord-wide", "str-high-octave",
]

function crowdedTracks(): GeneratedArrangementTrack[] {
  return IDS.map((id, trackIndex) => ({
    id,
    name: id,
    family: id.startsWith("str-") ? "strings" : id === "syn-transition-phrase" ? "transition" : "synth",
    muted: false,
    generationRevision: 0,
    purpose: "test",
    notes: [0, 4, 8, 12].map((startBeat, noteIndex) => ({
      id: `${id}:${noteIndex}`, sectionId: "chorus", startBeat, durationBeats: 1.5,
      pitch: 69 + trackIndex % 3, velocity: 92, locks: [], character: "safe", reason: "test",
    })),
  }))
}

describe("Arrangement Audition Critic", () => {
  it("主旋律を覆う同時発音を検出し、音域と音量を反復修正して再採点する", () => {
    const input = project()
    const arrangementPlan = plan()
    const source = crowdedTracks()
    const before = evaluateArrangementAudition(input, arrangementPlan, source)
    const refined = refineArrangementByAudition(input, arrangementPlan, source)

    expect(before.melodicClarity).toBeLessThan(50)
    expect(refined.report.score).toBeGreaterThan(before.score)
    expect(refined.report.repairPasses).toBeGreaterThan(0)
    expect(refined.report.shiftedNotes + refined.report.velocityAdjustments).toBeGreaterThan(0)
    expect(refined.tracks).not.toEqual(source)
    expect(input.importedArrangement?.tracks[0].notes).toEqual([
      [0, 2, 69, 92, 0], [4, 2, 72, 92, 0], [8, 2, 69, 92, 0], [12, 2, 72, 92, 0],
    ])
  })

  it("実際の再生と同じ主旋律開始位置を使い、休止中の補助音を避けない", () => {
    const input = project()
    const arrangementPlan = {
      ...plan(),
      directive: {
        intention: "主旋律は3小節目から",
        timelineConstraints: {
          preserveMelody: true,
          fullSilenceRanges: [],
          melodySilenceRanges: [],
          melodyStartBar: 3,
        },
      },
    }
    const source = crowdedTracks().slice(0, 1).map((track) => ({
      ...track,
      notes: track.notes.filter((note) => note.startBeat < 8),
    }))
    const refined = refineArrangementByAudition(input, arrangementPlan, source)
    expect(refined.tracks).toEqual(source)
  })

  it("1回目のタイミング整理で生じた別の接触を2回目に検査する", () => {
    const input = project()
    const source = crowdedTracks().map((track, index) => ({
      ...track,
      notes: Array.from({ length: 12 }, (_, group) => ({
        id: `${track.id}:iterative:${group}`,
        sectionId: "chorus",
        startBeat: group === 2 ? 2 : .1 + group,
        durationBeats: index === 0 && group === 2 ? 2 : .1,
        pitch: index === 0 && group === 2 ? 69 : 60,
        velocity: 88 + index,
        locks: [],
        character: "safe" as const,
        reason: "test",
      })),
    }))
    const refined = refineArrangementByAudition(input, plan(), source)
    expect(refined.report.repairPasses).toBeGreaterThanOrEqual(2)
    expect(refined.tracks.flatMap((track) => track.notes).some((note) => (note.auditionRepair?.pass ?? 0) >= 2)).toBe(true)
  })

  it("低いVelocityでも主旋律との半音衝突を検出し、Pad層を移動または休符化する", () => {
    const source: GeneratedArrangementTrack[] = [{
      id: "syn-pad-air", name: "Pad Air", family: "synth", muted: false, generationRevision: 0, purpose: "test",
      notes: [{
        id: "quiet-clash", sectionId: "chorus", startBeat: 0, durationBeats: 2,
        pitch: 70, velocity: 24, locks: [], character: "safe", reason: "test",
      }],
    }]
    const before = evaluateArrangementAudition(project(), plan(), source)
    const refined = refineArrangementByAudition(project(), plan(), source)
    expect(before.melodicClarity).toBeLessThan(100)
    expect(refined.tracks[0].notes.every((note) => Math.abs(note.pitch - 69) > 5 || note.startBeat >= 2)).toBe(true)
  })

  it("主旋律が密でも接触が1件あれば比率で見逃さず修理する", () => {
    const input = project()
    input.importedArrangement!.tracks[0].notes = Array.from({ length: 64 }, (_, index) => [
      index * .25, .24, index === 9 ? 69 : 84, 92, 0,
    ])
    const source: GeneratedArrangementTrack[] = [{
      id: "syn-pad-air", name: "Pad Air", family: "synth", muted: false, generationRevision: 0, purpose: "test",
      notes: [{
        id: "single-clash", sectionId: "chorus", startBeat: 2.25, durationBeats: .24,
        pitch: 70, velocity: 24, locks: [], character: "safe", reason: "test",
      }],
    }]
    const before = evaluateArrangementAudition(input, plan(), source)
    const refined = refineArrangementByAudition(input, plan(), source)
    expect(before.melodicClarity).toBeGreaterThan(82)
    expect(before.passed).toBe(false)
    expect(refined.report.repairPasses).toBeGreaterThan(0)
    expect(refined.tracks[0].notes).toHaveLength(0)
  })

  it("採用済み短いフレーズも保護対象に含める", () => {
    const input = project()
    input.phraseCandidates = [{
      id: "phrase", sectionId: "chorus", batchId: "batch", name: "Phrase", seed: 1,
      createdAt: "2026-10-05T00:00:00.000Z",
      notes: [{ id: "phrase-note", pitch: 80, startBeat: 2, durationBeats: 1, velocity: 80, locks: [] }],
      intent: {
        lengthBars: 2, contour: "arch", rhythmCharacter: "flowing", harmonicApproach: "chord-anchored",
        cadence: "resolved", density: .5, restRatio: .3, leapAmount: .2, climaxPosition: .7,
        pickupBeats: 0, motifIntervals: [2, -1], motifDurations: [.5, .5],
      },
      phraseLengthBeats: 8, qualityScore: 80, selectionScore: .8, similarityToSelected: [],
    }]
    input.sectionPhraseAssignments = { chorus: "phrase" }
    const source: GeneratedArrangementTrack[] = [{
      id: "syn-pad-air", name: "Pad Air", family: "synth", muted: false, generationRevision: 0, purpose: "test",
      notes: [{
        id: "phrase-clash", sectionId: "chorus", startBeat: 2, durationBeats: 1,
        pitch: 81, velocity: 20, locks: [], character: "safe", reason: "test",
      }],
    }]
    const before = evaluateArrangementAudition(input, plan(), source)
    const refined = refineArrangementByAudition(input, plan(), source)
    expect(before.melodicClarity).toBeLessThan(100)
    expect(refined.tracks).not.toEqual(source)
  })

  it("コード外のLayer音とBassに重なる低域を修理する", () => {
    const source: GeneratedArrangementTrack[] = [
      {
        id: "syn-pad-air", name: "Pad Air", family: "synth", muted: false, generationRevision: 0, purpose: "test",
        notes: [{ id: "outside", sectionId: "chorus", startBeat: 2.5, durationBeats: .5, pitch: 70, velocity: 55, locks: [], character: "safe", reason: "test" }],
      },
      {
        id: "syn-bass", name: "Bass", family: "bass", muted: false, generationRevision: 0, purpose: "test",
        notes: [{ id: "bass", sectionId: "chorus", startBeat: 2.5, durationBeats: 1, pitch: 40, velocity: 80, locks: [], character: "safe", reason: "test" }],
      },
      {
        id: "str-contrabass", name: "Contrabass", family: "strings", muted: false, generationRevision: 0, purpose: "test",
        notes: [{ id: "low", sectionId: "chorus", startBeat: 2.5, durationBeats: 1, pitch: 40, velocity: 50, locks: [], character: "safe", reason: "test" }],
      },
    ]
    const refined = refineArrangementByAudition(project(), plan(), source)
    const repairedPad = refined.tracks.find((track) => track.id === "syn-pad-air")!.notes[0]
    const lowNotes = refined.tracks.find((track) => track.id === "str-contrabass")!.notes
    expect(repairedPad.pitch % 12).not.toBe(10)
    expect(lowNotes.length === 0 || lowNotes.every((note) => note.pitch >= 52)).toBe(true)
  })

  it("一体で鳴らすKickとImpactの層をCriticが前後へずらさない", () => {
    const drum = (id: ArrangementTrackId, pitch: number): GeneratedArrangementTrack => ({
      id, name: id, family: "drums", muted: false, generationRevision: 0, purpose: "test",
      notes: [{ id: `${id}:0`, sectionId: "chorus", startBeat: 0, durationBeats: .25, pitch, velocity: 90, locks: [], character: "safe", reason: "test" }],
    })
    const source = [
      ...crowdedTracks(),
      drum("dr-kick", 36), drum("dr-kick-sub", 35), drum("dr-kick-click", 37),
      drum("dr-gran-cassa", 35), drum("dr-impact", 41),
    ]
    const refined = refineArrangementByAudition(project(), plan(), source)
    for (const id of ["dr-kick-sub", "dr-kick-click", "dr-impact"] as const) {
      expect(refined.tracks.find((track) => track.id === id)?.notes[0]?.startBeat).toBe(0)
    }
  })

  it("Criticの前後で全ドラムトラックのGM打楽器番号を変えない", () => {
    const drumIds: ArrangementTrackId[] = [
      "dr-kick", "dr-snare", "dr-closed-hat", "dr-open-hat", "dr-low-tom", "dr-high-tom",
      "dr-field-drum", "dr-gran-cassa", "dr-crash", "dr-kick-sub", "dr-kick-click", "dr-snare-body",
      "dr-clap", "dr-shaker", "dr-ride", "dr-percussion-high", "dr-cymbal-swell", "dr-impact",
    ]
    const drums = drumIds.map((id, index): GeneratedArrangementTrack => ({
      id, name: id, family: "drums", muted: false, generationRevision: 0, purpose: "test",
      notes: [{
        id: `${id}:gm`, sectionId: "chorus", startBeat: 0, durationBeats: .25,
        pitch: 35 + index, velocity: 84, locks: [], character: "safe", reason: "test",
      }],
    }))
    const source = [...crowdedTracks(), ...drums]
    const before = new Map(drums.map((track) => [track.id, track.notes.map((note) => note.pitch)]))
    const refined = refineArrangementByAudition(project(), plan(), source)
    for (const id of drumIds) {
      expect(refined.tracks.find((track) => track.id === id)?.notes.map((note) => note.pitch)).toEqual(before.get(id))
    }
  })

  it("Padの和音は1音ずつオクターブ移動せず、まとまりで時間を空ける", () => {
    const source: GeneratedArrangementTrack[] = [{
      id: "syn-dark-pad", name: "Dark Pad", family: "synth", muted: false, generationRevision: 0, purpose: "test",
      notes: [0, 4, 8].flatMap((startBeat, chordIndex) => [57, 60, chordIndex === 1 ? 72 : 64].map((pitch, voice) => ({
        id: `pad:${chordIndex}:${voice}`, sectionId: "chorus", startBeat, durationBeats: 4,
        pitch, velocity: 50, locks: [], character: "safe" as const, reason: "test",
      }))),
    }]
    const originalPitches = source[0].notes.map((note) => note.pitch)
    const refined = refineArrangementByAudition(project(), plan(), source)
    const pad = refined.tracks[0]
    expect(pad.notes.map((note) => note.pitch)).toEqual(originalPitches)
    const middleChordStarts = new Set(pad.notes.filter((note) => note.id.startsWith("pad:1:")).map((note) => note.startBeat))
    expect(middleChordStarts.size).toBeLessThanOrEqual(1)
    expect(pad.notes.some((note) => note.auditionRepair?.actions.includes("melody-space"))).toBe(true)
  })

  it("過密な補助アタックは、固定レイヤー以外の発音位置を実際に分散する", () => {
    const source = crowdedTracks().map((track, index) => ({
      ...track,
      notes: [{
        ...track.notes[0],
        id: `${track.id}:spread`,
        pitch: 88 + index % 4,
        durationBeats: .25,
      }],
    }))
    const before = evaluateArrangementAudition(project(), plan(), source)
    const refined = refineArrangementByAudition(project(), plan(), source)
    expect(refined.report.transientClarity).toBeGreaterThanOrEqual(before.transientClarity)
    expect(refined.tracks.some((track) => track.notes.some((note) => note.startBeat !== 0))).toBe(true)
  })

  it("総合点が高くてもTransient下限を割る案を合格にしない", () => {
    const ids: ArrangementTrackId[] = [
      "dr-kick", "dr-snare", "dr-closed-hat", "dr-open-hat", "dr-low-tom", "dr-high-tom",
      "dr-field-drum", "dr-gran-cassa", "dr-crash", "dr-kick-sub", "dr-kick-click", "dr-snare-body",
      "dr-clap", "dr-shaker", "dr-ride", "dr-percussion-high", "dr-cymbal-swell", "dr-impact",
      "syn-pulse", "syn-stabs", "syn-high-glass", "syn-transition-phrase", "syn-final-lift",
      "syn-dark-pad", "syn-pad-air", "syn-pad-motion", "str-viola", "str-violin-1", "str-upper",
    ]
    const dense = ids.map((id, index): GeneratedArrangementTrack => ({
      id, name: id, family: id.startsWith("dr-") ? "drums" : id === "syn-transition-phrase" ? "transition" : "synth",
      muted: false, generationRevision: 0, purpose: "test",
      notes: [{
        id: `${id}:dense`, sectionId: "chorus", startBeat: 3, durationBeats: .125,
        pitch: id.startsWith("dr-") ? 35 + index % 16 : 96 + index % 4,
        velocity: 80, locks: [], character: "safe", reason: "test",
      }],
    }))
    const highRegisterPlan: ArrangementPlan = {
      ...plan(),
      sections: plan().sections.map((section) => ({ ...section, register: { low: "open", mid: "open", high: "strong" } })),
    }
    const report = evaluateArrangementAudition(project(), highRegisterPlan, dense)
    expect(report.transientClarity).toBeLessThan(68)
    expect(report.passed).toBe(false)
  })

  it("総合点だけでなく低域・音域・強弱・Section差の各下限を必須にする", () => {
    const noLead = project()
    noLead.importedArrangement!.tracks = []
    const note = (id: string, sectionId: string, startBeat: number, pitch: number) => ({
      id, sectionId, startBeat, durationBeats: .2, pitch, velocity: 80,
      locks: [], character: "safe" as const, reason: "test",
    })
    const highPlan: ArrangementPlan = {
      ...plan(), sections: plan().sections.map((section) => ({
        ...section, register: { low: "open", mid: "open", high: "strong" },
      })),
    }
    const wrongRegister: GeneratedArrangementTrack[] = [{
      id: "syn-dark-pad", name: "Pad", family: "synth", muted: false, generationRevision: 0, purpose: "test",
      notes: [note("low", "chorus", 2, 36)],
    }]
    const registerReport = evaluateArrangementAudition(noLead, highPlan, wrongRegister)
    expect(registerReport.score).toBeGreaterThanOrEqual(78)
    expect(registerReport.registerBalance).toBeLessThan(55)
    expect(registerReport.passed).toBe(false)

    const lowIds: ArrangementTrackId[] = ["syn-bass", "str-cello", "str-contrabass", "syn-pad-motion", "dr-kick", "dr-impact"]
    const crowdedLow = lowIds.map((id, index): GeneratedArrangementTrack => ({
      id, name: id, family: id.startsWith("dr-") ? "drums" : id === "syn-bass" ? "bass" : id.startsWith("str-") ? "strings" : "synth",
      muted: false, generationRevision: 0, purpose: "test",
      notes: [note(`${id}:low`, "chorus", 2, id.startsWith("dr-") ? 35 + index : 36)],
    }))
    const lowPlan: ArrangementPlan = {
      ...plan(), sections: plan().sections.map((section) => ({
        ...section, register: { low: "strong", mid: "open", high: "open" },
      })),
    }
    const lowReport = evaluateArrangementAudition(noLead, lowPlan, crowdedLow)
    expect(lowReport.lowEndClarity).toBeLessThan(68)
    expect(lowReport.passed).toBe(false)

    const arcProject = project()
    arcProject.importedArrangement!.tracks = []
    arcProject.sections = [
      { id: "a", name: "A", role: "verse", startBar: 1, lengthBars: 1 },
      { id: "b", name: "B", role: "pre-chorus", startBar: 2, lengthBars: 1 },
      { id: "c", name: "C", role: "chorus", startBar: 3, lengthBars: 1 },
    ]
    arcProject.chords = arcProject.sections.map((section) => ({
      id: `chord:${section.id}`, sectionId: section.id, startBeat: 0, durationBeats: 4, symbol: "Am", bass: null,
    }))
    const arcPlan: ArrangementPlan = {
      ...plan(), sections: arcProject.sections.map((section, index) => ({
        ...plan().sections[0], sectionId: section.id, sectionName: section.name, sectionRole: section.role,
        semanticRole: (["verse", "pre", "chorus"] as const)[index], energy: 20 + index * 30,
      })),
    }
    const densityTrack = (counts: number[]): GeneratedArrangementTrack[] => [{
      id: "syn-dark-pad", name: "Pad", family: "synth", muted: false, generationRevision: 0, purpose: "test",
      notes: counts.flatMap((count, sectionIndex) => Array.from({ length: count }, (_, index) =>
        note(`${sectionIndex}:${index}`, arcProject.sections[sectionIndex].id, sectionIndex * 4 + index * (3.5 / Math.max(1, count)), 60))),
    }]
    const reversedArc = evaluateArrangementAudition(arcProject, arcPlan, densityTrack([12, 8, 4]))
    expect(reversedArc.dynamicArc).toBeLessThan(55)
    expect(reversedArc.passed).toBe(false)
    const weakBoundaries = evaluateArrangementAudition(arcProject, arcPlan, densityTrack([10, 11, 12]))
    expect(weakBoundaries.dynamicArc).toBeGreaterThanOrEqual(55)
    expect(weakBoundaries.sectionContrast).toBeLessThan(55)
    expect(weakBoundaries.passed).toBe(false)
  })
})
