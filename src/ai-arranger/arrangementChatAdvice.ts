import {
  ARRANGEMENT_PART_ROWS,
  partRowsToRemove,
  spliceArrangement,
  withoutPartRows,
  describeArrangementChanges,
  diffArrangementMatrices,
  arrangementPartMatrix,
  type ArrangementChatProposal,
  type ArrangementChatState,
  type ArrangementRecipe,
} from "@/core/arrangementChat"
import { arrangementSoundInstructionFromText } from "@/core/arrangementIntent"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { SECTION_ROLE_LABELS } from "@/core/section"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { buildAiArrangementContext } from "./context"
import { directionAuditionDirectiveForIntent, directionAuditionSeed } from "./directionAudition"
import { conciseDirectionText, plainDirectionText } from "./directionPresentation"
import { directiveWithTimelineConstraints } from "./timelineConstraints"
import { MAX_AI_CONVERSATION_TURNS } from "./conversation"
import type {
  AiArrangementContext,
  AiArrangementGenerator,
  AiArrangementResponse,
  AiConversationContext,
  AiCurrentArrangementSummary,
} from "./types"

/** いま鳴っている全曲アレンジの要約(AIへ渡す) */
export function currentArrangementSummary(
  project: ComposerProject,
  versionLabel: string,
): AiCurrentArrangementSummary {
  return {
    versionLabel,
    sections: arrangementPartMatrix(project, project.fullSongArrangement).map((section) => ({
      sectionId: section.sectionId,
      sectionName: section.name,
      bars: `${section.startBar}-${section.endBar}`,
      hasMelody: section.hasMelody,
      parts: ARRANGEMENT_PART_ROWS.filter((row) => section.cells[row.id].noteCount > 0).map((row) => ({
        part: row.label,
        notesPerBar: Math.round(section.cells[row.id].notesPerBar * 10) / 10,
      })),
    })),
  }
}

/** 曲全体の相談用コンテキストに、いまの全曲アレンジの中身を加える */
export function arrangementChatContext(
  project: ComposerProject,
  versionLabel: string,
): AiArrangementContext | null {
  const firstSection = normalizeSectionTimeline(project.sections)[0]
  if (!firstSection) return null
  const context = buildAiArrangementContext(project, firstSection.id, "whole-song")
  if (!context) return null
  return { ...context, currentArrangement: currentArrangementSummary(project, versionLabel) }
}

/** チャットの履歴を、AIへ渡す会話の形にする。適用した案もAIが分かるよう返事に添える */
export function arrangementChatConversation(chat: ArrangementChatState | undefined): AiConversationContext | undefined {
  if (!chat) return undefined
  const turns: AiConversationContext["turns"] = []
  for (let index = 0; index < chat.messages.length; index += 1) {
    const user = chat.messages[index]
    const reply = chat.messages[index + 1]
    if (user.role !== "user" || reply?.role !== "assistant") continue
    const applied = reply.proposals?.find((proposal) => proposal.id === reply.appliedProposalId)
    turns.push({
      userMessage: user.text,
      partnerReply: applied ? `${reply.text}\n（利用者はこのうち「${applied.title}」を適用した）` : reply.text,
      confirmedConstraints: chat.confirmedConstraints,
      directions: (reply.proposals ?? []).map((proposal) => ({
        title: proposal.title,
        generator: proposal.generator as AiArrangementGenerator,
        emotionalFunction: proposal.summary,
        generationBrief: proposal.generationBrief,
      })),
    })
    index += 1
  }
  if (turns.length === 0) return undefined
  return { confirmedConstraints: chat.confirmedConstraints, turns: turns.slice(-MAX_AI_CONVERSATION_TURNS) }
}

/**
 * 変更案を適用したときの全曲アレンジ。作り直す範囲が決まっている案は、
 * その範囲だけを新しい音にし、ほかはいまの全曲アレンジのまま残す。
 */
export function arrangementFromRecipe(project: ComposerProject, recipe: ArrangementRecipe): FullSongArrangement {
  return withoutPartRows(
    spliceArrangement(project.fullSongArrangement, generateFullSongArrangement(project, recipe), recipe.scopeSectionIds),
    recipe.removeRowIds,
    recipe.scopeSectionIds,
  )
}

const WHOLE_SONG_WORDS = /曲全体|全体を通|全曲|曲全部|全部のセクション|全セクション/

/**
 * 相談文とAIの案から、作り直すセクションを決める。セクション名や「サビ」「Aメロ」などの役割名が
 * 出てくればそのセクションだけ、何も出てこないか「曲全体」と言われたら曲全体(undefined)。
 * 「大サビ」が「サビ」にも当たらないよう、長い名前から順に照合して当たった部分は消していく。
 */
