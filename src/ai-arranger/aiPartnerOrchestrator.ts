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

function existingArrangementAdvice(project: ComposerProject, sectionId: string | null, brief: string): string | null {
  if (!sectionId || !project.fullSongArrangement) return null
  // 具体的な役割を指名された依頼は尊重する。「何か足したい」だけでは追加の根拠にしない。
  const forbidsAddition = /(追加しない|追加せず|入れない|増やさない|追加は不要|追加を控え)/.test(brief)
  const namedAddition = !forbidsAddition && /(?:対旋律|カウンター|装飾|ベル|ストリングス|弦|ベース|キック|ハイハット|パッド).{0,12}(?:追加|入れ|生成)|(?:追加|入れ|生成).{0,12}(?:対旋律|カウンター|装飾|ベル|ストリングス|弦|ベース|キック|ハイハット|パッド)/.test(brief)
  if (namedAddition) return null
  const support = project.fullSongArrangement.tracks.filter((track) =>
    !track.muted && !track.id.startsWith("dr-") && track.notes.some((note) => note.sectionId === sectionId))
  const availableSupport = Math.max(1, Math.round(project.arrangementSettings.maximumParts) - 2)
  if (support.length < availableSupport) return null
  const removable = ["syn-stabs", "syn-pulse", "str-viola", "str-violin-1", "syn-high-glass", "syn-transition-phrase", "str-cello", "syn-dark-pad"]
    .map((id) => support.find((track) => track.id === id))
    .find(Boolean)
  return removable
    ? `このSectionは伴奏が${support.length}役割あります。新しいトラックの前に「${removable.name}」を一度ミュートし、主旋律と低音の輪郭が強くなるか試聴してください。`
    : `このSectionは伴奏が${support.length}役割あります。新しいトラックを足さず、現在の主旋律・ベース・余白を先に試聴してください。`
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
  const subtractionAdvice = existingArrangementAdvice(project, selectedSectionId, brief)
  const rejected = rejectedGenerators(project)
  const available = direction.actions
    .filter((action) => action.status === "available")
    .sort((left, right) => priority(right, selectedSectionId, rejected) - priority(left, selectedSectionId, rejected))
  const nextAction = subtractionAdvice ? null : available[0] ?? null
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
      : subtractionAdvice ?? "現在の密度・余白では追加を控え、既存候補の試聴・採用判断を優先します。",
    protect: unique([...direction.protect, ...constraints]).slice(0, 8),
    remainingActionCount: subtractionAdvice ? 0 : available.length,
  }
}
