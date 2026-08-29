import { describe, expect, it } from "vitest"
import { generationResultLinks } from "./generationResultNavigation"

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
})
