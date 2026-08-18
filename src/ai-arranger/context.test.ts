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
  it("コード・Active Melody・Section関係を個人情報を増やさず圧縮する", () => {
    const context = buildAiArrangementContext(project(), "intro")
    expect(context).not.toBeNull()
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

  it("存在しないSectionは送信対象にしない", () => {
    expect(buildAiArrangementContext(project(), "missing")).toBeNull()
  })
})
