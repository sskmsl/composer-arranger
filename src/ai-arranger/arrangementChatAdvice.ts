import {
  ARRANGEMENT_PART_ROWS,
  applyRecipePartRemovals,
  partRowsToKeep,
  partRowsToRemove,
  spliceArrangement,
  withoutPartRows,
  describeArrangementChanges,
  diffArrangementMatrices,
  arrangementPartMatrix,
  currentArrangementVersion,
  projectWithLayerProposal,
  recipeFromArrangement,
  type ArrangementChatProposal,
  type ArrangementChatState,
  type ArrangementRecipe,
} from "@/core/arrangementChat"
import { arrangementSoundInstructionFromText } from "@/core/arrangementIntent"
import type { ArrangementBarRange, ArrangementTimelineConstraints, FullSongArrangement } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { SECTION_ROLE_LABELS } from "@/core/section"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import { finalizeFullSongArrangement, generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { buildAiArrangementContext } from "./context"
import { directionAuditionDirectiveForIntent, directionAuditionSeed } from "./directionAudition"
import { conciseDirectionText, plainDirectionText } from "./directionPresentation"
import { directiveWithTimelineConstraints, parseArrangementTimelineConstraints } from "./timelineConstraints"
import { MAX_AI_CONVERSATION_TURNS } from "./conversation"
import {
  buildLayerProposal,
  COUNTER_MODE_TEXT,
  counterModeFromText,
  layerKindFromText,
  layerLabel,
  layerRemovalFromText,
  removalLayerProposal,
} from "./arrangementLayers"
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
 * 直前に変更案を作ってから現在までの、利用者の発言だけを相談中の依頼文としてまとめる。
 * AIの返答は「抜きすぎない」などを削除指示と誤認しうるため、決定論的な解析には含めない。
 */
export function pendingConsultationUserMessages(
  chat: ArrangementChatState | undefined,
  currentUserMessage: string,
): string[] {
  const messages = chat?.messages ?? []
  let start = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === "assistant" && (message.proposals?.length ?? 0) > 0) {
      start = index + 1
      break
    }
  }
  return [
    ...messages.slice(start).filter((message) => message.role === "user").map((message) => message.text),
    currentUserMessage,
  ].map((text) => text.trim()).filter(Boolean)
}

/** AIへ渡す文脈用。決定論的な解析では pendingConsultationUserMessages を発言単位で使う。 */
export function pendingConsultationRequestText(
  chat: ArrangementChatState | undefined,
  currentUserMessage: string,
): string {
  return pendingConsultationUserMessages(chat, currentUserMessage).join("\n")
}

/**
 * 変更案を適用したときの全曲アレンジ。作り直す範囲が決まっている案は、
 * その範囲だけを新しい音にし、ほかはいまの全曲アレンジのまま残す。
 */
export function arrangementFromRecipe(project: ComposerProject, recipe: ArrangementRecipe): FullSongArrangement {
  const changed = applyRecipePartRemovals(
    withoutPartRows(
      spliceArrangement(project.fullSongArrangement, generateFullSongArrangement(project, recipe), recipe.scopeSectionIds),
      recipe.removeRowIds,
      recipe.scopeSectionIds,
    ),
    recipe.removeRowScopes,
  )
  // 差し替え・除去後の実トラックで品質点を作り直す。削除だけの指示では他パートを勝手に変更しない。
  return finalizeFullSongArrangement(project, changed, {
    refine: !recipe.removeRowIds?.length && !recipe.removeRowScopes?.length,
    ...(recipe.scopeSectionIds?.length ? { editableSectionIds: new Set(recipe.scopeSectionIds) } : {}),
  })
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

function statementMentionsScope(project: ComposerProject, statement: string): boolean {
  if (WHOLE_SONG_WORDS.test(statement)) return true
  return normalizeSectionTimeline(project.sections).some((section) => (
    (section.name.trim().length > 0 && statement.includes(section.name.trim()))
    || statement.includes(SECTION_ROLE_LABELS[section.role])
  ))
}

/** 提案全体の作り直し範囲は、範囲を明記した最後の利用者発言を採用する。 */
function latestProposalScope(
  project: ComposerProject,
  statements: readonly string[],
): string[] | undefined {
  let scope: string[] | undefined
  for (const statement of statements) {
    if (statementMentionsScope(project, statement)) scope = scopeSectionIdsFromText(project, statement, [])
  }
  return scope
}

const PROPOSAL_LABELS = ["案A", "案B", "案C"]

function sameScope(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (!left?.length || !right?.length) return !left?.length && !right?.length
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

function removalsFromStatements(
  project: ComposerProject,
  statements: readonly string[],
): NonNullable<ArrangementRecipe["removeRowScopes"]> {
  const removals = new Map<ReturnType<typeof partRowsToRemove>[number], NonNullable<ArrangementRecipe["removeRowScopes"]>[number]>()
  for (const statement of statements) {
    for (const rowId of partRowsToKeep([statement])) removals.delete(rowId)
    const scopeSectionIds = scopeSectionIdsFromText(project, statement, [])
    for (const rowId of partRowsToRemove([statement])) {
      removals.set(rowId, { rowId, ...(scopeSectionIds ? { scopeSectionIds } : {}) })
    }
  }
  return [...removals.values()]
}

function mergeBarRanges(ranges: readonly ArrangementBarRange[]): ArrangementBarRange[] {
  const sorted = [...ranges].sort((left, right) => left.startBar - right.startBar || left.endBar - right.endBar)
  const merged: ArrangementBarRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.startBar <= previous.endBar + 1) previous.endBar = Math.max(previous.endBar, range.endBar)
    else merged.push({ ...range })
  }
  return merged
}

