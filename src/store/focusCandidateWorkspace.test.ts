import { beforeEach, describe, expect, it } from "vitest"
import { useProjectStore } from "./useProjectStore"

describe("focusCandidateWorkspace", () => {
  beforeEach(() => {
    useProjectStore.setState({
      selectedSectionId: null,
      activeBatchId: "old-melody",
      activeCandidateIndex: 4,
      activePhraseBatchId: "old-phrase",
      activePhraseCandidateIndex: 3,
      activeSignaturePhraseBatchId: "old-signature",
      activeSignaturePhraseCandidateIndex: 2,
      activeReactiveBatchId: "old-reactive",
      activeReactiveCandidateIndex: 1,
    })
  })

  it("対象SectionのMelody候補バッチを開き、他Generatorの選択を解除する", () => {
    useProjectStore.getState().focusCandidateWorkspace("verse", "melody", "verse-batch")

    const state = useProjectStore.getState()
    expect(state.selectedSectionId).toBe("verse")
    expect(state.activeBatchId).toBe("verse-batch")
    expect(state.activeCandidateIndex).toBe(0)
    expect(state.activePhraseBatchId).toBeNull()
    expect(state.activeSignaturePhraseBatchId).toBeNull()
    expect(state.activeReactiveBatchId).toBeNull()
  })

  it("CounterとDecorationは対象のReactive候補バッチを開く", () => {
    useProjectStore.getState().focusCandidateWorkspace("chorus", "counter", "counter-batch")

    const state = useProjectStore.getState()
    expect(state.selectedSectionId).toBe("chorus")
    expect(state.activeReactiveBatchId).toBe("counter-batch")
    expect(state.activeReactiveCandidateIndex).toBe(0)
    expect(state.activeBatchId).toBeNull()
  })
})
