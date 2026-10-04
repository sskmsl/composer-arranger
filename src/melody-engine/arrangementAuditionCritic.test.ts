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
})