/** 発言ごとに小節指定を読み、明示的な「やっぱり〜にして」は直前の同種指定を置き換える。 */
function timelineConstraintsFromStatements(
  statements: readonly string[],
  totalBars: number,
  sections: ComposerProject["sections"],
): ArrangementTimelineConstraints {
  let fullSilenceRanges: ArrangementBarRange[] = []
  let melodySilenceRanges: ArrangementBarRange[] = []
  let melodyStartBar: number | undefined
  for (const statement of statements) {
    const isReplacement = /やっぱり|やはり|変更|変えて|修正/.test(statement)
    const normalizedStatement = isReplacement && /無音/.test(statement)
      ? statement.replace(/(\d+\s*[〜～~\-–—]\s*\d+)(?!\d)(?!\s*小節)/g, "$1小節")
      : statement
    let parsed = parseArrangementTimelineConstraints(normalizedStatement, totalBars, sections)
    // 「25〜28小節を無音に」→「やっぱり26〜28小節にして」のように、
    // 後の発言で述語を省略しても、直前の無音指定の変更として扱う。
    if (isReplacement && parsed.fullSilenceRanges.length === 0 && fullSilenceRanges.length > 0 && /\d+\s*[〜～~\-–—]\s*\d+\s*小節/.test(statement)) {
      parsed = parseArrangementTimelineConstraints(`${statement} 完全無音`, totalBars, sections)
    }
    if (parsed.fullSilenceRanges.length > 0) {
      fullSilenceRanges = isReplacement
        ? parsed.fullSilenceRanges
        : mergeBarRanges([...fullSilenceRanges, ...parsed.fullSilenceRanges])
    }
    if (parsed.melodySilenceRanges.length > 0) {
      melodySilenceRanges = isReplacement
        ? parsed.melodySilenceRanges
        : mergeBarRanges([...melodySilenceRanges, ...parsed.melodySilenceRanges])
    }
    if (parsed.melodyStartBar !== undefined) melodyStartBar = parsed.melodyStartBar
  }
  return {
    preserveMelody: true,
    fullSilenceRanges,
    melodySilenceRanges,
    ...(melodyStartBar !== undefined ? { melodyStartBar } : {}),
  }
}

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
  /** 決定論的な解析に使う利用者発言。結合せず発言ごとの範囲・取り消しを保つ。 */
  consultationStatements: readonly string[] = [userMessage],
  onPrepared?: (proposalId: string, arrangement: FullSongArrangement) => void,
): ArrangementChatProposal[] {
  const current = project.fullSongArrangement
  const before = arrangementPartMatrix(project, current)
  const sections = before.map((section) => ({ sectionId: section.sectionId, name: section.name }))
  const totalBars = project.sections.reduce((sum, section) => sum + Math.max(1, section.lengthBars), 0)
  const revision = current ? Math.max(0, ...current.tracks.map((track) => track.generationRevision)) + 1 : 0
  // 対旋律・合いの手の相談は、伴奏パートを作り直さず、その層だけを作る(外す)案にする
  const removal = layerRemovalFromText([userMessage])
  const askedLayer = removal ? null : layerKindFromText([userMessage])
  const currentRecipe = currentArrangementVersion(project.arrangementChat, current)?.recipe
    ?? (current ? recipeFromArrangement(current) : undefined)
  const layerProposal = (
    intent: AiArrangementResponse["intents"][number],
    index: number,
    kind: "counter" | "fill",
  ): ArrangementChatProposal => {
    // セクション範囲は利用者の依頼だけから読む。AIの説明文は決定論的な解析へ混ぜない。
    const scope = latestProposalScope(project, consultationStatements)
    // 対旋律は、言葉で指定がなければ 案A=下で流れる・案B=上で流れる・案C=答える の3通りを出す
    const counterMode = kind === "counter"
      ? counterModeFromText(userMessage) ?? (["flowing-below", "flowing-above", "answer"] as const)[index % 3]
      : undefined
    const layer = removal
      ? removalLayerProposal(project, kind, scope)
      : buildLayerProposal(project, kind, {
          scopeSectionIds: scope,
          seed: directionAuditionSeed(project, response.requestId, intent, index),
          text: `${userMessage}\n${intent.generationBrief}`,
          ...(counterMode ? { counterMode } : {}),
        })
    const after = arrangementPartMatrix(projectWithLayerProposal(project, layer), current)
    const points = [
      ...describeArrangementChanges(diffArrangementMatrices(before, after), sections),
      ...(layer.skipped ?? []).map((item) =>
        `${sections.find((section) => section.sectionId === item.sectionId)?.name ?? ""}：${item.reason}（${layerLabel(kind)}は作れませんでした）`,
      ),
    ]
    const intentMatches = removal === null && (
      (kind === "counter" && intent.generator === "counter") || (kind === "fill" && intent.generator === "decoration")
    )
    return {
      id: `${idPrefix}:${intent.id}`,
      label: PROPOSAL_LABELS[index] ?? `案${index + 1}`,
      title: counterMode && !removal
        ? COUNTER_MODE_TEXT[counterMode].title
        : intentMatches
          ? conciseDirectionText(plainDirectionText(intent.title), 40)
          : `${layerLabel(kind)}を${removal ? "外す" : "足す"}`,
      summary: counterMode && !removal
        ? COUNTER_MODE_TEXT[counterMode].summary
        : intentMatches
          ? conciseDirectionText(plainDirectionText(intent.emotionalFunction || intent.generationBrief), 120)
          : removal
          ? `${layerLabel(kind)}を外して、主旋律と伴奏だけにします。`
          : kind === "counter"
            ? "主旋律の後ろで、答えるように動くもう一本の線を足します。"
            : "主旋律のフレーズの切れ目に、短い合いの手を入れます。",
      points: points.length > 0 ? points : ["いまの版とほとんど変わりません"],
      generator: kind === "counter" ? "counter" : "decoration",
      generationBrief: intent.generationBrief,
      recipe: currentRecipe ?? { brief: "", seed: 0, revision: 0 },
      layer,
    }
  }
  const proposals = response.intents.map((intent, index): ArrangementChatProposal => {
    const kind = removal ?? askedLayer
      ?? (intent.generator === "counter" ? "counter" : intent.generator === "decoration" ? "fill" : null)
    if (kind) return layerProposal(intent, index, kind)
    const brief = [...confirmedConstraints, userMessage, intent.title, intent.generationBrief]
      .filter(Boolean)
      .join("。")
    const analysisStatements = [...confirmedConstraints, ...consultationStatements].filter(Boolean)
    const requestAnalysisText = analysisStatements.join("。")
    const base = directionAuditionDirectiveForIntent(intent)
    const soundInstruction = analysisStatements.reduce(
      (latest, statement) => arrangementSoundInstructionFromText(statement) ?? latest,
      base.soundInstruction,
    )
    const directive = {
      ...directiveWithTimelineConstraints({ ...base, soundInstruction }, requestAnalysisText, totalBars, project.sections),
      timelineConstraints: timelineConstraintsFromStatements(analysisStatements, totalBars, project.sections),
    }
    // 別の入口で決めた小節指定(無音区間など)は、新しい案が指定しない限り引き継ぐ
    const parsedTimeline = directive.timelineConstraints
    const hasParsedTimeline = Boolean(parsedTimeline && (
      parsedTimeline.fullSilenceRanges.length > 0
      || parsedTimeline.melodySilenceRanges.length > 0
      || parsedTimeline.melodyStartBar !== undefined
    ))
    const effectiveDirective = {
      ...directive,
      timelineConstraints: hasParsedTimeline
        ? parsedTimeline
        : current?.plan.directive?.timelineConstraints ?? parsedTimeline,
    }
    const scope = latestProposalScope(project, consultationStatements)
    // 外す指示は発言ごとに範囲を持たせる。後の「残して」は同じ対象の除去を取り消す。
    const removals = removalsFromStatements(project, consultationStatements)
    const legacyRemovals = removals.filter((removal) => sameScope(removal.scopeSectionIds, scope))
    const scopedRemovals = removals.filter((removal) => !sameScope(removal.scopeSectionIds, scope))
    const recipe: ArrangementRecipe = {
      brief,
      directive: effectiveDirective,
      seed: directionAuditionSeed(project, response.requestId, intent, index),
      revision,
      ...(scope ? { scopeSectionIds: scope } : {}),
      ...(legacyRemovals.length > 0 ? { removeRowIds: legacyRemovals.map((removal) => removal.rowId) } : {}),
      ...(scopedRemovals.length > 0 ? { removeRowScopes: scopedRemovals } : {}),
    }
    const prepared = arrangementFromRecipe(project, recipe)
    onPrepared?.(`${idPrefix}:${intent.id}`, prepared)
    const after = arrangementPartMatrix(project, prepared)
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
  // 外す案はどれも同じなので1つにまとめる
  return removal ? proposals.slice(0, 1) : proposals
}
