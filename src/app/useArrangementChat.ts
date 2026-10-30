import { useEffect, useMemo, useRef, useState } from "react"
import {
  arrangementPartMatrix,
  currentArrangementVersion,
  diffArrangementMatrices,
  projectWithLayerProposal,
  type ArrangementCellChange,
  type ArrangementChatMessage,
  type ArrangementChatProposal,
  type ArrangementMatrixSection,
} from "@/core/arrangementChat"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { generateRecipeOffThread, isGenerationCancelled } from "@/features/arrangement/generationClient"
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
  /** 変更案の全曲アレンジ(生成条件から作る。同じ曲の状態なら使い回す)。対旋律・合いの手の案は今のまま */
  arrangementFor: (proposal: ArrangementChatProposal) => FullSongArrangement | undefined
  /** 変更案を当てた曲(対旋律・合いの手の案は、その層を付けた曲) */
  projectFor: (proposal: ArrangementChatProposal) => ComposerProject
  changesFor: (proposal: ArrangementChatProposal) => ArrangementCellChange[]
  preparing?: boolean
  preparationError?: string | null
  cancelPreparation?: () => void
  retryPreparation?: () => void
}

// 曲の状態(project)ごとに、変更案の全曲アレンジを覚えておく。曲が変われば自然に作り直す
const proposalArrangementCache = new WeakMap<ComposerProject, Map<string, FullSongArrangement>>()

function proposalArrangement(project: ComposerProject, proposal: ArrangementChatProposal): FullSongArrangement | undefined {
  if (proposal.layer) return project.fullSongArrangement
  let byProposal = proposalArrangementCache.get(project)
  if (!byProposal) {
    byProposal = new Map()
    proposalArrangementCache.set(project, byProposal)
  }
  const cached = byProposal.get(proposal.id)
  if (cached) return cached
  return undefined
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

/** アレンジ・書出し画面の表と相談パネルで共有する、アレンジ相談の状態 */
export function useArrangementChat(): ArrangementChatModel {
  const project = useProjectStore((state) => state.project)
  const chat = project.arrangementChat
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [preparedRevision, setPreparedRevision] = useState(0)
  const [retryKey, setRetryKey] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const preparationController = useRef<AbortController | null>(null)

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

  useEffect(() => {
    const controller = new AbortController()
    preparationController.current = controller
    const proposals = (openMessage?.proposals ?? []).filter((proposal) => !proposal.layer && !proposalArrangement(project, proposal))
    setPreparationError(null)
    setPreparing(proposals.length > 0)
    void (async () => {
      try {
        for (const proposal of proposals) {
          const arrangement = await generateRecipeOffThread({ operation: "recipe", project, recipe: proposal.recipe }, controller.signal)
          if (controller.signal.aborted) return
          let cache = proposalArrangementCache.get(project)
          if (!cache) { cache = new Map(); proposalArrangementCache.set(project, cache) }
          cache.set(proposal.id, arrangement)
          setPreparedRevision((value) => value + 1)
        }
      } catch (error) {
        if (!controller.signal.aborted && !isGenerationCancelled(error)) setPreparationError("変更案の音を準備できませんでした。再試行してください。")
      } finally { if (!controller.signal.aborted) setPreparing(false) }
    })()
    return () => controller.abort()
  }, [project, openMessage, retryKey])

  const arrangementFor = (proposal: ArrangementChatProposal) => proposalArrangement(project, proposal)
  const projectFor = (proposal: ArrangementChatProposal) =>
    proposal.layer ? projectWithLayerProposal(project, proposal.layer) : project
  const changesFor = (proposal: ArrangementChatProposal): ArrangementCellChange[] => {
    const arrangement = proposalArrangement(project, proposal)
    return !proposal.layer && !arrangement ? [] : diffArrangementMatrices(matrix, arrangementPartMatrix(projectFor(proposal), arrangement))
  }

  // 表に出す「提案中」の印は、選んでいる案についてだけ求める
  const pendingChanges = useMemo(
    () => selectedProposal && (selectedProposal.layer || proposalArrangement(project, selectedProposal))
      ? diffArrangementMatrices(
          matrix,
          arrangementPartMatrix(
            selectedProposal.layer ? projectWithLayerProposal(project, selectedProposal.layer) : project,
            proposalArrangement(project, selectedProposal),
          ),
        )
      : [],
    [matrix, project, selectedProposal, preparedRevision],
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
    projectFor,
    changesFor,
    preparing,
    preparationError,
    cancelPreparation: () => {
      preparationController.current?.abort()
      setPreparing(false)
      setPreparationError("変更案の準備を中止しました。再試行できます。")
    },
    retryPreparation: () => setRetryKey((value) => value + 1),
  }
}
