import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { MelodyVariant } from "@/core/melody"
import {
  currentCandidateResultItems,
  generationResultLinks,
  wholeSongGenerationResultItems,
} from "./generationResultNavigation"
import type { WholeSongArrangementAction } from "./wholeSongDirectionPlan"

describe("generationResultLinks", () => {
  it("保存済み候補をSectionとGenerator別に列挙し、最新バッチの件数を返す", () => {
    const project = createEmptyProject("Current candidates")
    project.sections = [
      { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
      { id: "verse", name: "Aメロ", role: "verse", startBar: 5, lengthBars: 4 },
    ]
    const melody = (id: string, sectionId: string, batchId: string, createdAt: string): MelodyVariant => ({
      id,
      name: id,
      sectionId,
      sourceMode: "generate",
      notes: [],
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features: null,
      generatorVersion: "test",
      seed: 1,
      songProfile: project.song.songProfile,
      parentMelodyId: null,
      batchId,
      createdAt,
    })
    project.melodyVariants = [
      melody("old", "intro", "old-batch", "2026-01-01T00:00:00.000Z"),
      melody("new-a", "intro", "new-batch", "2026-02-01T00:00:00.000Z"),
      melody("new-b", "intro", "new-batch", "2026-02-01T00:00:01.000Z"),
    ]
    project.sectionMelodyAssignments.intro = "new-a"
    project.sectionAccompanimentPatternAssignments.verse = "arpeggio-up"

    expect(currentCandidateResultItems(project)).toEqual([
      {
        id: "intro:melody",
        sectionId: "intro",
        sectionName: "Intro",
        generator: "melody",
        target: "melody",
        candidateCount: 2,
        latestBatchId: "new-batch",
        applied: true,
      },
      {
        id: "verse:accompaniment",
        sectionId: "verse",
        sectionName: "Aメロ",
        generator: "accompaniment",
        target: "arrangement",
        candidateCount: 1,
        latestBatchId: null,
        applied: true,
      },
    ])
  })

  it("複数Generatorの確認先を実行順のまま全件返す", () => {
    expect(generationResultLinks(["signature", "counter", "decoration"])).toEqual([
      { tab: "signature", label: "Signature" },
      { tab: "counter", label: "Counter" },
      { tab: "decoration", label: "Decoration" },
    ])
  })

  it("Imported MIDIの原Melodyを生成済み候補として列挙しない", () => {
    const project = createEmptyProject("Imported source")
    project.sections = [{ id: "song", name: "Imported Song", role: "instrumental", startBar: 1, lengthBars: 16 }]
    project.melodyVariants = [{
      id: "imported",
      name: "Imported lead",
      sectionId: "song",
      sourceMode: "import-midi",
      notes: [],
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features: null,
      generatorVersion: "midi-import-1",
      seed: 0,
      songProfile: project.song.songProfile,
      parentMelodyId: null,
      batchId: "import-batch",
      createdAt: "2026-01-01T00:00:00.000Z",
    }]
    project.sectionMelodyAssignments.song = "imported"

    expect(currentCandidateResultItems(project)).toEqual([])
  })

  it("同じGeneratorが複数Sectionにあっても確認リンクを重複させない", () => {
    expect(generationResultLinks(["counter", "counter", "decoration"])).toEqual([
      { tab: "counter", label: "Counter" },
      { tab: "decoration", label: "Decoration" },
    ])
  })

  it("全Sectionを候補・直接適用・維持・保留に分けて確認可能にする", () => {
    const base = {
      role: "transition-color",
      family: "atmospheric-pad",
      purpose: "役割を追加",
      entry: "休符から入る",
      exit: "余韻を残す",
      density: "sparse",
      register: "high",
      drama: "restrained",
      motion: "wave",
      rhythmCharacter: "spacious",
      silenceStrategy: "structural",
      creativeRisk: "focused",
      lengthBars: 2,
      accompanimentPatternId: "none",
      statusReason: "test",
    } as const
    const actions: WholeSongArrangementAction[] = [
      { ...base, id: "intro", sectionId: "intro", sectionName: "Intro", generator: "signature", status: "available" },
      { ...base, id: "verse", sectionId: "verse", sectionName: "Aメロ", generator: "accompaniment", status: "available" },
      { ...base, id: "chorus", sectionId: "chorus", sectionName: "サビ", generator: "counter", status: "already-active" },
      { ...base, id: "outro", sectionId: "outro", sectionName: "Outro", generator: "none", status: "preserve" },
    ]
    const items = wholeSongGenerationResultItems(actions, [
      { actionId: "intro", sectionId: "intro", generated: true, target: "signature" },
      { actionId: "verse", sectionId: "verse", generated: true, target: "arrangement" },
    ])

    expect(items.map((item) => [item.sectionName, item.status, item.target])).toEqual([
      ["Intro", "candidate", "signature"],
      ["Aメロ", "applied", "arrangement"],
      ["サビ", "existing", "counter"],
      ["Outro", "preserved", null],
    ])
  })
})
