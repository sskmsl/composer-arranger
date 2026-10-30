import { expect, it } from "vitest"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { arrangementResponseFixture } from "../../tools/qa/arrangementResponse"
import { proposalsFromResponse } from "./arrangementChatAdvice"
import { useProjectStore } from "@/store/useProjectStore"
import { preparedProposal } from "@/features/arrangement/proposalCache"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
it("retains the first generated arrangements and binds them before the reply is published", () => {
  const project = arrangementReviewSong("A"), prepared: Array<{ proposalId: string; arrangement: FullSongArrangement }> = []
  const proposals = proposalsFromResponse(project, arrangementResponseFixture(), "全曲の流れを整えて", [], "reply", ["全曲の流れを整えて"],
    (proposalId, arrangement) => prepared.push({ proposalId, arrangement }))
  expect(prepared).toHaveLength(3)
  expect(prepared.map((item) => item.proposalId)).toEqual(proposals.map((item) => item.id))
  useProjectStore.setState({ project, persist: () => {} })
  useProjectStore.getState().appendArrangementChatMessages([{ id: "reply", role: "assistant", text: "", createdAt: "", proposals }], [], prepared)
  const published = useProjectStore.getState().project
  for (const item of prepared) expect(preparedProposal(published, item.proposalId)).toBe(item.arrangement)
  expect(JSON.stringify(published)).not.toContain('"prepared"')
}, 30_000)
