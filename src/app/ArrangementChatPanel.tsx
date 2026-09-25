import { useEffect, useId, useMemo, useRef, useState } from "react"
import { clsx } from "clsx"
import { ArrowLeft, ArrowUp, Check, LoaderCircle, Play, Square, Undo2 } from "lucide-react"
import { previewPlayer } from "@/audio/previewPlayer"
import { requestArrangementAdvice } from "@/ai-arranger/client"
import {
  arrangementChatContext,
  arrangementChatConversation,
  proposalsFromResponse,
} from "@/ai-arranger/arrangementChatAdvice"
import { plainDirectionText } from "@/ai-arranger/directionPresentation"
import {
  entriesInMonth,
  formatTokens,
  formatUsd,
  OPENAI_USAGE_URL,
  readAiUsage,
  recordAiUsage,
  summarizeAiUsage,
} from "@/ai-arranger/usageLog"
import {
  describeArrangementChanges,
  type ArrangementCellChange,
  type ArrangementChatMessage,
  type ArrangementChatProposal,
} from "@/core/arrangementChat"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { songTempoChanges } from "@/core/tempoMap"
import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"
import type { ArrangementChatModel } from "./useArrangementChat"
import type { ComposerProject } from "@/core/project"

const FIRST_SUGGESTIONS = [
  "サビでメロディの後ろに対旋律を流したい",
  "フレーズの切れ目に合いの手を入れたい",
  "全体を聴いて、気になる所を教えて",
  "Aメロはもっと静かにして、サビとの差をつけたい",
]

const ANOTHER_PROPOSAL = "別の案もほしい"
const FOLLOW_UP_SUGGESTIONS = ["理由をもっと詳しく", ANOTHER_PROPOSAL, "ほかに気になる所は？"]

type ListenKey = `${string}:${"before" | "after"}`

/**
 * アレンジ相談チャット。形になった曲について会話し、AIの提案を変更案カードとして受け取る。
 * 変更案は実際に作った全曲アレンジと、いまの版の違いを示し、変更前/変更後を聴き比べてから適用できる。
 */