export function scopeSectionIdsFromText(
  project: ComposerProject,
  userMessage: string,
  proposalTexts: string[],
): string[] | undefined {
  if (WHOLE_SONG_WORDS.test(userMessage)) return undefined
  const sections = normalizeSectionTimeline(project.sections)
  const candidates = sections.flatMap((section) => [
    { sectionId: section.id, word: section.name.trim() },
    { sectionId: section.id, word: SECTION_ROLE_LABELS[section.role] },
  ]).filter((candidate) => candidate.word.length > 0)
  let text = [userMessage, ...proposalTexts].join("\n")
  const matched = new Set<string>()
  const words = [...new Set(candidates.map((candidate) => candidate.word))].sort((a, b) => b.length - a.length)
  for (const word of words) {
    if (!text.includes(word)) continue
    for (const candidate of candidates) if (candidate.word === word) matched.add(candidate.sectionId)
    text = text.split(word).join(" ")
  }
  if (matched.size === 0 || matched.size === sections.length) return undefined
  return sections.filter((section) => matched.has(section.id)).map((section) => section.id)
}

const PROPOSAL_LABELS = ["案A", "案B", "案C"]

/**
 * AIの3案を、全曲アレンジの生成条件と、いまの版からの具体的な変化を持つ変更案にする。
 * 変化は実際に生成した全曲アレンジを比べて求めるので、説明と音が食い違わない。
 */
export function proposalsFromResponse(
  project: ComposerProject,
  response: AiArrangementResponse,
  userMessage: string,
  confirmedConstraints: string[],
  /** 返事ごとに一意な接頭辞。同じ相談がキャッシュから返っても、案と版のIDが重ならないようにする */
  idPrefix: string = response.requestId,
): ArrangementChatProposal[] {
  const current = project.fullSongArrangement
  const before = arrangementPartMatrix(project, current)
  const sections = before.map((section) => ({ sectionId: section.sectionId, name: section.name }))
  const totalBars = project.sections.reduce((sum, section) => sum + Math.max(1, section.lengthBars), 0)
  const revision = current ? Math.max(0, ...current.tracks.map((track) => track.generationRevision)) + 1 : 0
  return response.intents.map((intent, index) => {
    const brief = [...confirmedConstraints, userMessage, intent.title, intent.generationBrief]
      .filter(Boolean)
      .join("。")
    const base = directionAuditionDirectiveForIntent(intent)
    const directive = directiveWithTimelineConstraints(
      { ...base, soundInstruction: arrangementSoundInstructionFromText(brief) ?? base.soundInstruction },
      brief,
      totalBars,
    )
    // 別の入口で決めた小節指定(無音区間など)は、新しい案が指定しない限り引き継ぐ
    const effectiveDirective = {
      ...directive,
      timelineConstraints: directive.timelineConstraints ?? current?.plan.directive?.timelineConstraints,
    }
    const targetSectionId = intent.soundInstruction?.targetSectionId
    const scope = scopeSectionIdsFromText(project, userMessage, [
      intent.title,
      intent.generationBrief,
      ...(targetSectionId ? [project.sections.find((section) => section.id === targetSectionId)?.name ?? ""] : []),
    ])
    // 外す指示は利用者の言葉だけから読む(AIの説明文の「抜きすぎない」などを誤って拾わない)
    const removeRowIds = partRowsToRemove([userMessage])
    const recipe: ArrangementRecipe = {
      brief,
      directive: effectiveDirective,
      seed: directionAuditionSeed(project, response.requestId, intent, index),
      revision,
      ...(scope ? { scopeSectionIds: scope } : {}),
      ...(removeRowIds.length > 0 ? { removeRowIds } : {}),
    }
    const after = arrangementPartMatrix(project, arrangementFromRecipe(project, recipe))
    const points = describeArrangementChanges(diffArrangementMatrices(before, after), sections)
    return {
      id: `${idPrefix}:${intent.id}`,
      label: PROPOSAL_LABELS[index] ?? `案${index + 1}`,
      title: conciseDirectionText(plainDirectionText(intent.title), 40),
      summary: conciseDirectionText(plainDirectionText(intent.emotionalFunction || intent.generationBrief), 120),
      points: points.length > 0 ? points : ["いまの版とほとんど変わりません"],
      generator: intent.generator,
      generationBrief: intent.generationBrief,
      recipe,
    }
  })
}
