import { expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { AssistantMessage } from "./ArrangementChatPanel"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import type { ArrangementChatModel } from "./useArrangementChat"
import type { ArrangementChatMessage } from "@/core/arrangementChat"
const proposal = { id: "a", label: "案A", title: "保存済みの案", summary: "", points: ["保存された変更の説明"], generator: "none", generationBrief: "", recipe: { seed: 19, brief: "", revision: 0 } }
function render(applied: boolean) {
  const model: ArrangementChatModel = { project: arrangementReviewSong("A"), matrix: [], versionLabel: "", currentVersionId: null, versionChanges: [], openMessage: null, selectedProposal: proposal, selectProposal: vi.fn(), pendingChanges: [], arrangementFor: () => undefined, projectFor: () => arrangementReviewSong("A"), changesFor: () => [] }
  const message: ArrangementChatMessage = { id: "reply", role: "assistant", createdAt: "", text: "", proposals: [proposal], ...(applied ? { appliedProposalId: "a" } : {}) }
  return renderToStaticMarkup(<AssistantMessage message={message} model={model} isOpen={!applied} listening={null} versionNumber={1} isCurrentVersion canConfirm={false} onListen={vi.fn()} onApply={vi.fn()} onDismiss={vi.fn()} onUndo={vi.fn()} onNextProposal={vi.fn()} onConfirm={vi.fn()} />)
}
it("keeps recorded points for applied proposals when no prepared audio is cached", () => {
  const html = render(true)
  expect(html).toContain("保存された変更の説明")
  expect(html).not.toContain("音の準備が完了するまで")
})
it("still explains why a pending uncached proposal cannot be applied", () => {
  expect(render(false)).toContain("音の準備が完了するまで")
})
