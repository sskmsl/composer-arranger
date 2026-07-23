import { describe, expect, it } from "vitest"
import { generateFromChords } from "./generateFromChords"
import type { ChordEvent } from "@/core/project"

const chords: ChordEvent[] = [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 16, symbol: "C", bass: null }]

describe("generateFromChords / notes never exceed totalBeats (issue #2)", () => {
  it("seed 1〜200のすべてで、全ノートがセクション範囲内([0, totalBeats))に収まる", () => {
    const totalBeats = 16
    const violations: string[] = []

    for (let seed = 1; seed <= 200; seed++) {
      const { candidates } = generateFromChords({
        chords,
        sectionId: "s1",
        sectionRole: "verse",
        songProfile: "original-custom",
        density: "balanced",
        range: { low: 60, high: 77 },
        drama: "growing",
        totalBeats,
        seed,
        candidateCount: 1,
      })

      for (const candidate of candidates) {
        for (const note of candidate.notes) {
          if (note.startBeat < 0 || note.startBeat + note.durationBeats > totalBeats + 1e-6) {
            violations.push(
              `seed ${seed}: note startBeat=${note.startBeat} durationBeats=${note.durationBeats} exceeds totalBeats=${totalBeats}`,
            )
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})
