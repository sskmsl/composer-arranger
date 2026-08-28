import { describe, expect, it } from "vitest"
import type { MelodyNote } from "./melody"
import {
  annotateArrangementApproaches,
  evaluateArrangementNecessity,
  identifyArrangementSurpriseOpportunities,
  type ArrangementSurpriseContext,
} from "./arrangementSurprise"

const note = (pitch: number, startBeat: number, durationBeats = 0.5): MelodyNote => ({
  id: `${pitch}-${startBeat}`,
  pitch,
  startBeat,
  durationBeats,
  velocity: 64,
  locks: [],
})

const context = (patch: Partial<ArrangementSurpriseContext> = {}): ArrangementSurpriseContext => ({
  chords: [{ startBeat: 0, durationBeats: 4, symbol: "Am" }],
  melodyNotes: [note(69, 0, 1), note(72, 2, 1)],
  totalBeats: 4,
  sectionRole: "pre-chorus",
  nextSectionRole: "chorus",
  nextSectionFirstChord: "Fm",
  ...patch,
})

describe("arrangement surprise / tension layer", () => {
  it("半音で和声音へ解決する逸脱だけをSurpriseとして認める", () => {
    const result = evaluateArrangementNecessity(
      [note(70, 1), note(69, 1.5)],
      context(),
    )
    expect(result.approach).toBe("surprise-tension")
    expect(result.technique).toBe("chromatic-resolution")
    expect(result.resolution).toContain("70 → 69")
  })

  it("根拠も回収先もない音列はSafeへ戻す", () => {
    const result = evaluateArrangementNecessity(
      [note(64, 0), note(67, 1)],
      context({ nextSectionRole: undefined, nextSectionFirstChord: undefined }),
    )
    expect(result.approach).toBe("safe")
    expect(result.resolution).toBeNull()
  })

  it("Surprise候補は少数に制限し、残りをSafeとして説明する", () => {
    const candidates = [0, 1, 2].map((index) => ({
      id: String(index),
      notes: [note(70, 1), note(69, 1.5)],
    }))
    const annotated = annotateArrangementApproaches(candidates, context(), {
      maximumSurpriseCount: 1,
    })
    expect(
      annotated.filter(
        (candidate) =>
          candidate.arrangementNecessity?.approach === "surprise-tension",
      ),
    ).toHaveLength(1)
  })

  it("AIへ渡す機会には次コードへの先取りと、密度が高い場合の無音を含む", () => {
    const opportunities = identifyArrangementSurpriseOpportunities(
      context({ existingSupportNoteCount: 14 }),
    )
    expect(opportunities.map((item) => item.technique)).toContain(
      "next-chord-anticipation",
    )
    expect(opportunities.map((item) => item.technique)).toContain(
      "intentional-silence",
    )
  })
})
