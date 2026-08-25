import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import { buildLogicProductionPackage } from "./logicProductionPackage"

function melody(): MelodyVariant {
  return {
    id: "melody", name: "Lead", sectionId: "intro", sourceMode: "generate",
    notes: [{ id: "lead-note", pitch: 69, startBeat: 0, durationBeats: 1, velocity: 82, locks: [] }],
    phrasePlans: [], lockedBars: [], motifLocked: false, features: null,
    generatorVersion: "test", seed: 1, songProfile: "original-custom",
    parentMelodyId: null, batchId: "melody-batch", createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function counter(): ReactiveLayerCandidate {
  return {
    id: "counter", batchId: "counter-batch", sectionId: "intro",
    targetMelodyVariantId: "melody", kind: "counter", role: "answer-phrase", name: "Counter",
    notes: [{ id: "counter-note", pitch: 57, startBeat: 1.5, durationBeats: 0.5, velocity: 65, locks: [] }],
    seed: 2,
    quality: { melodyRespect: 100, harmonicFit: 90, gapUsage: 100, registerSeparation: 90, motifRelationship: 75, sectionFit: 90, transitionValue: 70, overallQuality: 91 },
    collisions: { samePitchOverlapBeats: 0, minorSecondOverlapBeats: 0, protectedMomentOverlapBeats: 0, voiceCrossingCount: 0, simultaneousAttackCount: 0, hasBlockingCollision: false },
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function project() {
  const value = createEmptyProject("Logic Package")
  value.song.tempo = 108
  value.sections = [{ id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 2 }]
  value.chords = [
    { id: "c1", sectionId: "intro", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
    { id: "c2", sectionId: "intro", startBeat: 4, durationBeats: 4, symbol: "Fmaj7", bass: null },
  ]
  value.melodyVariants = [melody()]
  value.sectionMelodyAssignments = { intro: "melody" }
  value.reactiveLayerCandidates = [counter()]
  value.sectionReactiveLayerAssignments = { intro: "counter" }
  return value
}

describe("Logic Pro Production Package", () => {
  it("Bass・Chord・Melody・Counterを独立したType 1トラックへ書き出す", () => {
    const result = buildLogicProductionPackage(project(), "controlled-escalation")
    const text = new TextDecoder().decode(result.midi)
    expect(text.slice(0, 4)).toBe("MThd")
    expect(text).toContain("01 Bass Guide")
    expect(text).toContain("02 Chord Guide")
    expect(text).toContain("03 Active Melody")
    expect(text).toContain("06 Counter")
    expect(text).not.toContain("07 Decoration and Transition")
  })

  it("曲頭基準の小節数・テンポ・DirectionをProduction Guideへ保持する", () => {
    const result = buildLogicProductionPackage(project(), "motif-relay")
    expect(result.totalBars).toBe(2)
    expect(result.guideMarkdown).toContain("Tempo: 108 BPM")
    expect(result.guideMarkdown).toContain("Motif受け渡しMulti-Part Package")
    expect(result.guideMarkdown).toContain("## Section Role Matrix")
    expect(result.guideMarkdown).toContain("## Quality Gate")
  })

  it("所有ライブラリだけから音源候補を提示する", () => {
    const result = buildLogicProductionPackage(project(), "preserve-space")
    const libraries = new Set(result.tracks.flatMap((track) =>
      track.recommendations.map((recommendation) => recommendation.library),
    ))
    expect(libraries).toEqual(new Set([
      "Native Instruments Komplete 15 Ultimate",
      "u-he Repro",
    ]))
    expect(result.tracks.find((track) => track.id === "bass-guide")?.recommendations[0].product).toBe("Repro-1")
  })

  it("未生成Roleを空トラックとしてMIDIへ混入せず、Guide上は可視化する", () => {
    const result = buildLogicProductionPackage(project(), "controlled-escalation")
    const decoration = result.tracks.find((track) => track.id === "decoration")
    expect(decoration?.status).toBe("empty")
    expect(decoration?.noteCount).toBe(0)
    expect(result.guideMarkdown).toContain("### 07 Decoration and Transition")
  })
})
