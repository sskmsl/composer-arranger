import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyVariant } from "@/core/melody"
import { createEmptyProject } from "@/core/project"
import { aiContextFingerprint, buildAiArrangementContext } from "./context"

function activeMelody(): MelodyVariant {
  return {
    id: "melody-1",
    name: "Active",
    sectionId: "intro",
    sourceMode: "generate",
    notes: [
      { id: "n1", startBeat: 0.5, durationBeats: 1.5, pitch: 69, velocity: 78, locks: [] },
      { id: "n2", startBeat: 2.5, durationBeats: 0.5, pitch: 72, velocity: 82, locks: [] },
      { id: "n3", startBeat: 4, durationBeats: 2, pitch: 71, velocity: 76, locks: [] },
    ],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 7,
    songProfile: "minimal-tension",
    parentMelodyId: null,
    batchId: "batch-1",
    createdAt: "2026-08-18T00:00:00.000Z",
  }
}

function project() {
  const project = createEmptyProject("AI context")
  project.song.songProfile = "minimal-tension"
  project.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
    { id: "verse", name: "Verse", role: "verse", startBar: 5, lengthBars: 4 },
  ]
  project.chords = parseChordInputText("Am(add9) | Fmaj7 | C | E7", "intro", 4, "chord")
  project.melodyVariants = [activeMelody()]
  project.sectionMelodyAssignments = { intro: "melody-1" }
  project.sectionAccompanimentPatternAssignments = { intro: "pattern-1" }
  return project
}

