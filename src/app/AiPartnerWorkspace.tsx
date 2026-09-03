import { useEffect, useMemo, useState } from "react"
import {
  AudioLines,
  ArrowRight,
  Bot,
  CircleCheck,
  Coins,
  Download,
  Lightbulb,
  Layers3,
  LoaderCircle,
  MessageCircle,
  Music2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  Waypoints,
  TriangleAlert,
  X,
} from "lucide-react"
import { rhythmPreviewPlayer } from "@/audio/rhythmPreviewPlayer"
import { AI_AUDIO_ACCEPT, prepareAiAudio } from "@/ai-arranger/audioAnalysis"
import { buildAiArrangementContext } from "@/ai-arranger/context"
import { requestArrangementAdvice } from "@/ai-arranger/client"
import {
  appendConversationTurn,
  conversationContextForSession,
  removeConversationConstraint,
} from "@/ai-arranger/conversation"
import { exportAiRhythmMidi } from "@/ai-arranger/rhythmMidi"
import {
  performancePartForIntent,
} from "@/ai-arranger/generationBridge"
import {
  executeAiArrangementIntent,
  executeArrangementActions,
} from "@/ai-arranger/arrangementActionExecution"
import {
  currentCandidateResultItems,
  wholeSongGenerationResultItems,
  type WholeSongGenerationResultItem,
} from "@/ai-arranger/generationResultNavigation"
import { wholeSongDirectionForAiIntent } from "@/ai-arranger/wholeSongDirectionPlan"
import type {
  AiArrangementIntent,
  AiArrangementResponse,
  AiAudioPayload,
  ArrangementReviewStatus,
  OrchestrationPartPlan,
} from "@/ai-arranger/types"
import { SECTION_ROLE_LABELS } from "@/core/section"
import type { ComposerProject } from "@/core/project"
import type { ArrangementGenerationDirective, ArrangementTrackId } from "@/core/arrangementGeneration"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Pill, SectionCard, Select } from "@/ui/primitives"
import { downloadMidi } from "@/midi/exportMelody"
import type { MainTab } from "./App"
import { AiPartnerControlCenter } from "./AiPartnerControlCenter"

const EXAMPLE_PROMPTS = [
  "コード・メロディ・テンポは維持。Section間のフレーズと、主旋律とは異なる音域・音階感のバックシンセを全曲に提案して",
  "曲全体で余白と残響を守り、サビまで段階的に世界を開いて",
  "主旋律を壊さず、Sectionごとの役割差でサビ前の期待を高めて",
  "音を足しすぎず、全曲を通して必要な第二の顔を設計して",
]

const WHOLE_SONG_SESSION_ID = "__whole_song__"

function arrangementDirectiveForIntent(intent: AiArrangementIntent): ArrangementGenerationDirective {
  const roles: ArrangementTrackId[] = []
  if (intent.generator === "rhythm") roles.push("dr-kick", "dr-snare", "dr-closed-hat", "dr-field-drum")
  if (intent.generator === "accompaniment") roles.push("syn-bass", "syn-pulse")
  if (["counter", "phrase", "signature"].includes(intent.generator)) roles.push("syn-transition-phrase")
  if (["decoration", "signature"].includes(intent.generator)) roles.push("syn-high-glass")
  const description = `${intent.generationBrief} ${intent.soundPalette} ${intent.techniques.join(" ")}`
  if (/string|violin|viola|cello|ストリング/i.test(description)) roles.push("str-cello", "str-viola", "str-violin-2", "str-violin-1")
  if (/bass|低音|ベース/i.test(description)) roles.push("syn-bass")
  if (/pad|パッド|空間/i.test(description)) roles.push("syn-dark-pad")
  return {
    intention: `${intent.emotionalFunction}。${intent.generationBrief}`,
    add: [...new Set(roles)],
    surpriseLevel: intent.creativeRisk === "radical" ? 0.75 : intent.creativeRisk === "bold" ? 0.45 : 0.15,
  }
}

const GENERATOR_LABELS: Record<AiArrangementIntent["generator"], string> = {
  melody: "主旋律",
  phrase: "短いフレーズ",
  signature: "曲の顔",
  counter: "対旋律",
  decoration: "装飾",
  accompaniment: "伴奏パターン",
  rhythm: "ドラムリズム",
  none: "追加しない",
}

