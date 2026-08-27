import type { ComposerProject } from "@/core/project"
import {
  buildWholeSongDirectionProgram,
  type WholeSongArrangementAction,
  type WholeSongDirectionId,
} from "./wholeSongDirectionPlan"

export interface AiPartnerOrchestrationPlan {
  version: "1.0.0"
  diagnosis: string
  score: number
  energyArc: string
  directionId: WholeSongDirectionId
  directionTitle: string
  constraints: string[]
  feedbackSummary: string
  nextAction: WholeSongArrangementAction | null
  nextActionReason: string
  protect: string[]
  remainingActionCount: number
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function rejectedGenerators(project: ComposerProject): Set<string> {
  const rejected = new Set<string>()
  for (const candidate of project.reactiveLayerCandidates ?? []) {
    if (candidate.reviewState === "rejected") rejected.add(`${candidate.sectionId}:${candidate.kind}`)
  }
  for (const variant of project.melodyVariants) {
    if (variant.reviewState === "rejected") rejected.add(`${variant.sectionId}:melody`)
  }
  return rejected
}

function feedbackFor(project: ComposerProject): string {
  const reactive = project.reactiveLayerCandidates ?? []
  const favorites = reactive.filter((candidate) => candidate.reviewState === "favorite").length
    + project.melodyVariants.filter((candidate) => candidate.reviewState === "favorite").length
  const rejected = reactive.filter((candidate) => candidate.reviewState === "rejected").length
    + project.melodyVariants.filter((candidate) => candidate.reviewState === "rejected").length
  if (favorites === 0 && rejected === 0) return "まだ採用／Reject履歴がないため、曲の構造と制作意図を優先します。"
  return `採用 ${favorites}件・Reject ${rejected}件を次の優先順位へ反映しています。`
}

function priority(
  action: WholeSongArrangementAction,
  selectedSectionId: string | null,
  rejected: Set<string>,
): number {
  let score = action.sectionId === selectedSectionId ? 40 : 0
  if (action.generator === "signature") score += 18
  if (action.generator === "counter") score += 14
  if (action.generator === "decoration") score += 10
  if (action.generator === "accompaniment") score += 6
  if (action.drama === "growing") score += 8
  if (action.drama === "open") score += 5
  // 明示Rejectは「同じGeneratorをもう一度」を現在Section優先より下げる。
  if (rejected.has(`${action.sectionId}:${action.generator}`)) score -= 50
  return score
}

/**
 * AI Partnerの上位判断。実行はせず、確認可能な「次の一手」だけを返す。
 */
export function buildAiPartnerOrchestrationPlan(
  project: ComposerProject,
  selectedSectionId: string | null,
): AiPartnerOrchestrationPlan {
  const constraints = unique([
    project.arrangementDirectorWorkspace?.brief ?? "",
    ...Object.values(project.aiPartnerSessions ?? {}).flatMap(
      (session) => session.confirmedConstraints,
    ),
  ])
  const brief = constraints.join("。")
  const program = buildWholeSongDirectionProgram(project, brief)
  const directionId = project.arrangementDirectorWorkspace?.selectedDirectionId
    ?? program.recommendedDirectionId
  const direction = program.directions.find((candidate) => candidate.id === directionId)
    ?? program.directions[0]
  const rejected = rejectedGenerators(project)
  const available = direction.actions
    .filter((action) => action.status === "available")
    .sort((left, right) => priority(right, selectedSectionId, rejected) - priority(left, selectedSectionId, rejected))
  const nextAction = available[0] ?? null
  const wasRejected = nextAction
    ? rejected.has(`${nextAction.sectionId}:${nextAction.generator}`)
    : false

  return {
    version: "1.0.0",
    diagnosis: program.diagnosis.summary,
    score: program.diagnosis.score,
    energyArc: program.diagnosis.energyArc,
    directionId: direction.id,
    directionTitle: direction.title,
    constraints,
    feedbackSummary: feedbackFor(project),
    nextAction,
    nextActionReason: nextAction
      ? `${selectedSectionId === nextAction.sectionId ? "現在のSectionを優先。" : "曲全体で次に効果が大きいSectionを選択。"}${wasRejected ? "同種のReject履歴はありますが、他に実行可能な役割がないため再提案しています。" : nextAction.statusReason}`
      : "現在の構成には、追加生成より既存候補の試聴・採用判断が優先です。",
    protect: unique([...direction.protect, ...constraints]).slice(0, 8),
    remainingActionCount: available.length,
  }
}
