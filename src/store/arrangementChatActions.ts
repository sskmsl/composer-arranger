import {
  arrangementForVersion,
  arrangementPartMatrix,
  diffArrangementMatrices,
  emptyArrangementChat,
  MAX_ARRANGEMENT_CHAT_MESSAGES,
  pushArrangementVersion,
  type ArrangementChatMessage,
  type ArrangementChatState,
} from "@/core/arrangementChat"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { snapshot } from "./storeHelpers"
import type { ProjectState } from "./useProjectStore"

type SetState = (partial: Partial<ProjectState>) => void
type GetState = () => ProjectState

export interface ArrangementChatActions {
  /** 会話を足す(利用者の発言・AIの返事)。confirmedConstraints はAIが返した最新の一覧 */
  appendArrangementChatMessages: (messages: ArrangementChatMessage[], confirmedConstraints?: string[]) => void
  /** 変更案を適用する。試聴した全曲アレンジそのものを受け取り、版として積む */
  applyArrangementChatProposal: (messageId: string, proposalId: string, arrangement: FullSongArrangement) => void
  dismissArrangementChatProposals: (messageId: string) => void
  /** 版を戻す(生成条件から全曲アレンジを作り直す。原曲のみの版は追加パートを外す) */
  restoreArrangementVersion: (versionId: string) => void
  /** 会話と確定した条件だけを消す(版の履歴は残す) */
  resetArrangementChatConversation: () => void
}

function chatOf(state: ProjectState): ArrangementChatState {
  return state.project.arrangementChat ?? emptyArrangementChat()
}

/**
 * アレンジ相談チャットの操作。useProjectStore から分けた操作群。
 * 会話の追加は取り消しの対象にせず、全曲アレンジを変える適用・版戻しだけを取り消せるようにする。
 */
export function createArrangementChatActions(set: SetState, get: GetState): ArrangementChatActions {
  return {
    appendArrangementChatMessages: (messages, confirmedConstraints) => {
      const prev = get().project
      const chat = chatOf(get())
      set({
        project: {
          ...prev,
          arrangementChat: {
            ...chat,
            updatedAt: new Date().toISOString(),
            messages: [...chat.messages, ...messages].slice(-MAX_ARRANGEMENT_CHAT_MESSAGES),
            confirmedConstraints: confirmedConstraints ?? chat.confirmedConstraints,
          },
        },
      })
      get().persist()
    },

    applyArrangementChatProposal: (messageId, proposalId, arrangement) => {
      const prev = get().project
      const chat = chatOf(get())
      const message = chat.messages.find((candidate) => candidate.id === messageId)
      const proposal = message?.proposals?.find((candidate) => candidate.id === proposalId)
      if (!message || !proposal || message.appliedProposalId) return
      const next = { ...prev, fullSongArrangement: arrangement }
      const changes = diffArrangementMatrices(
        arrangementPartMatrix(prev, prev.fullSongArrangement),
        arrangementPartMatrix(next, arrangement),
      )
      const createdAt = new Date().toISOString()
      const versionId = `version:${proposal.id}`
      const withVersion = pushArrangementVersion(chat, prev.fullSongArrangement, {
        id: versionId,
        label: proposal.title,
        createdAt,
        recipe: proposal.recipe,
        arrangementId: arrangement.id,
        changes,
      })
      set({
        history: [...get().history, snapshot(prev)],
        future: [],
        project: {
          ...next,
          arrangementChat: {
            ...withVersion,
            messages: withVersion.messages.map((candidate) =>
              candidate.id === messageId
                ? { ...candidate, appliedProposalId: proposalId, appliedVersionId: versionId }
                : candidate,
            ),
          },
        },
      })
      get().persist()
    },

    dismissArrangementChatProposals: (messageId) => {
      const prev = get().project
      const chat = chatOf(get())
      set({
        project: {
          ...prev,
          arrangementChat: {
            ...chat,
            messages: chat.messages.map((candidate) =>
              candidate.id === messageId ? { ...candidate, dismissed: true } : candidate,
            ),
          },
        },
      })
      get().persist()
    },

    restoreArrangementVersion: (versionId) => {
      const prev = get().project
      const chat = chatOf(get())
      const version = chat.versions.find((candidate) => candidate.id === versionId)
      if (!version) return
      const fullSongArrangement = arrangementForVersion(chat.versions, version.id, (recipe) =>
        generateFullSongArrangement(prev, recipe),
      )
      set({
        history: [...get().history, snapshot(prev)],
        future: [],
        project: {
          ...prev,
          fullSongArrangement,
          arrangementChat: {
            ...chat,
            updatedAt: new Date().toISOString(),
            currentVersionId: version.id,
            // 曲を編集した後に戻すと作り直した結果が変わりうるので、実際にできたものを記録し直す
            versions: chat.versions.map((candidate) =>
              candidate.id === version.id
                ? { ...candidate, arrangementId: fullSongArrangement?.id ?? null }
                : candidate,
            ),
          },
        },
      })
      get().persist()
    },

    resetArrangementChatConversation: () => {
      const prev = get().project
      const chat = chatOf(get())
      set({
        project: {
          ...prev,
          arrangementChat: { ...chat, updatedAt: new Date().toISOString(), messages: [], confirmedConstraints: [] },
        },
      })
      get().persist()
    },
  }
}
