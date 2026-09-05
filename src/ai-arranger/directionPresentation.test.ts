import { describe, expect, it } from "vitest"
import type { AiArrangementIntent } from "./types"
import { audibleDirectionPresentation, plainDirectionText } from "./directionPresentation"

function intent(overrides: Partial<AiArrangementIntent> = {}): AiArrangementIntent {
  return {
    id: "direction-1",
    title: "abstract title",
    generator: "accompaniment",
    emotionalFunction: "abstract emotion",
    density: "balanced",
    register: "low",
    drama: "restrained",
    motion: "static",
    rhythmCharacter: "pulsed",
    silenceStrategy: "breathing",
    creativeRisk: "focused",
    lengthBars: 4,
    techniques: [],
    soundPalette: "synth",
    performanceDirection: "最後のパルスを抜いて1拍目を強く感じさせる。",
    why: "reason",
    generationBrief: "brief",
    soundSourceSuggestions: [],
    accompanimentPatternId: "pulse-root-fifth",
    rhythmPlan: {
      enabled: false,
      subdivision: "eighth",
      feel: "straight",
      kickPattern: "",
      snarePattern: "",
      hatPattern: "",
      percussionPattern: "",
      variation: "",
      bars: 1,
      events: [],
    },
    ...overrides,
  }
}

describe("AI Direction presentation", () => {
  it("自由文ではなく聴こえ方を示す日本語へ整理する", () => {
    const result = audibleDirectionPresentation(intent())
    expect(result.title).toBe("伴奏の反復で曲を前へ進める")
    expect(result.summary).toContain("低音")
    expect(result.changes).toHaveLength(3)
    expect(result.changes.join(" ")).toContain("主旋律")
    expect(result.changes.join(" ")).toContain("休み")
  })

  it("意味の伝わりにくい制作語を具体的な聴感へ言い換える", () => {
    expect(plainDirectionText(intent().performanceDirection)).toBe(
      "小節の最後を休ませ、次の小節の始まりをはっきり聴かせる。",
    )
    expect(plainDirectionText("シンコペーションとモチーフ")).toBe(
      "拍の表から少しずらしたリズムと短い音型",
    )
  })

  it("診断の内部指標と幅広い専門語を画面向けの説明へ変換する", () => {
    const result = plainDirectionText(
      "モチーフ反復率が約52%、コードトーン使用率74%、休符率1%。Bridgeでレイヤーのアタックとテンションノートを調整する。",
    )
    expect(result).not.toMatch(/52%|74%|1%|モチーフ|コードトーン|Bridge|レイヤー|アタック|テンション/)
    expect(result).toContain("短い音型の繰り返しは適度")
    expect(result).toContain("間奏")
    expect(result).toContain("追加パート")
    expect(result).toContain("緊張感を作る音")
  })
})
