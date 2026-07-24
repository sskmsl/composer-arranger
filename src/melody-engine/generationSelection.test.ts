import { describe, expect, it } from "vitest"
import type { ChordEvent } from "@/core/project"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { CANDIDATE_SELECTION_CONFIG, PROFILE_MINIMUM_QUALITY } from "./candidateSelection"

const chords: ChordEvent[] = [
  { id: "a", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
  { id: "d", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "D#dim", bass: null },
  { id: "f", sectionId: "s", startBeat: 8, durationBeats: 4, symbol: "Fmaj7", bass: null },
  { id: "e", sectionId: "s", startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
]

function generate(seed = 17) {
  return generateFromChordsWithProfiles({
    chords,
    sectionId: "s",
    sectionRole: "verse",
    songProfile: "original-custom",
    density: "balanced",
    range: { low: 60, high: 79 },
    drama: "growing",
    totalBeats: 16,
    seed,
    profiles: ["chromatic"],
  })
}

describe("Profile候補プールと診断情報", () => {
  it("3件だけを直接返さず、9件以上の独立プールから3案を選ぶ", () => {
    const result = generate()
    expect(result.candidates).toHaveLength(3)
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(CANDIDATE_SELECTION_CONFIG.candidatePoolSize)
    expect(result.diagnostics.filter((d) => d.selected)).toHaveLength(3)
    expect(new Set(result.candidates.map((c) => c.generationDiagnostics?.candidatePoolIndex)).size).toBe(3)
  })

  it("選ばれた候補はProfile品質下限を維持する", () => {
    for (const candidate of generate().candidates) {
      expect(candidate.generationDiagnostics?.qualityScore).toBeGreaterThanOrEqual(PROFILE_MINIMUM_QUALITY.chromatic)
    }
  })

  it("seed・pool index・選抜理由・hash・補正理由を追跡できる", () => {
    const diagnostic = generate().diagnostics[0]
    expect(diagnostic.batchBaseSeed).toBe(17)
    expect(diagnostic.candidateSeed).toBeTypeOf("number")
    expect(diagnostic.candidatePoolIndex).toBe(0)
    expect(diagnostic.rawNotesHash).toMatch(/^[0-9a-f]{8}$/)
    expect(diagnostic.placedNotesHash).toMatch(/^[0-9a-f]{8}$/)
    expect(diagnostic.finalNotesHash).toMatch(/^[0-9a-f]{8}$/)
    expect(diagnostic.plannedTones.length).toBeGreaterThan(0)
    expect(diagnostic.corrections.every((correction) => correction.reason.length > 0)).toBe(true)
  })

  it("固定seedで音楽内容と選抜pool indexを再現する", () => {
    const a = generate(23)
    const b = generate(23)
    expect(a.candidates.map((c) => c.generationDiagnostics?.candidatePoolIndex)).toEqual(
      b.candidates.map((c) => c.generationDiagnostics?.candidatePoolIndex),
    )
    expect(a.candidates.map((c) => c.notes.map((n) => [n.startBeat, n.durationBeats, n.pitch]))).toEqual(
      b.candidates.map((c) => c.notes.map((n) => [n.startBeat, n.durationBeats, n.pitch])),
    )
  })
})
