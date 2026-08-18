import { describe, expect, it } from "vitest"
import type { AiArrangementIntent } from "./types"
import {
  decorationSettingsForIntent,
  phraseLengthForIntent,
  signatureLengthForIntent,
  signatureDirectionForIntent,
  targetTabForIntent,
} from "./generationBridge"

function intent(
  patch: Partial<AiArrangementIntent> = {},
): AiArrangementIntent {
  return {
    id: "direction-1",
    title: "Breathing entrance",
    generator: "signature",
    emotionalFunction: "静かに世界を開く",
    density: "sparse",
    register: "middle",
    drama: "restrained",
    motion: "ascending",
    rhythmCharacter: "spacious",
    silenceStrategy: "structural",
    creativeRisk: "focused",
    lengthBars: 8,
    techniques: ["negative space"],
    soundPalette: "soft piano",
    performanceDirection: "leave the tail",
    why: "protects the melody",
    generationBrief: "short motif with long gaps",
    soundSourceSuggestions: [],
    accompanimentPatternId: "none",
    rhythmPlan: {
      enabled: false,
      subdivision: "eighth",
      feel: "straight",
      kickPattern: "",
      snarePattern: "",
      hatPattern: "",
      percussionPattern: "",
      variation: "",
    },
    ...patch,
  }
}

describe("AI Intent generation bridge", () => {
  it("AIの音域・密度・方向を既存Generatorが受け取れる設定へ変換する", () => {
    expect(decorationSettingsForIntent(intent({ generator: "decoration" }))).toEqual({
      type: "auto",
      character: "auto",
      direction: "rising",
      length: 4,
      density: "sparse",
    })
  })

  it("Sectionを超えない既存Signature/Phrase長へ安全に丸める", () => {
    expect(signatureLengthForIntent(intent({ lengthBars: 8 }), 6)).toBe(4)
    expect(signatureLengthForIntent(intent({ lengthBars: 2 }), 8)).toBe(2)
    expect(phraseLengthForIntent(intent({ generator: "phrase", lengthBars: 8 }), 5)).toBe(5)
    expect(phraseLengthForIntent(intent({ generator: "phrase", lengthBars: 2 }), 1)).toBeNull()
  })

  it("Intentを対応する比較試聴画面へ送る", () => {
    expect(targetTabForIntent(intent({ generator: "signature" }))).toBe("signature")
    expect(targetTabForIntent(intent({ generator: "counter" }))).toBe("counter")
    expect(targetTabForIntent(intent({ generator: "accompaniment" }))).toBe("melody")
    expect(targetTabForIntent(intent({ generator: "none" }))).toBeNull()
  })

  it("AIの余白・リズム・輪郭をSignature生成語彙へ変換する", () => {
    expect(signatureDirectionForIntent(intent())).toEqual({
      archetype: "atmospheric-gateway",
      rhythmIdentity: "call-gap-answer",
      contour: "ascending",
      creativeRisk: "focused",
      targetSilenceRatio: 0.52,
    })
  })
})
