import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { explainMelodyCandidate, musicalPosition } from "./melodyEvidence"

function note(
  id: string,
  startBeat: number,
  pitch: number,
  durationBeats = 0.5,
  extra: Partial<MelodyNote> = {},
): MelodyNote {
  return {
    id,
    startBeat,
    pitch,
    durationBeats,
    velocity: 90,
    locks: [],
    ...extra,
  }
}

const chords: ChordEvent[] = [
  { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "Am", bass: null },
  { id: "c2", sectionId: "s1", startBeat: 4, durationBeats: 4, symbol: "E7", bass: null },
]

describe("melody candidate evidence", () => {
  it("小節・拍を四分音符換算の拍子から表示する", () => {
    expect(musicalPosition(0, 4)).toBe("1小節目 1拍")
    expect(musicalPosition(5.5, 4)).toBe("2小節目 2.5拍")
    expect(musicalPosition(3, 3)).toBe("2小節目 1拍")
  })

  it("実音から解決・Motif回帰・最高音・余白を具体的に説明する", () => {
    const notes = [
      note("n1", 0, 60),
      note("n2", 0.5, 62),
      note("n3", 1, 64),
      note("n4", 1.5, 65),
      note("tension", 2, 65, 1, {
        plannedToneRole: "suspension",
        plannedResolution: {
          targetPitchClass: 4,
          targetBeat: 3,
          maximumDelayBeats: 1,
        },
      }),
      note("resolution", 3, 64),
      note("r1", 4, 67),
      note("r2", 4.5, 69),
      note("r3", 5, 71),
      note("r4", 5.5, 72),
      note("peak", 7, 76, 0.75),
    ]
    const result = explainMelodyCandidate({ notes }, chords, 4, 8)

    expect(result.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "planned-resolution",
        "motif-return",
        "highest-note",
        "structural-silence",
      ]),
    )
    expect(result.items.find((item) => item.id === "planned-resolution")?.observation)
      .toContain("Am上でF4を掛留音")
    expect(result.items.find((item) => item.id === "motif-return")?.observation)
      .toContain("7半音上へ移高")
    expect(result.items.find((item) => item.id === "highest-note")?.observation)
      .toContain("最高音E5")
    expect(result.items.find((item) => item.id === "structural-silence")?.range.endBeat)
      .toBeLessThanOrEqual(8)
  })

  it("未解決・最高音反復・余白不足を注意点として断定を避けて示す", () => {
    const notes = [
      note("a", 0, 72, 0.5, {
        plannedToneRole: "appoggiatura",
        plannedResolution: {
          targetPitchClass: 11,
          targetBeat: 1,
          maximumDelayBeats: 0.5,
        },
      }),
      note("b", 0.5, 67),
      note("c", 1, 72),
      note("d", 1.5, 69),
      note("e", 2, 72),
    ]
    const result = explainMelodyCandidate(
      {
        notes,
        candidateMelodyDNA: {
          motifIdentity: "stepwise-cell",
          rhythmGrammar: "balanced",
          phraseArchitecture: "balanced",
          harmonicResponse: "delayed-resolution",
          registerTrajectory: "arch",
          developmentStrategy: "delayed-return",
          climaxPlan: { type: "pitch-peak", position: "middle", targetFraction: 0.5 },
          endingStrategy: "open",
        },
      },
      chords,
      4,
      8,
    )

    expect(result.cautions).toContain(
      "解決計画を持つ音のうち1音は、指定時間内の到着音を実音から確認できません。",
    )
    expect(result.cautions.some((text) => text.includes("最高音C5が3回"))).toBe(true)
    expect(result.cautions.some((text) => text.includes("0.5拍以上の明確なメロディ休止"))).toBe(true)
  })
})
