import { describe, expect, it } from "vitest"
import { adoptedMelodyLayers } from "./melodyLayers"
import { createEmptyProject } from "./project"
import type { ReactiveLayerCandidate } from "./reactiveLayer"

function candidate(id: string, kind: "counter" | "decoration", sectionId: string): ReactiveLayerCandidate {
  return {
    id,
    kind,
    sectionId,
    name: `${kind}-${id}`,
    notes: [{ id: `${id}-n`, startBeat: 1, durationBeats: 1, pitch: 64, velocity: 80, locks: [] }],
  } as unknown as ReactiveLayerCandidate
}

describe("旋律タブ: セクションの対旋律・装飾・イントロの採用状況", () => {
  it("採用中の候補の音符と名前、未採用の候補数を返す", () => {
    const base = createEmptyProject("Layers")
    const project = {
      ...base,
      reactiveLayerCandidates: [
        candidate("c1", "counter", "s1"),
        candidate("c2", "counter", "s1"),
        candidate("d1", "decoration", "s1"),
        candidate("x1", "counter", "other"),
      ],
      sectionReactiveLayerAssignments: { s1: "c2" },
      sectionDecorationLayerAssignments: {},
    }
    const [counter, decoration, intro] = adoptedMelodyLayers(project, "s1")
    expect(counter).toMatchObject({ kind: "counter", name: "counter-c2", candidateCount: 2 })
    expect(counter.notes).toHaveLength(1)
    expect(decoration).toMatchObject({ kind: "decoration", name: null, candidateCount: 1, notes: [] })
    expect(intro).toMatchObject({ kind: "intro", name: null, candidateCount: 0 })
  })

  it("別のセクションに採用した候補は重ねない", () => {
    const base = createEmptyProject("Layers")
    const project = {
      ...base,
      reactiveLayerCandidates: [candidate("c1", "counter", "s1")],
      sectionReactiveLayerAssignments: { s1: "c1" },
    }
    expect(adoptedMelodyLayers(project, "s2")[0].notes).toEqual([])
  })
})
