import { describe, expect, it } from "vitest"
import { buildMidiReviewIssues } from "./importReview"

function analysis(overrides: Partial<Parameters<typeof buildMidiReviewIssues>[0]> = {}) {
  return {
    melodyTrackConfidence: 0.9,
    keyInference: {
      key: "F#m",
      confidence: 0.9,
      source: "pitch-profile" as const,
      alternatives: [],
      evidence: [],
    },
    sectionsFromMarkers: true,
    totalBars: 16,
    ...overrides,
  }
}

describe("MIDI import approval issues", () => {
  it("信頼度が十分ならユーザー確認を要求しない", () => {
    expect(buildMidiReviewIssues(analysis(), 0.8)).toEqual([])
  })

  it("低信頼度の判定だけを確認対象にする", () => {
    const issues = buildMidiReviewIssues(analysis({
      melodyTrackConfidence: 0.5,
      keyInference: {
        key: "F#m",
        confidence: 0.4,
        source: "pitch-profile",
        alternatives: [{ key: "A", fit: 0.8 }],
        evidence: [],
      },
      sectionsFromMarkers: false,
    }), 0.4)

    expect(issues.map((issue) => issue.id)).toEqual([
      "melody",
      "key",
      "chords",
      "sections",
    ])
  })

  it("MIDI Key Signatureは確定情報として扱う", () => {
    const issues = buildMidiReviewIssues(analysis({
      keyInference: {
        key: "F#m",
        confidence: 0.2,
        source: "midi-signature",
        alternatives: [],
        evidence: [],
      },
    }), 0.8)

    expect(issues.some((issue) => issue.id === "key")).toBe(false)
  })
})
