import { useMemo, useState } from "react"
import {
  arrangementPartMatrix,
  currentArrangementVersion,
  diffArrangementMatrices,
  type ArrangementCellChange,
  type ArrangementChatMessage,
  type ArrangementChatProposal,
  type ArrangementMatrixSection,
} from "@/core/arrangementChat"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { arrangementFromRecipe } from "@/ai-arranger/arrangementChatAdvice"
import { useProjectStore } from "@/store/useProjectStore"

export interface ArrangementChatModel {
  project: ComposerProject
  matrix: ArrangementMatrixSection[]
  versionLabel: string
  /** いま鳴っている全曲アレンジに当たる版(相談の外で作り直した後はなし) */
  currentVersionId: string | null
  versionChanges: ArrangementCellChange[]
  /** まだ適用も見送りもしていない、最新の返事 */
  openMessage: ArrangementChatMessage | null
  selectedProposal: ArrangementChatProposal | null
  selectProposal: (proposalId: string) => void
  pendingChanges: ArrangementCellChange[]
  /** 変更案の全曲アレンジ(生成条件から作る。同じ曲の状態なら使い回す) */
  arrangementFor: (proposal: ArrangementChatProposal) => FullSongArrangement
  changesFor: (proposal: ArrangementChatProposal) => ArrangementCellChange[]
}

// 曲の状態(project)ごとに、変更案の全曲アレンジを覚えておく。曲が変われば自然に作り直す
const proposalArrangementCache = new WeakMap<ComposerProject, Map<string, FullSongArrangement>>()

function proposalArrangement(project: ComposerProject, proposal: ArrangementChatProposal): FullSongArrangement {
  let byProposal = proposalArrangementCache.get(project)
  if (!byProposal) {
    byProposal = new Map()
    proposalArrangementCache.set(project, byProposal)
  }
  const cached = byProposal.get(proposal.id)
  if (cached) return cached
  const arrangement = arrangementFromRecipe(project, proposal.recipe)
  byProposal.set(proposal.id, arrangement)
  return arrangement
}

export type PartCellMark = "changed" | "added" | "removed" | "pending"

/** 版の変化(確定)と、提案中の変化(未適用)を、パート構成表の印へ変換する */
export function partCellMarks(
  versionChanges: ArrangementCellChange[],
  pendingChanges: ArrangementCellChange[],
): Map<string, PartCellMark> {
  const marks = new Map<string, PartCellMark>()
  for (const change of versionChanges) marks.set(`${change.sectionId}:${change.rowId}`, change.kind)
  for (const change of pendingChanges) marks.set(`${change.sectionId}:${change.rowId}`, "pending")
  return marks
}

/** 結果・書出しの表と相談パネルで共有する、アレンジ相談の状態 */
export function useArrangementChat(): ArrangementChatModel {
  const project = useProjectStore((state) => state.project)
  const chat = project.arrangementChat
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)

  const matrix = useMemo(() => arrangementPartMatrix(project, project.fullSongArrangement), [project])
  const currentVersion = currentArrangementVersion(chat, project.fullSongArrangement)
  const versionLabel = currentVersion
    ? `版 ${currentVersion.number} · ${currentVersion.label}`
    : project.fullSongArrangement
      ? "いまの全曲アレンジ"
      : "追加パートなし（原曲のみ）"

  const lastAssistant = [...(chat?.messages ?? [])].reverse().find((message) => message.role === "assistant")
  const openMessage = lastAssistant?.proposals?.length && !lastAssistant.appliedProposalId && !lastAssistant.dismissed
    ? lastAssistant
    : null
  const selectedProposal = openMessage
    ? openMessage.proposals!.find((proposal) => proposal.id === selectedProposalId) ?? openMessage.proposals![0]
    : null

  const arrangementFor = (proposal: ArrangementChatProposal) => proposalArrangement(project, proposal)
  const changesFor = (proposal: ArrangementChatProposal): ArrangementCellChange[] =>
    diffArrangementMatrices(matrix, arrangementPartMatrix(project, proposalArrangement(project, proposal)))

  // 表に出す「提案中」の印は、選んでいる案についてだけ求める
  const pendingChanges = useMemo(
    () => selectedProposal
      ? diffArrangementMatrices(matrix, arrangementPartMatrix(project, proposalArrangement(project, selectedProposal)))
      : [],
    [matrix, project, selectedProposal],
  )

  return {
    project,
    matrix,
    versionLabel,
    currentVersionId: currentVersion?.id ?? null,
    versionChanges: currentVersion?.changes ?? [],
    openMessage,
    selectedProposal,
    selectProposal: setSelectedProposalId,
    pendingChanges,
    arrangementFor,
    changesFor,
  }
}