export function ArrangementChatPanel({
  model,
  initialInput = "",
  onClose,
  className,
}: {
  model: ArrangementChatModel
  /** ほかの画面から渡された相談の文面 */
  initialInput?: string
  onClose?: () => void
  className?: string
}) {
  const { project } = model
  const chat = project.arrangementChat
  const messages = chat?.messages ?? []
  const appendMessages = useProjectStore((state) => state.appendArrangementChatMessages)
  const applyProposal = useProjectStore((state) => state.applyArrangementChatProposal)
  const dismissProposals = useProjectStore((state) => state.dismissArrangementChatProposals)
  const restoreVersion = useProjectStore((state) => state.restoreArrangementVersion)
  const resetConversation = useProjectStore((state) => state.resetArrangementChatConversation)
  const [input, setInput] = useState(initialInput)
  useEffect(() => {
    if (initialInput) setInput(initialInput)
  }, [initialInput])
  const [sendingText, setSendingText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState<ListenKey | null>(null)
  const listenRunRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  // PCの横パネルとスマホの全画面が同時に存在しうるので、入力欄のIDはパネルごとに分ける
  const inputId = useId()
  const [usageOpen, setUsageOpen] = useState(false)
  // 使用量の記録は端末(localStorage)にあるので、相談のたびに読み直す
  const [usageEntries, setUsageEntries] = useState(() => readAiUsage())
  const monthUsage = useMemo(() => summarizeAiUsage(entriesInMonth(usageEntries)), [usageEntries])
  const chatUsage = summarizeAiUsage(
    messages.flatMap((message) => (message.usage ? [{ at: message.createdAt, ...message.usage }] : [])),
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, sendingText])

  useEffect(() => () => {
    listenRunRef.current += 1
    previewPlayer.stop()
  }, [])

  const send = async (raw: string) => {
    const text = raw.trim()
    if (text.length < 3 || sendingText) return
    const latest = useProjectStore.getState().project
    const context = arrangementChatContext(latest, model.versionLabel)
    if (!context) {
      setError("相談するには、先にセクションとコード進行を用意してください。")
      return
    }
    setError(null)
    setSendingText(text)
    setInput("")
    try {
      const response = await requestArrangementAdvice({
        prompt: text,
        context,
        ...(arrangementChatConversation(latest.arrangementChat)
          ? { conversation: arrangementChatConversation(latest.arrangementChat) }
          : {}),
      })
      const current = useProjectStore.getState().project
      const now = new Date().toISOString()
      const replyId = `reply:${response.requestId}:${now}`
      const proposals = proposalsFromResponse(current, response, text, response.confirmedConstraints, replyId)
      const reply: ArrangementChatMessage = {
        id: replyId,
        role: "assistant",
        createdAt: now,
        text: plainDirectionText(response.partnerReply),
        proposals,
        usage: {
          costUsd: response.cached ? 0 : response.usage.estimatedCostUsd,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cached: Boolean(response.cached),
        },
      }
      recordAiUsage({ at: now, ...reply.usage! })
      setUsageEntries(readAiUsage())
      appendMessages(
        [{ id: `user:${now}`, role: "user", createdAt: now, text }, reply],
        response.confirmedConstraints,
      )
      model.selectProposal(proposals[0]?.id ?? "")
    } catch (reason) {
      setInput(text)
      setError(reason instanceof Error ? reason.message : "AI相談に失敗しました。")
    } finally {
      setSendingText(null)
    }
  }

  const stopListening = () => {
    listenRunRef.current += 1
    previewPlayer.stop()
    setListening(null)
  }

  /** 変化のあるセクションだけを、変更前/変更後の全曲アレンジで鳴らす */
  const listen = (
    key: ListenKey,
    arrangement: FullSongArrangement | undefined,
    changes: ArrangementCellChange[],
    /** 対旋律・合いの手の案では、その層を付けた曲で鳴らす */
    target: ComposerProject = project,
  ) => {
    if (listening === key) {
      stopListening()
      return
    }
    const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
    const touched = model.matrix.filter((section) => changes.some((change) => change.sectionId === section.sectionId))
    const sections = touched.length > 0 ? touched : model.matrix
    if (sections.length === 0) return
    const range = {
      startBeat: (sections[0].startBar - 1) * beatsPerBar,
      endBeat: sections[sections.length - 1].endBar * beatsPerBar,
    }
    const material = buildSongPlaybackMaterial(target, arrangement?.plan.directive?.timelineConstraints)
    const importedSource = project.sourceImport?.type === "midi"
    const runId = listenRunRef.current + 1
    listenRunRef.current = runId
    setListening(key)
    previewPlayer.play({
      bpm: project.song.tempo,
      tempoChanges: songTempoChanges(project),
      chords: importedSource ? [] : material.chords,
      melody: material.melody,
      accompaniment: importedSource ? material.importedBacking : material.accompanimentPattern,
      arrangementTracks: arrangement?.tracks.filter((track) => !track.muted) ?? [],
      reactive: material.reactiveLayers,
      mode: "active-context-reactive",
      range,
      onEnded: () => {
        if (listenRunRef.current === runId) setListening(null)
      },
    })
  }

  const apply = (message: ArrangementChatMessage, proposal: ArrangementChatProposal) => {
    stopListening()
    applyProposal(message.id, proposal.id, model.arrangementFor(proposal))
  }

  /** 適用した版の1つ前の版へ戻す */
  const undoApplied = (versionId: string) => {
    const versions = chat?.versions ?? []
    const index = versions.findIndex((version) => version.id === versionId)
    if (index > 0) restoreVersion(versions[index - 1].id)
  }

  /**
   * 「別の案もほしい」: 返事に付いてきた、まだ見ていない案があればそれを出す(AIへ聞き直さない)。
   * 最後の案まで見たら、AIに新しく頼む。
   */
  const askAnother = () => {
    const open = model.openMessage
    const proposals = open?.proposals ?? []
    const index = proposals.findIndex((proposal) => proposal.id === model.selectedProposal?.id)
    if (open && index >= 0 && index < proposals.length - 1) {
      stopListening()
      model.selectProposal(proposals[index + 1].id)
      return
    }
    void send(ANOTHER_PROPOSAL)
  }

  const suggestions = messages.length === 0 ? FIRST_SUGGESTIONS : FOLLOW_UP_SUGGESTIONS

  return (
    <section aria-label="アレンジ相談" className={clsx("flex min-h-0 flex-col bg-[#0e0e10]", className)}>
      <div className="flex items-start gap-2 border-b border-hairline px-4 py-3">
        {onClose && (
          <button
            type="button"
            aria-label="相談を閉じる"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/6 text-body-on-dark hover:bg-white/12"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="mr-auto min-w-0">
          <h2 className="text-[15px] font-semibold text-body-on-dark">アレンジ相談</h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">主旋律とコードは変えずに相談します · いま: {model.versionLabel}</p>
          <button
            type="button"
            aria-expanded={usageOpen}
            onClick={() => setUsageOpen((value) => !value)}
            className="mt-1 text-[12px] text-primary-on-dark hover:underline"
          >
            AIの使用量：今月 {monthUsage.requests}回・{formatUsd(monthUsage.costUsd)}
          </button>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="shrink-0 rounded-pill border border-hairline px-3 py-1.5 text-[13px] text-body-muted hover:text-body-on-dark"
            onClick={() => {
              if (window.confirm("これまでの会話を消して、新しく相談を始めますか？（版の履歴は残ります）")) resetConversation()
            }}
          >
            新しい相談
          </button>
        )}
      </div>

      {usageOpen && (
        <div className="border-b border-hairline bg-white/[0.03] px-4 py-3 text-[13px] leading-6 text-body-muted">
          <div className="grid grid-cols-[auto_1fr] gap-x-3">
            <span className="text-ink-soft">この会話</span>
            <span className="text-body-on-dark">
              {chatUsage.requests}回・{formatUsd(chatUsage.costUsd)}・入力 {formatTokens(chatUsage.inputTokens)}／出力 {formatTokens(chatUsage.outputTokens)} トークン
            </span>
            <span className="text-ink-soft">今月（この端末）</span>
            <span className="text-body-on-dark">
              {monthUsage.requests}回・{formatUsd(monthUsage.costUsd)}・入力 {formatTokens(monthUsage.inputTokens)}／出力 {formatTokens(monthUsage.outputTokens)} トークン
              {monthUsage.cachedRequests > 0 ? `（うち${monthUsage.cachedRequests}回は同じ相談の再利用で利用料なし）` : ""}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-ink-soft">
            金額はアプリが受け取った概算です。請求の正確な金額は
            <a href={OPENAI_USAGE_URL} target="_blank" rel="noreferrer" className="mx-1 text-primary-on-dark underline">OpenAIの利用状況ページ</a>
            で確認できます。
          </p>
        </div>
      )}

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !sendingText && (
          <div className="rounded-lg border border-hairline bg-white/[0.03] p-3 text-[13px] leading-6 text-body-muted">
            {model.project.fullSongArrangement
              ? "いまの全曲アレンジを見ながら、直したい所を言葉で相談できます。メロディの後ろに流す対旋律や、フレーズの切れ目の合いの手も頼めます（「サビに弦で対旋律を」など）。AIの提案は「変更案」として1つずつ届き、変更前と変更後を聴き比べてから適用できます。適用した結果は版として残り、いつでも戻せます。"
              : "まず全曲の方向を選んで全曲アレンジを作ると、それを土台に相談できます。いきなり「こんな感じにしたい」と伝えて始めることもできます。"}
          </div>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <p
              key={message.id}
              className="max-w-[86%] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-primary/30 px-3 py-2 text-[13px] leading-6 text-body-on-dark"
            >
              {message.text}
            </p>
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              model={model}
              isOpen={model.openMessage?.id === message.id}
              listening={listening}
              versionNumber={chat?.versions.find((version) => version.id === message.appliedVersionId)?.number}
              isCurrentVersion={Boolean(message.appliedVersionId) && chat?.currentVersionId === message.appliedVersionId}
              onListen={listen}
              onApply={(proposal) => apply(message, proposal)}
              onDismiss={() => dismissProposals(message.id)}
              onUndo={() => message.appliedVersionId && undoApplied(message.appliedVersionId)}
              onNextProposal={(proposalId) => {
                stopListening()
                model.selectProposal(proposalId)
              }}
            />
          ),
        )}
        {sendingText && (
          <>
            <p className="max-w-[86%] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-primary/30 px-3 py-2 text-[13px] leading-6 text-body-on-dark">
              {sendingText}
            </p>
            <p className="flex items-center gap-2 text-[13px] text-body-muted">
              <LoaderCircle size={14} className="animate-spin" /> いまの全曲アレンジを見て考えています…
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-hairline px-4 pb-4 pt-3">
        {error && (
          <p role="alert" className="rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
            {error}
          </p>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={Boolean(sendingText)}
              onClick={() => (suggestion === ANOTHER_PROPOSAL ? askAnother() : void send(suggestion))}
              className="shrink-0 rounded-pill bg-white/6 px-3 py-1.5 text-[13px] text-body-muted hover:bg-white/12 hover:text-body-on-dark disabled:opacity-40"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2 rounded-2xl border border-white/15 bg-surface-tile-1 py-1.5 pl-3 pr-1.5 focus-within:border-primary-focus"
          onSubmit={(event) => {
            event.preventDefault()
            void send(input)
          }}
        >
          <label htmlFor={inputId} className="sr-only">相談内容</label>
          <textarea
            id={inputId}
            value={input}
            rows={2}
            maxLength={1500}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // 変換中のEnterは確定に使うので、送信は Ctrl/⌘+Enter
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send(input)
              }
            }}
            placeholder="例：アウトロは余韻を残して、ピアノだけで終わらせたい"
            className="min-h-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-6 text-body-on-dark outline-none placeholder:text-ink-soft"
          />
          <button
            type="submit"
            aria-label="送信"
            disabled={input.trim().length < 3 || Boolean(sendingText)}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary disabled:opacity-35"
          >
            {sendingText ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </form>
        <p className="text-[12px] leading-5 text-ink-soft">
          <span className="hidden sm:inline">Ctrl/⌘+Enterで送信。</span>送る内容：曲の構成・コード・各パートの要約とこの会話（音源は送りません）
        </p>
      </div>
    </section>
  )
}

