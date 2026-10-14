import { describe, expect, it } from "vitest"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import type { MelodyVariant } from "@/core/melody"
import { repeatedSectionSource, varyRepeatedSection } from "./repeatedSectionMelody"

function setup() {
  const project = arrangementReviewSong("A")
  const source: MelodyVariant = { id: "source", name: "source", sectionId: project.sections[1].id, sourceMode: "generate",
    notes: Array.from({ length: 32 }, (_, i) => ({ id: `n${i}`, startBeat: i, durationBeats: 0.5, pitch: 65 + i % 4, velocity: 80, locks: [] })),
    phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "test", seed: 1, songProfile: "original-custom", parentMelodyId: null, batchId: "test", createdAt: "2026-10-15T00:00:00Z" }
  project.melodyVariants = [source]
  project.sectionMelodyAssignments[source.sectionId] = source.id
  return { project, source, target: project.sections[4].id }
}
describe("反復セクションの旋律", () => {
  it("コード・長さ・役割が一致するときだけ前の採用済み旋律を参照する", () => {
    const { project, source, target } = setup()
    expect(repeatedSectionSource(project, target)).toBe(source)
    project.chords.find((c) => c.sectionId === target)!.symbol = "C"
    expect(repeatedSectionSource(project, target)).toBeUndefined()
  })
  it("再生成と取り込み旋律は土台にせず、変奏後も元の旋律を変えない", () => {
    const { project, source, target } = setup()
    const before = structuredClone(source)
    varyRepeatedSection(source, project, target, 32, 4, { low: 60, high: 77 }, 12)
    expect(source).toEqual(before)
    project.melodyVariants.push({ ...source, id: "target", sectionId: target })
    expect(repeatedSectionSource(project, target)).toBeUndefined()
  })
})