describe("AI Arrangement context", () => {
  it("Genreブレンドと独立したSound ImageをAI Partnerへ同時に渡す", () => {
    const value = project()
    value.song.genreBlend = [
      { id: "trip-hop", weight: .65 },
      { id: "romantic-dark", weight: .35 },
    ]
    value.song.aesthetic = { image: "atmospheric-depth", amount: 1 }
    const context = buildAiArrangementContext(value, "intro")
    expect(context?.project.musicContext?.genres).toEqual(value.song.genreBlend)
    expect(context?.project.musicContext?.genre.syncopation).toBeGreaterThan(.5)
    expect(context?.project.musicContext?.aesthetic.depth).toBeGreaterThan(.5)
  })
  it("曲全体相談では全Sectionのコード・Melody・役割を一度に渡す", () => {
    const context = buildAiArrangementContext(project(), "intro", "whole-song")
    expect(context?.consultationScope).toBe("whole-song")
    expect(context?.songSections).toEqual([
      expect.objectContaining({
        id: "intro",
        order: 0,
        chords: ["Am(add9)", "Fmaj7", "C", "E7"],
        activeMelody: expect.objectContaining({ present: true, noteCount: 3 }),
        activeLayers: expect.arrayContaining(["melody", "accompaniment"]),
      }),
      expect.objectContaining({
        id: "verse",
        order: 1,
        chords: [],
        activeMelody: expect.objectContaining({ present: false }),
      }),
    ])
  })

  it("全曲で確定した世界観とDirectionをSection相談にも渡す", () => {
    const value = project()
    value.arrangementDirectorWorkspace = {
      brief: "Aメロは近く、サビで空間を開く。主旋律は変えない。",
      selectedDirectionId: "controlled-escalation",
    }
    expect(buildAiArrangementContext(value, "intro")?.project.arrangementIntent).toEqual({
      brief: "Aメロは近く、サビで空間を開く。主旋律は変えない。",
      selectedDirectionId: "controlled-escalation",
    })
  })

  it("MIDIインポートの推定信頼度と注意点をAIへ渡す", () => {
    const imported = createEmptyProject("Imported")
    const sectionId = "section-imported"
    imported.sections = [{ id: sectionId, name: "Imported", role: "instrumental", startBar: 1, lengthBars: 4 }]
    imported.sourceImport = {
      type: "midi",
      fileName: "song.mid",
      importedAt: "2026-08-20T00:00:00.000Z",
      format: 1,
      ppq: 480,
      trackCount: 4,
      melodyTrackName: "Lead",
      melodyTrackConfidence: 0.82,
      chordInferenceConfidence: 0.66,
      sectionsFromMarkers: false,
      reviewConfirmed: false,
      warnings: ["セクションは推定です。"],
    }
    imported.importedArrangement = {
      version: "1.0.0",
      sourceKind: "external-song",
      totalBeats: 16,
      tracks: [{
        sourceTrackIndex: 1,
        name: "Bass",
        role: "bass",
        notes: [[0, 2, 40, 72, 1]],
      }],
    }
    const context = buildAiArrangementContext(imported, sectionId)
    expect(context?.project.sourceImport).toEqual({
      type: "midi",
      sourceKind: "external-song",
      fileName: "song.mid",
      melodyTrackName: "Lead",
      melodyTrackConfidence: 0.82,
      chordInferenceConfidence: 0.66,
      sectionsFromMarkers: false,
      reviewConfirmed: false,
      warnings: ["セクションは推定です。"],
    })
    expect(context?.importedArrangement).toMatchObject({
      sourceKind: "external-song",
      totalNotes: 1,
      activeRoles: ["bass"],
      textureDensity: "sparse",
    })
    expect(context?.sourceProtection).toEqual({
      source: "imported-midi",
      preserveChords: true,
      preserveMelody: true,
      generationTargets: ["Accompaniment", "Counter", "Decoration", "Signature Phrase", "Transition"],
      instructions: [
        "現在のコード進行を変更しない",
        "採用中の主旋律ノートの音程・位置・長さを変更しない",
        "無音小節や登場位置の指定は、主旋律を消去せず再生範囲として適用する",
        "提案と実音生成は独立した補助パートだけを対象にする",
      ],
    })
  })

  it("コードから生成して採用した主旋律も保護対象としてAIへ渡す", () => {
    expect(buildAiArrangementContext(project(), "intro")?.sourceProtection).toMatchObject({
      source: "active-melody",
      preserveChords: true,
      preserveMelody: true,
    })
  })

  it("コード・Active Melody・Section関係を個人情報を増やさず圧縮する", () => {
    const context = buildAiArrangementContext(project(), "intro")
    expect(context).not.toBeNull()
    expect(context?.arrangementConstitution).toMatchObject({
      version: "1.0.0",
      principles: expect.arrayContaining([
        expect.objectContaining({ id: "melody-sovereignty" }),
        expect.objectContaining({ id: "meaningful-silence" }),
        expect.objectContaining({ id: "delayed-payoff" }),
      ]),
    })
    expect(context?.arrangementDirector).toMatchObject({
      version: "1.0.0",
      climaxSectionId: null,
      sections: expect.arrayContaining([
        expect.objectContaining({ sectionId: "intro", climaxPolicy: "reserve" }),
      ]),
    })
    expect(context?.arrangementReview).toMatchObject({
      version: "1.0.0",
      sectionId: "intro",
      status: "strong",
    })
    expect(context?.wholeSongArrangementReview).toMatchObject({
      version: "1.0.0",
      metrics: expect.objectContaining({ pendingSectionCount: 1 }),
    })
    expect(context?.orchestration).toMatchObject({
      version: "1.0.0",
      sections: expect.arrayContaining([
        expect.objectContaining({ sectionId: "intro" }),
      ]),
    })
    expect(context?.orchestrationReview).toMatchObject({
      version: "1.0.0",
      sectionId: "intro",
      status: expect.stringMatching(/strong|watch|revise/),
    })
    expect(context?.audibleLayerReview).toMatchObject({
      version: "1.0.0",
      sectionId: "intro",
      status: "strong",
      score: 100,
    })
    expect(context?.section).toMatchObject({
      role: "intro",
      previousRole: null,
      nextRole: "verse",
    })
    expect(context?.chords).toHaveLength(4)
    expect(context?.activeMelody.present).toBe(true)
    expect(context?.activeMelody.noteCount).toBe(3)
    expect(context?.activeMelody.features?.restRatio).toBeGreaterThan(0)
    expect(context?.arrangement.accompanimentPatternAssigned).toBe(true)
    expect(context?.arrangement.assignedAccompanimentPatternId).toBe("pattern-1")
    expect(context?.arrangement.availableAccompanimentPatterns).toContainEqual(
      expect.objectContaining({ id: "syncopated" }),
    )
    expect(context?.activeMelody.notes[0]).not.toHaveProperty("id")
    expect(context?.activeMelody.notes[0]).not.toHaveProperty("locks")
  })

  it("同じ相談と楽曲状態は同じfingerprintになり、変更時だけ無効化される", () => {
    const context = buildAiArrangementContext(project(), "intro")!
    const first = aiContextFingerprint("余白を活かしたい", context)
    expect(aiContextFingerprint("余白を活かしたい", context)).toBe(first)
    expect(aiContextFingerprint("反復を活かしたい", context)).not.toBe(first)
  })

  it("公開コンテキストには固有人物・作品名を含めない", () => {
    const context = buildAiArrangementContext(project(), "intro")!
    const serialized = JSON.stringify(context.arrangementConstitution)
    expect(serialized).not.toMatch(/Myl.ne|Farmer|Boutonnat|Laurent/i)
  })

  it("存在しないSectionは送信対象にしない", () => {
    expect(buildAiArrangementContext(project(), "missing")).toBeNull()
  })
})