function AssistantMessage({
  message,
  model,
  isOpen,
  listening,
  versionNumber,
  isCurrentVersion,
  onListen,
  onApply,
  onDismiss,
  onUndo,
  onNextProposal,
}: {
  message: ArrangementChatMessage
  model: ArrangementChatModel
  isOpen: boolean
  listening: ListenKey | null
  versionNumber: number | undefined
  isCurrentVersion: boolean
  onListen: (key: ListenKey, arrangement: FullSongArrangement | undefined, changes: ArrangementCellChange[], target?: ComposerProject) => void
  onApply: (proposal: ArrangementChatProposal) => void
  onDismiss: () => void
  onUndo: () => void
  onNextProposal: (proposalId: string) => void
}) {
  const proposals = message.proposals ?? []
  const applied = proposals.find((proposal) => proposal.id === message.appliedProposalId)
  const shown = applied ?? (isOpen ? model.selectedProposal : null)
  const shownIndex = shown ? Math.max(0, proposals.findIndex((proposal) => proposal.id === shown.id)) : 0
  // 開いている案は、いまの版と実際に作った全曲アレンジを比べた変化を表示する
  const changes = isOpen && shown ? model.pendingChanges : []
  const points = isOpen && shown
    ? [
        ...describeArrangementChanges(changes, model.matrix.map((section) => ({ sectionId: section.sectionId, name: section.name }))),
        // 対旋律を作れなかったセクション(主旋律がない等)の理由も添える
        ...(shown.layer?.skipped ?? []).map((item) =>
          `${model.matrix.find((section) => section.sectionId === item.sectionId)?.name ?? ""}：${item.reason}（${shown.layer!.kind === "counter" ? "対旋律" : "合いの手"}は作れませんでした）`,
        ),
      ]
    : shown?.points ?? []

  return (
    <div className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap text-[13px] leading-7 text-[#e8e8ea]">{message.text}</p>
      {message.usage && (
        <p className="text-[12px] text-ink-soft">
          {message.usage.cached
            ? "同じ相談の再利用（利用料なし）"
            : `AI利用 ${formatUsd(message.usage.costUsd)}（入力 ${formatTokens(message.usage.inputTokens)}・出力 ${formatTokens(message.usage.outputTokens)} トークン）`}
        </p>
      )}
      {proposals.length > 0 && (applied || isOpen) && shown && (
        <div
          className={clsx(
            "flex flex-col gap-2.5 rounded-xl border bg-surface-tile-3 p-3",
            applied ? "border-hairline" : "border-amber-300/45",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-body-on-dark">変更案</span>
            <span
              className={clsx(
                "ml-auto rounded-pill px-2 py-0.5 text-[12px]",
                applied ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-300/15 text-amber-200",
              )}
            >
              {applied ? `適用済み${versionNumber ? ` · 版 ${versionNumber}` : ""}` : "提案中"}
            </span>
          </div>
          <p className="text-[13px] font-medium text-body-on-dark">{shown.title}</p>
          {shown.summary && <p className="text-[13px] leading-5 text-body-muted">{shown.summary}</p>}
          <p className="text-[12px] text-ink-soft">
            {shown.layer
              ? (() => {
                  // 対旋律・合いの手の案は伴奏パートを変えず、その層だけを付ける(外す)
                  const ids = new Set([
                    ...shown.layer.candidates.map((candidate) => candidate.sectionId),
                    ...(shown.layer.removeSectionIds ?? []),
                  ])
                  const names = model.matrix.filter((section) => ids.has(section.sectionId)).map((section) => section.name).join("・")
                  const label = shown.layer.kind === "counter" ? "対旋律" : "合いの手"
                  return names
                    ? `${label}を${shown.layer.candidates.length > 0 ? "付ける" : "外す"}所：${names}（伴奏パートはいまの版のまま）`
                    : `${label}を付けられるセクションがありません`
                })()
              : <>
                  作り直す範囲：
                  {shown.recipe.scopeSectionIds?.length
                    ? model.matrix
                        .filter((section) => shown.recipe.scopeSectionIds!.includes(section.sectionId))
                        .map((section) => section.name)
                        .join("・") + "（ほかはいまの版のまま）"
                    : "曲全体"}
                </>}
          </p>
          <ul className="flex flex-col gap-1 text-[13px] leading-5 text-body-on-dark">
            {(points.length > 0 ? points : ["いまの版とほとんど変わりません"]).map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {!applied && (
            <div className="flex flex-wrap gap-1.5">
              <Button onClick={() => onApply(shown)}>
                <Check size={13} /> 適用する
              </Button>
              <Button
                variant="dark"
                onClick={() => onListen(`${shown.id}:before`, model.project.fullSongArrangement, changes)}
              >
                {listening === `${shown.id}:before` ? <><Square size={12} /> 停止</> : <><Play size={12} /> 変更前を聴く</>}
              </Button>
              <Button
                variant="dark"
                onClick={() => onListen(`${shown.id}:after`, model.arrangementFor(shown), changes, model.projectFor(shown))}
              >
                {listening === `${shown.id}:after` ? <><Square size={12} /> 停止</> : <><Play size={12} /> 変更後を聴く</>}
              </Button>
              {proposals.length > 1 && (
                <button
                  type="button"
                  onClick={() => onNextProposal(proposals[(shownIndex + 1) % proposals.length].id)}
                  className="px-2 text-[13px] text-primary-on-dark hover:underline"
                >
                  別の案にする（{shownIndex + 1}/{proposals.length}）
                </button>
              )}
              <button type="button" onClick={onDismiss} className="px-2 text-[13px] text-ink-soft hover:text-body-on-dark">
                やめる
              </button>
            </div>
          )}
          {applied && isCurrentVersion && (
            <button
              type="button"
              onClick={onUndo}
              className="flex items-center gap-1 self-start text-[13px] text-primary-on-dark hover:underline"
            >
              <Undo2 size={12} /> 元に戻す
            </button>
          )}
        </div>
      )}
      {proposals.length > 0 && !applied && !isOpen && (
        <p className="text-[12px] text-ink-soft">
          {message.dismissed ? "この変更案は見送りました" : "新しい相談があるため、この変更案は閉じました"}
        </p>
      )}
    </div>
  )
}
