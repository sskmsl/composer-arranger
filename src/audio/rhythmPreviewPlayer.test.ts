import { describe, expect, it } from "vitest"
import { rhythmPreviewVoiceForPitch } from "./rhythmPreviewPlayer"

describe("rhythmPreviewVoiceForPitch", () => {
  it("書き出し用ドラム音程を簡易試聴音へ分類する", () => {
    expect(rhythmPreviewVoiceForPitch(36)).toBe("kick")
    expect(rhythmPreviewVoiceForPitch(37)).toBe("snare")
    expect(rhythmPreviewVoiceForPitch(38)).toBe("snare")
    expect(rhythmPreviewVoiceForPitch(42)).toBe("hat")
    expect(rhythmPreviewVoiceForPitch(46)).toBe("hat")
    expect(rhythmPreviewVoiceForPitch(50)).toBe("percussion")
  })
})
