import { describe, expect, it } from "vitest"
import type { MelodyNote, PhrasePlan, RangeRegenerationLocks } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { buildHarmonicMap } from "./harmonicMap"
import { resolveGenerationParams, RANGE_PRESETS } from "./generationParams"
import { generateRangeRegenerationCandidates } from "./rangeRegeneration"

const sourceNotes: MelodyNote[] = Array.from({ length: 12 }, (_, index) => ({
  id: `n${index}`,
  startBeat: index,
  durationBeats: 0.75,
  pitch: [60, 62, 64, 67][index % 4],
  velocity: 82,
  locks: [],
}))
const plans: PhrasePlan[] = [
  { phraseStartBeat: 0, phraseLengthBeats: 8, climaxBeat: 6, contour: "arch", restBeats: [], endTension: 0.2 },
  { phraseStartBeat: 8, phraseLengthBeats: 8, climaxBeat: 13, contour: "wave", restBeats: [], endTension: 0.3 },
]
const harmonicMap = buildHarmonicMap([
  { id: "c", sectionId: "s", startBeat: 0, durationBeats: 16, symbol: "Am", bass: null } satisfies ChordEvent,
])
const noLocks: RangeRegenerationLocks = {
  pitch: false,
  rhythm: false,
  motif: false,
  opening: false,
  ending: false,
}

function generate(locks = noLocks) {
  return generateRangeRegenerationCandidates({
    sourceNotes,
    phrasePlans: plans,
    lockedBars: [],
    timeSignature: "4/4",
    startBeat: 4,
    endBeat: 12,
    totalBeats: 16,
    harmonicMap,
    range: RANGE_PRESETS.middle,
    params: resolveGenerationParams("original-custom", "verse", "balanced", "growing", "Am"),
    density: "balanced",
    profile: "standard",
    locks,
    seed: 1234,
  })
}

describe("range regeneration", () => {
  it("選択範囲外を完全に保持し、独立候補を最大3件返す", () => {
    const result = generate()
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.length).toBeLessThanOrEqual(3)
    for (const candidate of result.candidates) {
      expect(candidate.notes.filter((note) => note.startBeat < 4 || note.startBeat >= 12)).toEqual(
        sourceNotes.filter((note) => note.startBeat < 4 || note.startBeat >= 12),
      )
    }
  })

  it("Rhythm Lockで範囲内のonsetとdurationを保持する", () => {
    const result = generate({ ...noLocks, rhythm: true })
    const sourceRhythm = sourceNotes
      .filter((note) => note.startBeat >= 4 && note.startBeat < 12)
      .map((note) => [note.startBeat, note.durationBeats])
    for (const candidate of result.candidates) {
      expect(
        candidate.notes
          .filter((note) => note.startBeat >= 4 && note.startBeat < 12)
          .map((note) => [note.startBeat, note.durationBeats]),
      ).toEqual(sourceRhythm)
    }
  })

  it("PitchとRhythmを同時固定した過拘束を診断する", () => {
    const result = generate({ ...noLocks, pitch: true, rhythm: true })
    expect(result.overConstrained).toBe(true)
  })

  it("固定seedで音楽的結果を再現する", () => {
    const a = generate().candidates.map((candidate) =>
      candidate.notes.map(({ startBeat, durationBeats, pitch }) => ({ startBeat, durationBeats, pitch })),
    )
    const b = generate().candidates.map((candidate) =>
      candidate.notes.map(({ startBeat, durationBeats, pitch }) => ({ startBeat, durationBeats, pitch })),
    )
    expect(a).toEqual(b)
  })
})