export function AiPartnerWorkspace({
  onNavigate,
  initialPrompt,
  onInitialPromptConsumed,
}: {
  onNavigate: (tab: MainTab) => void
  initialPrompt?: string | null
  onInitialPromptConsumed?: () => void
}) {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const selectSection = useProjectStore((state) => state.selectSection)
  const focusCandidateWorkspace = useProjectStore((state) => state.focusCandidateWorkspace)
  const setAiPartnerSession = useProjectStore(
    (state) => state.setAiPartnerSession,
  )
  const setArrangementDirectorWorkspace = useProjectStore(
    (state) => state.setArrangementDirectorWorkspace,
  )
  const setArrangementDirectorClimax = useProjectStore(
    (state) => state.setArrangementDirectorClimax,
  )
  const setArrangementDirectorSectionOverride = useProjectStore(
    (state) => state.setArrangementDirectorSectionOverride,
  )
  const setSectionOrchestrationOverride = useProjectStore(
    (state) => state.setSectionOrchestrationOverride,
  )
  const generateFullSongArrangement = useProjectStore(
    (state) => state.generateFullSongArrangement,
  )
  const [prompt, setPrompt] = useState("")
  const [consultationTarget, setConsultationTarget] = useState<string>("whole-song")
  const [response, setResponse] = useState<AiArrangementResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatingIntentId, setGeneratingIntentId] = useState<string | null>(null)
  const [playingRhythmIntentId, setPlayingRhythmIntentId] = useState<string | null>(null)
  const [audio, setAudio] = useState<AiAudioPayload | null>(null)
  const [preparingAudio, setPreparingAudio] = useState(false)
  const [wholeSongGeneration, setWholeSongGeneration] = useState<{
    intentId: string
    directionTitle: string
    generated: number
    skipped: number
    items: WholeSongGenerationResultItem[]
  } | null>(null)

  useEffect(() => {
    if (!initialPrompt) return
    setPrompt(initialPrompt)
    onInitialPromptConsumed?.()
  }, [initialPrompt, onInitialPromptConsumed])

  const effectiveSectionId =
    selectedSectionId ?? project.sections[0]?.id ?? null
  const isWholeSongConsultation = consultationTarget === "whole-song"
  const section = project.sections.find(
    (candidate) => candidate.id === effectiveSectionId,
  )
  const context = useMemo(
    () =>
      effectiveSectionId
        ? buildAiArrangementContext(
            project,
            effectiveSectionId,
            isWholeSongConsultation ? "whole-song" : "section",
          )
        : null,
    [effectiveSectionId, isWholeSongConsultation, project],
  )
  const sessionId = isWholeSongConsultation
    ? WHOLE_SONG_SESSION_ID
    : effectiveSectionId
  const session = sessionId
    ? project.aiPartnerSessions?.[sessionId]
    : undefined
  const director = context?.arrangementDirector
  const currentDirectorPlan = director?.sections.find(
    (plan) => plan.sectionId === effectiveSectionId,
  )
  const arrangementReview = context?.arrangementReview
  const wholeSongReview = context?.wholeSongArrangementReview
  const orchestrationPlan = context?.orchestration.sections.find(
    (plan) => plan.sectionId === effectiveSectionId,
  )
  const orchestrationReview = context?.orchestrationReview
  const audibleLayerReview = context?.audibleLayerReview

  useEffect(() => {
    setResponse(session?.latestResponse ?? null)
    setError(null)
  }, [effectiveSectionId, project.projectId, session?.latestResponse, session?.updatedAt])

  useEffect(
    () => () => {
      rhythmPreviewPlayer.stop()
    },
    [],
  )

  useEffect(() => {
    rhythmPreviewPlayer.stop()
    setPlayingRhythmIntentId(null)
  }, [effectiveSectionId])

  const submit = async (bypassCache = false, overridePrompt?: string) => {
    if (!context) {
      setError("先にコード進行を持つセクションを選択してください。")
      return
    }
    if (
      isWholeSongConsultation
        ? !context.songSections.some((candidate) => candidate.chords.length > 0)
        : context.chords.length === 0
    ) {
      setError(
        isWholeSongConsultation
          ? "曲全体に解析できるコード進行がありません。"
          : "選択セクションにコード進行がありません。",
      )
      return
    }
    const message = (overridePrompt ?? prompt).trim()
    if (message.length < 3) {
      setError("相談内容を3文字以上入力してください。")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const conversation = conversationContextForSession(session)
      const nextResponse = await requestArrangementAdvice(
          {
            prompt: message,
            context,
            ...(conversation ? { conversation } : {}),
            ...(!session?.turns.length && audio ? { audio } : {}),
          },
          { bypassCache },
      )
      setResponse(nextResponse)
      setWholeSongGeneration(null)
      if (sessionId) {
        setAiPartnerSession(
          sessionId,
          appendConversationTurn(
            sessionId,
            session,
            message,
            nextResponse,
          ),
        )
      }
      if (isWholeSongConsultation) {
        setArrangementDirectorWorkspace({
          brief: [...(session?.turns ?? []).map((turn) => turn.userMessage), message]
            .slice(-4)
            .join("。"),
          selectedDirectionId: null,
        })
      }
      setPrompt("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI相談に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  const selectAudio = async (file: File | undefined) => {
    if (!file) return
    setPreparingAudio(true)
    setError(null)
    try {
      setAudio(await prepareAiAudio(file))
      setResponse(null)
    } catch (reason) {
      setAudio(null)
      setError(reason instanceof Error ? reason.message : "音源を読み込めませんでした。")
    } finally {
      setPreparingAudio(false)
    }
  }

  const generateFromIntent = (intent: AiArrangementIntent) => {
    if (!section) return
    setGeneratingIntentId(intent.id)
    if (isWholeSongConsultation) {
      const instructionBrief = [
        session?.turns.at(-1)?.userMessage ?? "",
        ...(session?.confirmedConstraints ?? []),
      ].filter(Boolean).join("。")
      const { direction } = wholeSongDirectionForAiIntent(project, intent, instructionBrief)
      const availableActions = direction.actions.filter(
        (action) => action.status === "available",
      )
      const result = executeArrangementActions(availableActions)
      generateFullSongArrangement([
        instructionBrief,
        intent.title,
        intent.generationBrief,
        intent.necessityReason ?? intent.why,
      ].filter(Boolean).join("。"), arrangementDirectiveForIntent(intent))
      setWholeSongGeneration({
        intentId: intent.id,
        directionTitle: `${intent.title} → ${direction.title}`,
        generated: result.generatedCount,
        skipped: result.skippedCount,
        items: wholeSongGenerationResultItems(direction.actions, result.results),
      })
      setGeneratingIntentId(null)
      return
    }
    const result = executeAiArrangementIntent(section.id, intent)
    if (result.target) onNavigate(result.target)
    setGeneratingIntentId(null)
  }

  const openWholeSongResult = (item: WholeSongGenerationResultItem) => {
    if (!item.target || item.generator === "none") return
    const current = currentCandidateResultItems(project).find(
      (candidate) =>
        candidate.sectionId === item.sectionId &&
        candidate.generator === item.generator,
    )
    focusCandidateWorkspace(item.sectionId, item.generator, current?.latestBatchId)
    onNavigate(item.target)
  }

  const downloadRhythm = (intent: AiArrangementIntent) => {
    if (!section || !intent.rhythmPlan.enabled) return
    const bytes = exportAiRhythmMidi({
      title: project.title,
      sectionName: section.name,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      sectionLengthBars: section.lengthBars,
      rhythmPlan: intent.rhythmPlan,
      performancePlan: performancePartForIntent(intent, orchestrationPlan) ?? undefined,
    })
    downloadMidi(
      bytes,
      `${project.title}-${section.name}-${intent.title}-drums.mid`,
    )
  }

  const previewRhythm = (intent: AiArrangementIntent) => {
    if (!section || !intent.rhythmPlan.enabled) return
    if (playingRhythmIntentId === intent.id) {
      rhythmPreviewPlayer.stop()
      setPlayingRhythmIntentId(null)
      return
    }
    const started = rhythmPreviewPlayer.play({
      bpm: project.song.tempo,
      timeSignature: project.song.timeSignature,
      rhythmPlan: intent.rhythmPlan,
      performancePlan: performancePartForIntent(intent, orchestrationPlan) ?? undefined,
      onEnded: () => setPlayingRhythmIntentId(null),
    })
    setPlayingRhythmIntentId(started ? intent.id : null)
  }

  const activeMelodyId = section
    ? project.sectionMelodyAssignments[section.id]
    : undefined

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-surface-black px-4 py-5 lg:px-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-12">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-primary-on-dark">
              <Sparkles size={18} />
              <span className="text-[11px] font-medium uppercase tracking-[0.18em]">
                AI Arrangement Partner
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-body-muted">
              ここでは曲を診断し、守るもの・足すもの・全曲の方針を決めます。実音の確認とMIDI書き出しは「結果・書出し」で行います。
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-pill bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-200">
            <ShieldCheck size={14} /> APIキーはSupabase内に保持
          </div>
        </header>

        <div className="grid gap-2 rounded-lg border border-primary/25 bg-primary/[0.045] p-3 text-[11px] sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div><strong className="text-primary-on-dark">AIで方針</strong><span className="ml-2 text-body-muted">診断・相談・方向選択</span></div>
          <span className="hidden text-primary-on-dark sm:inline">→</span>
          <button type="button" onClick={() => onNavigate("arrangement")} className="text-left text-body-muted hover:text-body-on-dark">
            <strong className="text-primary-on-dark">結果・書出し</strong><span className="ml-2">試聴・採用・MIDI</span>
          </button>
        </div>

        <details className="rounded-lg border border-hairline bg-white/[0.015] p-3">
          <summary className="cursor-pointer text-[11px] font-medium text-body-muted hover:text-body-on-dark">
            詳細設定・分析を開く
          </summary>
          <div className="mt-3 flex flex-col gap-4">
          {director && director.sections.length > 0 && (
          <SectionCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
                  <Waypoints size={15} className="text-primary-on-dark" /> 曲全体の流れ
                </div>
                <p className="mt-1 text-[11px] leading-5 text-body-muted">
                  どこを静かにし、どこで広げるかをAIが曲全体から判断しています。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-body-muted">
                  最も盛り上げるSection
                  <Select
                    value={project.arrangementDirectorOverrides?.climaxSectionId ?? "auto"}
                    onChange={(event) =>
                      setArrangementDirectorClimax(
                        event.target.value === "auto" ? null : event.target.value,
                      )
                    }
                    className="!py-1 text-[11px]"
                  >
                    <option value="auto">自動</option>
                    {project.sections.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            </div>
            {wholeSongReview && (
              <div className="mt-3 rounded-sm border border-hairline bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold text-body-on-dark">
                      AIの確認結果
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-body-muted">
                      {wholeSongReview.summary}
                    </p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-1 text-[11px] font-medium ${reviewStatusClass(wholeSongReview.status)}`}>
                    {reviewStatusLabel(wholeSongReview.status)}
                  </span>
                </div>
                {wholeSongReview.findings
                  .filter((finding) => finding.severity !== "pass")
                  .slice(0, 2)
                  .map((finding) => (
                    <p key={finding.id} className="mt-2 text-[11px] leading-4 text-amber-100">
                      • {finding.recommendation}
                    </p>
                  ))}
              </div>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {director.sections.map((plan) => {
                const active = plan.sectionId === effectiveSectionId
                return (
                  <button
                    key={plan.sectionId}
                    type="button"
                    onClick={() => selectSection(plan.sectionId)}
                    className={`min-w-0 rounded-sm border p-3 text-left transition ${active
                      ? "border-primary/60 bg-primary/10"
                      : "border-hairline bg-white/[0.025] hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium text-body-on-dark">
                        {plan.sectionName}
                      </span>
                      <span className="shrink-0 rounded-pill bg-primary/10 px-2 py-0.5 text-[11px] text-primary-on-dark">
                        {energyLabel(plan.targetEnergy)}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-body-muted">
                      {plan.transitionIntent}
                    </div>
                  </button>
                )
              })}
            </div>
            {currentDirectorPlan && (
              <div className="mt-3 space-y-2">
                <div className="grid gap-2 text-[11px] sm:grid-cols-3">
                  <DirectorNote
                    label="ここで加える"
                    value={currentDirectorPlan.introduce.join(" / ")}
                  />
                  <DirectorNote
                    label="まだ使わない"
                    value={currentDirectorPlan.withhold.length > 0
                      ? currentDirectorPlan.withhold.join(" / ")
                      : "クライマックス資源を使用可能"}
                  />
                  <DirectorNote
                    label="次へつなぐ"
                    value={currentDirectorPlan.transitionIntent}
                  />
                </div>
                <details className="rounded-sm border border-hairline bg-white/[0.02] px-3 py-2">
                  <summary className="cursor-pointer text-[11px] text-body-muted hover:text-body-on-dark">
                    このSectionの強さを手動で調整
                  </summary>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1 text-[11px] text-body-muted">
                    強さ
                    <Select
                      value={project.arrangementDirectorOverrides?.sections[effectiveSectionId ?? ""]?.targetEnergy ?? "auto"}
                      disabled={currentDirectorPlan.climaxPolicy === "express"}
                      onChange={(event) =>
                        effectiveSectionId && setArrangementDirectorSectionOverride(
                          effectiveSectionId,
                          {
                            targetEnergy: event.target.value === "auto"
                              ? null
                              : Number(event.target.value) as 1 | 2 | 3 | 4 | 5,
                          },
                        )
                      }
                      className="!py-1 text-[11px]"
                    >
                      <option value="auto">AIに任せる</option>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>E{value}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-body-muted">
                    同時に使う役割数
                    <Select
                      value={project.arrangementDirectorOverrides?.sections[effectiveSectionId ?? ""]?.densityCeiling ?? "auto"}
                      onChange={(event) =>
                        effectiveSectionId && setArrangementDirectorSectionOverride(
                          effectiveSectionId,
                          {
                            densityCeiling: event.target.value === "auto"
                              ? null
                              : Number(event.target.value),
                          },
                        )
                      }
                      className="!py-1 text-[11px]"
                    >
                      <option value="auto">AIに任せる</option>
                      {Array.from(
                        { length: Math.max(1, project.arrangementSettings.maximumParts) },
                        (_, index) => index + 1,
                      ).map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </Select>
                  </label>
                  {currentDirectorPlan.climaxPolicy === "express" && (
                    <span className="text-[11px] text-primary-on-dark">最も盛り上げるSectionは最大で固定</span>
                  )}
                  </div>
                </details>
              </div>
            )}
            {arrangementReview && (
              <div className="mt-4 border-t border-hairline pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
                      {arrangementReview.status === "strong"
                        ? <CircleCheck size={15} className="text-emerald-300" />
                        : <TriangleAlert size={15} className="text-amber-300" />}
                      このSectionの状態
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-body-muted">
                      {arrangementReview.summary}
                    </p>
                  </div>
                  <div className={`rounded-pill px-3 py-1 text-[11px] font-medium ${reviewStatusClass(arrangementReview.status)}`}>
                    {reviewStatusLabel(arrangementReview.status)}
                  </div>
                </div>
                {arrangementReview.findings.some((finding) => finding.severity !== "pass") && (
                  <div className="mt-3 space-y-2">
                    {arrangementReview.findings
                      .filter((finding) => finding.severity !== "pass")
                      .map((finding) => (
                      <div
                        key={finding.id}
                        className="rounded-sm border border-hairline bg-white/[0.025] px-3 py-2"
                      >
                        <p className={`text-[11px] leading-4 ${finding.severity === "blocking"
                          ? "text-red-100"
                          : "text-amber-100"
                        }`}>
                          • {finding.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        )}

          {orchestrationPlan && (
          <SectionCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
                  <Layers3 size={15} className="text-primary-on-dark" /> 楽器と演奏の役割
                </div>
                <p className="mt-1 max-w-3xl text-[11px] leading-5 text-body-muted">
                  {orchestrationPlan.performanceArc}
                </p>
              </div>
            </div>
            {orchestrationReview && orchestrationReview.findings.some((finding) => finding.severity !== "pass") && (
              <div className="mt-3 rounded-sm border border-hairline bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-body-on-dark">
                      {orchestrationReview.status === "strong"
                        ? <CircleCheck size={14} className="text-emerald-300" />
                        : <TriangleAlert size={14} className={orchestrationReview.status === "revise" ? "text-red-300" : "text-amber-200"} />}
                      楽器の重なりで確認が必要です
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-body-muted">
                      {orchestrationReview.summary}
                    </p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-1 text-[11px] font-medium ${reviewStatusClass(orchestrationReview.status)}`}>
                    {reviewStatusLabel(orchestrationReview.status)}
                  </span>
                </div>
                {orchestrationReview.findings.some((finding) => finding.severity !== "pass") && (
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    {orchestrationReview.findings
                      .filter((finding) => finding.severity !== "pass")
                      .slice(0, 2)
                      .map((finding) => (
                        <div key={finding.id} className="rounded-sm bg-white/[0.04] px-3 py-2">
                          <p className={finding.severity === "blocking" ? "text-[11px] leading-4 text-red-100" : "text-[11px] leading-4 text-amber-100"}>
                            • {finding.recommendation}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            {audibleLayerReview && audibleLayerReview.findings.some((finding) => finding.severity !== "pass") && (
              <div className="mt-3 rounded-sm border border-hairline bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-body-on-dark">
                      {audibleLayerReview.status === "strong"
                        ? <CircleCheck size={14} className="text-emerald-300" />
                        : <AudioLines size={14} className={audibleLayerReview.status === "revise" ? "text-red-300" : "text-amber-200"} />}
                      音の重なりで確認が必要です
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-body-muted">
                      {audibleLayerReview.summary}
                    </p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-1 text-[11px] font-medium ${reviewStatusClass(audibleLayerReview.status)}`}>
                    {reviewStatusLabel(audibleLayerReview.status)}
                  </span>
                </div>
                {audibleLayerReview.findings.some((finding) => finding.severity !== "pass") && (
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    {audibleLayerReview.findings
                      .filter((finding) => finding.severity !== "pass")
                      .slice(0, 2)
                      .map((finding) => (
                        <div key={finding.id} className="rounded-sm bg-white/[0.04] px-3 py-2">
                          <p className={finding.severity === "blocking" ? "text-[11px] leading-4 text-red-100" : "text-[11px] leading-4 text-amber-100"}>
                            • {finding.recommendation}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {orchestrationPlan.parts.map((part) => {
                const override = effectiveSectionId
                  ? project.sectionOrchestrationOverrides?.[effectiveSectionId]?.[part.role]
                  : undefined
                return (
                <div
                  key={part.id}
                  className="min-w-0 rounded-sm border border-hairline bg-white/[0.025] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-medium text-body-on-dark">
                      {orchestrationRoleLabel(part.role)} · {orchestrationFamilyLabel(part.family)}
                    </div>
                    <span className={`rounded-pill px-2 py-0.5 text-[11px] ${part.sourceState === "active"
                      ? "bg-emerald-400/10 text-emerald-200"
                      : "bg-primary/10 text-primary-on-dark"
                    }`}>
                      {part.sourceState === "active" ? "現在使用中" : "導入候補"}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-body-muted">
                    <strong className="text-body-on-dark">役割：</strong>{part.purpose}
                  </p>
                  {part.role !== "intentional-silence" && effectiveSectionId && (
                    <details className="mt-2 border-t border-hairline pt-2">
                      <summary className="cursor-pointer text-[11px] text-primary-on-dark">
                        演奏の詳細・調整{override ? " · 固定あり" : ""}
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Tag>{part.register}</Tag>
                        <Tag>{orchestrationDistanceLabel(part.distance)}</Tag>
                        <Tag>{part.articulation}</Tag>
                        <Tag>{part.dynamic}</Tag>
                        <Tag>{part.timing}</Tag>
                      </div>
                      <p className="mt-2 text-[11px] leading-4 text-body-muted">
                        登場：{part.entry}　退場：{part.exit}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-muted-48">
                        Velocity {part.velocityRange[0]}–{part.velocityRange[1]}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                        <OrchestrationOverrideSelect
                          label="Family"
                          value={override?.family ?? "auto"}
                          options={[
                            ["lead-voice", "Lead Voice"], ["piano-keys", "Piano / Keys"],
                            ["strings", "Strings"], ["analog-synth", "Analog Synth"],
                            ["atmospheric-pad", "Atmospheric Pad"], ["mallet-bell", "Mallet / Bell"],
                            ["percussion", "Percussion"],
                          ]}
                          onChange={(value) => setSectionOrchestrationOverride(
                            effectiveSectionId,
                            part.role,
                            { family: value === "auto" ? null : value as OrchestrationPartPlan["family"] },
                          )}
                        />
                        <OrchestrationOverrideSelect
                          label="距離"
                          value={override?.distance ?? "auto"}
                          options={[["intimate", "最前景"], ["near", "近景"], ["middle", "中景"], ["distant", "遠景"]]}
                          onChange={(value) => setSectionOrchestrationOverride(
                            effectiveSectionId,
                            part.role,
                            { distance: value === "auto" ? null : value as OrchestrationPartPlan["distance"] },
                          )}
                        />
                        <OrchestrationOverrideSelect
                          label="奏法"
                          value={override?.articulation ?? "auto"}
                          options={["legato", "sustained", "pulsed", "detached", "swelling", "decaying"].map((value) => [value, value])}
                          onChange={(value) => setSectionOrchestrationOverride(
                            effectiveSectionId,
                            part.role,
                            { articulation: value === "auto" ? null : value as OrchestrationPartPlan["articulation"] },
                          )}
                        />
                        <OrchestrationOverrideSelect
                          label="Dynamic"
                          value={override?.dynamic ?? "auto"}
                          options={["pp", "p", "mp", "mf", "f"].map((value) => [value, value])}
                          onChange={(value) => setSectionOrchestrationOverride(
                            effectiveSectionId,
                            part.role,
                            { dynamic: value === "auto" ? null : value as OrchestrationPartPlan["dynamic"] },
                          )}
                        />
                        <OrchestrationOverrideSelect
                          label="Timing"
                          value={override?.timing ?? "auto"}
                          options={["strict", "slightly-ahead", "slightly-behind", "floating"].map((value) => [value, value])}
                          onChange={(value) => setSectionOrchestrationOverride(
                            effectiveSectionId,
                            part.role,
                            { timing: value === "auto" ? null : value as OrchestrationPartPlan["timing"] },
                          )}
                        />
                        <button
                          type="button"
                          className="self-end rounded-sm border border-hairline px-2 py-1.5 text-[11px] text-body-muted hover:text-body-on-dark"
                          onClick={() => setSectionOrchestrationOverride(effectiveSectionId, part.role, null)}
                        >
                          すべてAutoへ戻す
                        </button>
                      </div>
                    </details>
                  )}
                </div>
                )
              })}
            </div>
            {orchestrationPlan.withheldGestures.length > 0 && (
              <div className="mt-3 rounded-sm border border-dashed border-hairline px-3 py-2 text-[11px] leading-4 text-body-muted">
                <strong className="text-primary-on-dark">このSectionでは温存：</strong>
                {orchestrationPlan.withheldGestures.join(" / ")}
              </div>
            )}
          </SectionCard>
          )}
          </div>
        </details>

        <SectionCard>
          <div className="mb-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
              <MessageCircle size={15} className="text-primary-on-dark" /> {session?.turns.length ? "AIと制作意図を詰める" : "まずAIへ制作意図を伝える"}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-body-muted">
              コード・メロディ・テンポなど守るものと、追加したい役割を自然な言葉で指定してください。標準では曲全体を通して判断します。
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <label className="flex flex-col gap-1.5 text-[11px] text-body-muted">
              相談範囲
              <Select
                value={consultationTarget}
                onChange={(event) => {
                  const value = event.target.value
                  setConsultationTarget(value)
                  setWholeSongGeneration(null)
                  if (value !== "whole-song") selectSection(value || null)
                }}
              >
                <option value="whole-song">曲全体（標準）</option>
                {project.sections.length === 0 && <option value="">セクションなし</option>}
                {project.sections.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    このSectionだけ: {candidate.name} · {SECTION_ROLE_LABELS[candidate.role]}
                  </option>
                ))}
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
              <ContextStat
                label={isWholeSongConsultation ? "セクション" : "コード"}
                value={isWholeSongConsultation
                  ? `${context?.songSections.length ?? 0}件`
                  : `${context?.chords.length ?? 0}件`}
              />
              <ContextStat
                label={isWholeSongConsultation ? "主旋律の設定" : "採用中の主旋律"}
                value={isWholeSongConsultation
                  ? `${context?.songSections.filter((item) => item.activeMelody.present).length ?? 0}セクション`
                  : context?.activeMelody.present
                    ? `${context.activeMelody.noteCount}音`
                    : "なし"}
              />
              <ContextStat label="曲の方向性" value={context?.project.songProfile ?? "—"} />
              <ContextStat
                label="長さ"
                value={isWholeSongConsultation
                  ? `${project.sections.reduce((sum, item) => sum + item.lengthBars, 0)}小節`
                  : section
                    ? `${section.lengthBars}小節`
                    : "—"}
              />
            </div>
          </div>

          {session && session.turns.length > 0 && (
            <div className="mt-4 rounded-lg border border-hairline bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-body-on-dark">
                  <MessageCircle size={14} className="text-primary-on-dark" />
                  {isWholeSongConsultation ? "この曲全体の相談履歴" : "このSectionの相談履歴"}
                </div>
                <button
                  type="button"
                  className="text-[11px] text-ink-muted-48 hover:text-body-on-dark"
                  onClick={() => {
                    if (sessionId) setAiPartnerSession(sessionId, null)
                    setResponse(null)
                    setPrompt("")
                  }}
                >
                  履歴をリセット
                </button>
              </div>
              <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                {session.turns.slice(-6).map((turn) => (
                  <div key={turn.id} className="space-y-1.5">
                    <div className="ml-auto max-w-[90%] rounded-lg bg-primary/12 px-3 py-2 text-[11px] leading-5 text-body-on-dark">
                      {turn.userMessage}
                    </div>
                    <div className="mr-auto max-w-[92%] rounded-lg bg-white/[0.06] px-3 py-2 text-[11px] leading-5 text-body-muted">
                      {turn.partnerReply}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="mt-4 flex flex-col gap-1.5 text-[11px] text-body-muted">
            {session?.turns.length ? "追加質問・方向修正" : "何を相談しますか？"}
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={1500}
              rows={4}
              placeholder={session?.turns.length
                ? isWholeSongConsultation
                  ? "例：全曲でメロディは変えず、Aメロは抑えてサビだけ開いて。ベルは使わないで"
                  : "例：メロディは変えず、Direction 2をもっと不穏に。ベルは使わないで"
                : isWholeSongConsultation
                  ? "例：曲全体を通して余白を守り、Sectionごとに役割を変えながらサビへ向かう3案がほしい"
                  : "例：このSectionに、余白を残しながら次へつながるフレーズがほしい"}
              className="resize-y rounded-lg border border-hairline bg-surface-tile-2 px-3 py-2.5 text-[14px] leading-6 text-body-on-dark outline-none placeholder:text-ink-muted-48 focus:border-primary-focus"
            />
          </label>
          {!session?.turns.length && <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <Pill key={example} onClick={() => setPrompt(example)} className="!text-[11px]">
                {example}
              </Pill>
            ))}
          </div>}
          {!session?.turns.length && <div className="mt-4 rounded-lg border border-dashed border-hairline bg-white/[0.025] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-medium text-body-on-dark">
                  <AudioLines size={15} className="text-primary-on-dark" /> 音源を聴かせる
                </div>
                <p className="mt-1 text-[11px] leading-4 text-ink-muted-48">
                  Logic Pro等から書き出したMP3/WAV・12MB以下。解析時だけ送信し、保存しません。
                </p>
              </div>
              {!audio && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border border-primary px-3.5 py-2 text-[12px] text-primary-on-dark transition hover:bg-primary/10">
                  <Upload size={14} /> {preparingAudio ? "音源を準備中…" : "音源を選択"}
                  <input
                    type="file"
                    accept={AI_AUDIO_ACCEPT}
                    disabled={preparingAudio || busy}
                    className="sr-only"
                    onChange={(event) => void selectAudio(event.target.files?.[0])}
                  />
                </label>
              )}
            </div>
            {audio && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-sm bg-primary/8 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-body-on-dark">{audio.fileName}</p>
                  <p className="text-[11px] text-body-muted">
                    {formatDuration(audio.localFeatures.durationSeconds)} · {(audio.sizeBytes / 1024 / 1024).toFixed(1)}MB
                    {" · "}実音を含めて分析
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="添付音源を外す"
                  className="shrink-0 rounded-full p-1.5 text-body-muted hover:bg-white/10 hover:text-body-on-dark"
                  onClick={() => {
                    setAudio(null)
                    setResponse(null)
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </div>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void submit(false)}
              disabled={busy || preparingAudio || prompt.trim().length < 3 || !context}
            >
              {busy ? <LoaderCircle className="animate-spin" size={15} /> : <Bot size={15} />}
              {busy
                ? "楽曲を分析中…"
                : session?.turns.length
                  ? "続きを相談"
                  : audio
                    ? isWholeSongConsultation
                      ? "音源を聴いて全曲3案を相談"
                      : "音源を聴いて3案を相談"
                    : isWholeSongConsultation
                      ? "AIに全曲3案を相談"
                      : "AIに3案を相談"}
            </Button>
            <span className="text-[11px] text-ink-muted-48">
              同じ楽曲状態・同じ相談は24時間キャッシュされます
            </span>
          </div>
          {error && (
            <p className="mt-3 rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-200">
              {error}
            </p>
          )}
        </SectionCard>

        {response && (
          <>
            <SectionCard>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
                    <Lightbulb size={15} className="text-primary-on-dark" /> 現状診断
                  </div>
                  <p className="text-[13px] leading-6 text-body-muted">
                    {response.diagnosis.currentStrength}
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-body-on-dark">
                    {response.diagnosis.primaryOpportunity}
                  </p>
                </div>
                <div className="w-full rounded-sm border border-primary/20 bg-primary/8 px-3 py-2 sm:w-auto sm:min-w-[15rem]">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary-on-dark">
                    <Coins size={13} /> 今回のAI利用料
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-body-on-dark">
                    {response.cached
                      ? "キャッシュ利用・追加費用なし"
                      : `概算 $${response.usage.estimatedCostUsd.toFixed(4)}`}
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-ink-muted-48">
                    {response.model}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DiagnosisList title="守るもの" items={response.diagnosis.protect} />
                <DiagnosisList title="避けるもの" items={response.diagnosis.avoid} />
              </div>
              {(session?.confirmedConstraints.length ?? 0) > 0 && (
                <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-primary-on-dark">
                    会話で確定した制約
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {session?.confirmedConstraints.map((constraint) => (
                      <span key={constraint} className="inline-flex items-center gap-1 rounded-pill bg-white/8 px-2.5 py-1 text-[11px] text-body-muted">
                        {constraint}
                        <button
                          type="button"
                          aria-label={`${constraint}を解除`}
                          className="rounded-full p-0.5 hover:bg-white/10 hover:text-body-on-dark"
                          onClick={() => {
                            if (!sessionId || !session) return
                            setAiPartnerSession(
                              sessionId,
                              removeConversationConstraint(session, constraint),
                            )
                          }}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {response.diagnosis.noAdditionRecommended && (
                <p className="mt-3 rounded-sm bg-amber-300/10 px-3 py-2 text-[12px] text-amber-100">
                  {isWholeSongConsultation
                    ? "曲全体では、音を追加しないSectionを残す案も有力と診断されています。"
                    : "このSectionは、音を追加しない案も有力と診断されています。"}
                </p>
              )}
              {(response.diagnosis.audioEvidence ?? []).length > 0 && (
                <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-primary-on-dark">
                    <AudioLines size={13} /> 音源から聴き取った根拠
                  </div>
                  <ul className="mt-1 space-y-1 text-[11px] leading-5 text-body-muted">
                    {(response.diagnosis.audioEvidence ?? []).map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                  <p className="mt-1 text-[11px] text-ink-muted-48">
                    {response.diagnosis.audioConfidenceNote ?? "音源解析は編曲判断の補助情報です。"}
                  </p>
                </div>
              )}
            </SectionCard>

            <div className="grid gap-4 xl:grid-cols-3">
              {response.intents.map((intent, index) => {
                const counterUnavailable =
                  intent.generator === "counter" && !activeMelodyId
                const noGenerator = intent.generator === "none"
                const proposalOnly = intent.generator === "rhythm"
                return (
                  <SectionCard key={intent.id} className="flex h-full flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-primary-on-dark">
                          方向 {index + 1}
                        </span>
                        <h2 className="mt-1 text-[15px] font-semibold text-body-on-dark">
                          {intent.title}
                        </h2>
                      </div>
                      <span className="rounded-pill bg-white/8 px-2.5 py-1 text-[11px] text-body-muted">
                        {GENERATOR_LABELS[intent.generator]}
                      </span>
                    </div>
                    <p className="mt-3 text-[12px] leading-5 text-body-muted">
                      {intent.emotionalFunction}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Tag>{intent.density}</Tag>
                      <Tag>{intent.register}</Tag>
                      <Tag>{intent.rhythmCharacter}</Tag>
                      <Tag>{intent.silenceStrategy}</Tag>
                      <Tag>{intent.creativeRisk}</Tag>
                      <span
                        className={`rounded-pill px-2 py-1 text-[11px] ${
                          intent.approach === "surprise-tension"
                            ? "bg-fuchsia-300/15 text-fuchsia-100"
                            : "bg-emerald-300/10 text-emerald-100"
                        }`}
                      >
                        {intent.approach === "surprise-tension"
                          ? "意外性・緊張"
                          : "安定"}
                      </span>
                    </div>
                    <p className="mt-3 text-[12px] leading-5 text-body-on-dark">
                      {intent.generationBrief}
                    </p>
                    {intent.generator === "accompaniment" &&
                      intent.accompanimentPatternId !== "none" && (
                        <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-body-muted">
                          <strong className="text-primary-on-dark">提案するリズム：</strong>
                          {accompanimentPatternName(
                            project,
                            intent.accompanimentPatternId,
                          )}
                        </div>
                      )}
                    {intent.generator === "rhythm" && intent.rhythmPlan.enabled && (
                      <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] leading-5 text-body-muted">
                        <div className="font-medium text-primary-on-dark">
                          {intent.rhythmPlan.subdivision} · {intent.rhythmPlan.feel}
                        </div>
                        <div className="mt-1"><strong className="text-body-on-dark">Kick：</strong>{intent.rhythmPlan.kickPattern}</div>
                        <div><strong className="text-body-on-dark">Snare：</strong>{intent.rhythmPlan.snarePattern}</div>
                        <div><strong className="text-body-on-dark">Hat：</strong>{intent.rhythmPlan.hatPattern}</div>
                        {intent.rhythmPlan.percussionPattern && (
                          <div><strong className="text-body-on-dark">Perc：</strong>{intent.rhythmPlan.percussionPattern}</div>
                        )}
                        <div className="mt-1 text-ink-muted-48">{intent.rhythmPlan.variation}</div>
                      </div>
                    )}
                    <div className="mt-3 rounded-sm bg-white/[0.04] p-3 text-[11px] leading-5 text-body-muted">
                      <strong className="text-body-on-dark">音色：</strong>
                      {intent.soundPalette}
                      <br />
                      <strong className="text-body-on-dark">演奏：</strong>
                      {intent.performanceDirection}
                    </div>
                    {intent.soundSourceSuggestions.length > 0 && (
                      <div className="mt-3 rounded-sm border border-white/8 bg-white/[0.025] p-3">
                        <span className="text-[11px] uppercase tracking-wide text-primary-on-dark">
                          おすすめ音源（手持ちライブラリ）
                        </span>
                        {intent.soundSourceSuggestions.slice(0, 2).map((source) => (
                          <div key={`${source.product}-${source.character}`} className="mt-2 text-[11px] leading-5 text-body-muted">
                            <div className="font-medium text-body-on-dark">{source.product}</div>
                            <div>{source.family} · {source.character}</div>
                            <div className="text-ink-muted-48">検索語：{source.searchTerms.join(" / ")}</div>
                            <div className="text-ink-muted-48">{source.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-3 text-[11px] leading-5 text-ink-muted-48">
                      {intent.necessityReason ?? intent.why}
                    </p>
                    <div className="mt-auto pt-4">
                      {isWholeSongConsultation && (
                        <Button
                          variant="secondary"
                          className="w-full !whitespace-normal text-center"
                          disabled={generatingIntentId === intent.id}
                          onClick={() => generateFromIntent(intent)}
                        >
                          <Layers3 size={14} /> この案を全曲へ展開・生成
                        </Button>
                      )}
                      {!isWholeSongConsultation && !noGenerator && !proposalOnly && (
                        <Button
                          variant="secondary"
                          className="w-full !whitespace-normal text-center"
                          disabled={counterUnavailable || generatingIntentId === intent.id}
                          onClick={() => generateFromIntent(intent)}
                        >
                          <Music2 size={14} /> この案を生成
                        </Button>
                      )}
                      {!isWholeSongConsultation && proposalOnly && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              variant="secondary"
                              className="w-full"
                              disabled={intent.rhythmPlan.events.length === 0}
                              onClick={() => previewRhythm(intent)}
                            >
                              {playingRhythmIntentId === intent.id
                                ? <Square size={14} />
                                : <Play size={14} />}
                              {playingRhythmIntentId === intent.id ? "停止" : "まず試聴"}
                            </Button>
                            <Button
                              variant="ghost"
                              className="w-full"
                              disabled={intent.rhythmPlan.events.length === 0}
                              onClick={() => downloadRhythm(intent)}
                            >
                              <Download size={14} /> MIDI
                            </Button>
                          </div>
                          <p className="mt-2 text-center text-[11px] leading-4 text-body-muted">
                            試聴は提案ループを一度だけ再生します。MIDIはセクション長まで反復し、Logic ProでSoftware Instrumentへ割り当てられるChannel 1で出力します。
                          </p>
                        </>
                      )}
                      {!isWholeSongConsultation && counterUnavailable && (
                        <p className="mt-2 text-[11px] text-amber-200">
                          Counter生成にはActive Melodyが必要です。
                        </p>
                      )}
                    </div>
                  </SectionCard>
                )
              })}
            </div>

            {wholeSongGeneration && (
              <SectionCard className="border-emerald-300/25 bg-emerald-400/[0.05]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold text-body-on-dark">
                      全曲候補をSection別に生成しました
                    </div>
                    <p className="mt-1 text-[11px] text-emerald-100">
                      {wholeSongGeneration.directionTitle} · {wholeSongGeneration.generated}件生成
                      {wholeSongGeneration.skipped > 0
                        ? ` · ${wholeSongGeneration.skipped}件保留`
                        : ""}
                    </p>
                  </div>
                  <span className="rounded-pill bg-white/8 px-2.5 py-1 text-[11px] text-body-muted">
                    自動採用なし
                  </span>
                </div>
                <div className="mt-3 rounded-sm border border-primary/20 bg-primary/[0.06] p-3">
                  <p className="text-[11px] leading-4 text-body-muted">
                    同じ意図からEnergy Curveと役割別MIDIも生成しました。Melodyとコードは保護したままです。
                  </p>
                  <Button className="mt-2" variant="secondary" onClick={() => onNavigate("arrangement")}>
                    <Layers3 size={14} /> Arrangement Planとパート別MIDIを確認
                  </Button>
                </div>
                <div className="mt-3 space-y-1.5">
                  {wholeSongGeneration.items.map((item) => (
                    <div
                      key={item.actionId}
                      className="grid gap-2 rounded-sm border border-white/10 bg-black/10 px-3 py-2 sm:grid-cols-[7rem_8rem_minmax(0,1fr)_auto] sm:items-center"
                    >
                      <span className="text-[11px] font-semibold text-body-on-dark">{item.sectionName}</span>
                      <span className="text-[11px] text-primary-on-dark">{GENERATOR_LABELS[item.generator]}</span>
                      <div className="text-[11px] leading-4 text-body-muted">
                        <span className="text-body-on-dark">
                          {item.status === "candidate"
                            ? "候補生成済み"
                            : item.status === "applied"
                              ? "Sectionへ適用済み"
                              : item.status === "existing"
                                ? "現在案を維持"
                                : item.status === "preserved"
                                  ? "追加なし"
                                  : item.status === "unavailable"
                                    ? "要件不足"
                                    : "生成保留"}
                        </span>
                        <div>{item.purpose}</div>
                      </div>
                      {item.target && (
                        <Button variant="secondary" onClick={() => openWholeSongResult(item)}>
                          {item.status === "candidate" ? `${GENERATOR_LABELS[item.generator]}候補を確認・試聴` : "Sectionを確認"}
                          <ArrowRight size={14} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            <div className="flex justify-center">
              <Button
                variant="ghost"
                onClick={() => void submit(
                  true,
                  session?.turns.at(-1)?.userMessage,
                )}
                disabled={busy}
              >
                <RefreshCw size={14} /> キャッシュを使わず別の3案を相談
              </Button>
            </div>
          </>
        )}

        <details className="rounded-lg border border-hairline bg-white/[0.015] p-3">
          <summary className="cursor-pointer text-[11px] font-medium text-body-muted hover:text-body-on-dark">
            指示なしの自動診断・5方針も見る
          </summary>
          <div className="mt-3">
            <AiPartnerControlCenter onNavigate={onNavigate} />
          </div>
        </details>

        <p className="text-center text-[11px] leading-5 text-ink-muted-48">
          固有の楽曲を複製せず、相談内容を余白・輪郭・リズム・音色・演奏意図へ抽象化して提案します。
        </p>
      </div>
    </main>
  )
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}

function accompanimentPatternName(
  project: ComposerProject,
  patternId: string,
): string {
  return project.accompanimentPatterns.find((pattern) => pattern.id === patternId)?.name
    ?? patternId
}

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] text-ink-muted-48">{label}</div>
      <div className="mt-0.5 truncate text-[12px] text-body-on-dark">{value}</div>
    </div>
  )
}

function DiagnosisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink-muted-48">{title}</div>
      <ul className="mt-1 space-y-1 text-[11px] leading-5 text-body-muted">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-pill border border-hairline px-2 py-0.5 text-[11px] text-body-muted">
      {children}
    </span>
  )
}

function energyLabel(value: number): string {
  if (value >= 5) return "最も強い"
  if (value === 4) return "強い"
  if (value === 3) return "中間"
  if (value === 2) return "控えめ"
  return "静か"
}

function DirectorNote({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-primary-on-dark">{label}</div>
      <div className="mt-1 break-words leading-5 text-body-muted">{value}</div>
    </div>
  )
}

function reviewStatusLabel(status: ArrangementReviewStatus): string {
  return {
    pending: "レビュー待ち",
    strong: "設計と整合",
    watch: "要確認",
    revise: "修正推奨",
  }[status]
}

function reviewStatusClass(status: ArrangementReviewStatus): string {
  if (status === "strong") return "bg-emerald-400/10 text-emerald-200"
  if (status === "revise") return "bg-red-400/10 text-red-200"
  if (status === "watch") return "bg-amber-300/10 text-amber-100"
  return "bg-white/8 text-body-muted"
}

function OrchestrationOverrideSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[][]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-ink-muted-48">
      {label}
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 !py-1 text-[11px]"
      >
        <option value="auto">Auto</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </Select>
    </label>
  )
}

function orchestrationRoleLabel(role: OrchestrationPartPlan["role"]): string {
  return {
    "lead-focus": "主役",
    "harmonic-space": "和声空間",
    "pulse-foundation": "周期と推進",
    "counter-voice": "第二の声",
    "transition-color": "場面転換",
    "intentional-silence": "意図的な無音",
  }[role]
}

function orchestrationFamilyLabel(family: OrchestrationPartPlan["family"]): string {
  return {
    "lead-voice": "Lead Voice",
    "piano-keys": "Piano / Keys",
    strings: "Strings",
    "analog-synth": "Analog Synth",
    "atmospheric-pad": "Atmospheric Pad",
    "mallet-bell": "Mallet / Bell",
    percussion: "Percussion",
    silence: "Silence",
  }[family]
}

function orchestrationDistanceLabel(
  distance: OrchestrationPartPlan["distance"],
): string {
  return {
    intimate: "最前景",
    near: "前景",
    middle: "中景",
    distant: "遠景",
  }[distance]
}
