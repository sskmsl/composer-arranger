import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import { directionAuditionRanges } from "./directionAudition"

function arrangement(totalBeats: number, peakSectionId: string | null): FullSongArrangement {
  return {
    version: "1.0.0",
    id: "preview",
    createdAt: "2026-01-01T00:00:00.000Z",
    analysis: {
      version: "1.0.0",
      bpm: 120,
      key: "Am",
      timeSignature: "4/4",
      totalBeats,
      peakSectionId,
      sections: [],
    },
    plan: { version: "1.0.0", brief: "", seed: 1, sections: [] },
    tracks: [],
  }
}

describe("Direction audition ranges", () => {
  it("同じ比較条件として冒頭と頂点Sectionを各4小節返す", () => {
    const project = createEmptyProject("Audition")
    project.sections = [
      { ...project.sections[0], id: "intro", name: "Intro", lengthBars: 8 },
      { ...project.sections[0], id: "chorus", name: "Chorus", startBar: 9, lengthBars: 8 },
    ]
    expect(directionAuditionRanges(project, arrangement(64, "chorus"))).toEqual([
      { startBeat: 0, endBeat: 16, label: "冒頭4小節" },
      { startBeat: 32, endBeat: 48, label: "Chorusの冒頭4小節" },
    ])
  })

  it("短い曲や冒頭が頂点の曲では同じ範囲を二度鳴らさない", () => {
    const project = createEmptyProject("Short")
    project.sections[0] = { ...project.sections[0], id: "peak", lengthBars: 4 }
    expect(directionAuditionRanges(project, arrangement(16, "peak"))).toHaveLength(1)
  })
})
