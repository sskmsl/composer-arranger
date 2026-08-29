import { describe, expect, it } from "vitest"
import {
  generationResultLinks,
  wholeSongGenerationResultItems,
} from "./generationResultNavigation"
import type { WholeSongArrangementAction } from "./wholeSongDirectionPlan"

describe("generationResultLinks", () => {
  it("複数Generatorの確認先を実行順のまま全件返す", () => {
    expect(generationResultLinks(["signature", "counter", "decoration"])).toEqual([
      { tab: "signature", label: "Signature" },
      { tab: "counter", label: "Counter" },
      { tab: "decoration", label: "Decoration" },
    ])
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
      { actionId: "verse", sectionId: "verse", generated: true, target: "melody" },
    ])

    expect(items.map((item) => [item.sectionName, item.status, item.target])).toEqual([
      ["Intro", "candidate", "signature"],
      ["Aメロ", "applied", "melody"],
      ["サビ", "existing", "counter"],
      ["Outro", "preserved", null],
    ])
  })
})
