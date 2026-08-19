import { useEffect, useMemo, useState } from "react"
import {
  AudioLines,
  Bot,
  CircleCheck,
  Coins,
  Download,
  Lightbulb,
  Layers3,
  LoaderCircle,
  MessageCircle,
  Music2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  Waypoints,
  TriangleAlert,
  X,
} from "lucide-react"
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
  decorationSettingsForIntent,
  performancePartForIntent,
  phraseLengthForIntent,
  signatureLengthForIntent,
  signatureDirectionForIntent,
  targetTabForIntent,
} from "@/ai-arranger/generationBridge"
import type {
  AiArrangementIntent,
  AiArrangementResponse,
  AiAudioPayload,
  ArrangementDirectorClimaxPolicy,
  ArrangementDirectorFunction,
  ArrangementReviewStatus,
  OrchestrationPartPlan,
} from "@/ai-arranger/types"
import { SECTION_ROLE_LABELS } from "@/core/section"
import type { ComposerProject } from "@/core/project"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Pill, SectionCard, Select } from "@/ui/primitives"
import { downloadMidi } from "@/midi/exportMelody"
import type { MainTab } from "./App"

const EXAMPLE_PROMPTS = [
  "余白と残響で世界を開く、記憶に残るイントロを提案して",
  "主旋律を壊さず、サビ前の期待を高める演出がほしい",
  "音を足しすぎず、このセクションに必要な第二の顔を考えて",
]

const GENERATOR_LABELS: Record<AiArrangementIntent["generator"], string> = {
  melody: "Melody",
  phrase: "Phrase",
  signature: "Signature",
  counter: "Counter",
  decoration: "Decoration",
  accompaniment: "Rhythm Pattern",
  rhythm: "Drum Rhythm",
  none: "追加しない",
}

export function AiPartnerWorkspace({
  onNavigate,
}: {
  onNavigate: (tab: MainTab) => void
}) {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const selectSection = useProjectStore((state) => state.selectSection)
  const setGenerationSettings = useProjectStore(
    (state) => state.setGenerationSettings,
  )
  const generateForSection = useProjectStore((state) => state.generateForSection)
  const generatePhrases = useProjectStore(
    (state) => state.generatePhrasesForSection,
  )
  const generateSignature = useProjectStore(
    (state) => state.generateSignaturePhrasesForSection,
  )
  const generateCounter = useProjectStore(
    (state) => state.generateCounterForSection,
  )
  const generateDecorations = useProjectStore(
    (state) => state.generateDecorationsForSection,
  )
  const setSectionAccompanimentPattern = useProjectStore(
    (state) => state.setSectionAccompanimentPattern,
  )
  const setAiPartnerSession = useProjectStore(
    (state) => state.setAiPartnerSession,
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
  const applyPerformanceToLatestGeneration = useProjectStore(
    (state) => state.applyPerformanceToLatestGeneration,
  )
  const [prompt, setPrompt] = useState("")
  const [response, setResponse] = useState<AiArrangementResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatingIntentId, setGeneratingIntentId] = useState<string | null>(null)
  const [audio, setAudio] = useState<AiAudioPayload | null>(null)
  const [preparingAudio, setPreparingAudio] = useState(false)

  const effectiveSectionId =
    selectedSectionId ?? project.sections[0]?.id ?? null
  const section = project.sections.find(
    (candidate) => candidate.id === effectiveSectionId,
  )
  const context = useMemo(
    () =>
      effectiveSectionId
        ? buildAiArrangementContext(project, effectiveSectionId)
        : null,
    [effectiveSectionId, project],
  )
  const session = effectiveSectionId
    ? project.aiPartnerSessions?.[effectiveSectionId]
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

  const submit = async (bypassCache = false, overridePrompt?: string) => {
    if (!context) {
      setError("先にコード進行を持つセクションを選択してください。")
      return
    }
    if (context.chords.length === 0) {
      setError("選択セクションにコード進行がありません。")
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
      if (effectiveSectionId) {
        setAiPartnerSession(
          effectiveSectionId,
          appendConversationTurn(
            effectiveSectionId,
            session,
            message,
            nextResponse,
          ),
        )
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
    const before = useProjectStore.getState()
    setGeneratingIntentId(intent.id)
    setGenerationSettings({
      density: intent.density,
      rangePreset: intent.register,
      drama: intent.drama,
    })
    if (intent.generator === "melody") {
      generateForSection(section.id)
    } else if (intent.generator === "phrase") {
      const length = phraseLengthForIntent(intent, section.lengthBars)
      if (length) generatePhrases(section.id, length)
    } else if (intent.generator === "signature") {
      generateSignature(
        section.id,
        signatureLengthForIntent(intent, section.lengthBars),
        signatureDirectionForIntent(intent),
      )
    } else if (intent.generator === "counter") {
      generateCounter(section.id)
    } else if (intent.generator === "decoration") {
      generateDecorations(section.id, decorationSettingsForIntent(intent))
    } else if (
      intent.generator === "accompaniment" &&
      intent.accompanimentPatternId !== "none"
    ) {
      setSectionAccompanimentPattern(
        section.id,
        intent.accompanimentPatternId,
      )
    }
    const after = useProjectStore.getState()
    const generatedNewBatch =
      intent.generator === "melody"
        ? after.activeBatchId !== before.activeBatchId
        : intent.generator === "phrase"
          ? after.activePhraseBatchId !== before.activePhraseBatchId
          : intent.generator === "signature"
            ? after.activeSignaturePhraseBatchId !== before.activeSignaturePhraseBatchId
            : intent.generator === "counter" || intent.generator === "decoration"
              ? after.activeReactiveBatchId !== before.activeReactiveBatchId
              : intent.generator === "accompaniment"
    const performancePart = performancePartForIntent(intent, orchestrationPlan)
    if (
      generatedNewBatch &&
      performancePart &&
      intent.generator !== "rhythm" &&
      intent.generator !== "none"
    ) {
      applyPerformanceToLatestGeneration(section.id, intent.generator, performancePart)
    }
    const target = targetTabForIntent(intent)
    if (target) onNavigate(target)
    setGeneratingIntentId(null)
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

  const activeMelodyId = section
    ? project.sectionMelodyAssignments[section.id]
    : undefined

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-surface-black px-4 py-5 lg:px-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-12">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-primary">
              <Sparkles size={18} />
              <span className="text-[11px] font-medium uppercase tracking-[0.18em]">
                AI Arrangement Partner · Preview
              </span>
            </div>
            <h1 className="text-xl font-semibold text-body-on-dark">
              楽曲を見ながら、次の一手を相談する
            </h1>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-body-muted">
              AIは音楽的な判断を3案へ整理し、実音は既存GeneratorがコードとActive Melodyを検証して生成します。
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-pill bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-200">
            <ShieldCheck size={14} /> APIキーはSupabase内に保持
          </div>
        </header>

        {director && director.sections.length > 0 && (
          <SectionCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
                  <Waypoints size={15} className="text-primary" /> Arrangement Director
                </div>
                <p className="mt-1 text-[11px] leading-5 text-body-muted">
                  曲全体の起伏を先に決め、現在のSectionでクライマックス資源を使いすぎないための設計図です。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-pill bg-primary/10 px-2.5 py-1 text-[10px] text-primary">
                  Arc {director.arcSummary} · 頂点{director.climaxSectionId ? "設定済み" : "未設定"}
                </span>
                <label className="flex items-center gap-1 text-[10px] text-body-muted">
                  Climax
                  <Select
                    value={project.arrangementDirectorOverrides?.climaxSectionId ?? "auto"}
                    onChange={(event) =>
                      setArrangementDirectorClimax(
                        event.target.value === "auto" ? null : event.target.value,
                      )
                    }
                    className="!py-1 text-[10px]"
                  >
                    <option value="auto">Auto</option>
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
                      Whole-song Review
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-body-muted">
                      {wholeSongReview.summary}
                    </p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-1 text-[10px] font-medium ${reviewStatusClass(wholeSongReview.status)}`}>
                    {reviewStatusLabel(wholeSongReview.status)}
                    {wholeSongReview.status !== "pending" && ` · ${wholeSongReview.score}/100`}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                  <ReviewMetric
                    label="確定Section"
                    value={`${wholeSongReview.metrics.reviewedSectionCount}/${director.sections.length}`}
                  />
                  <ReviewMetric
                    label="Energy追従"
                    value={`${Math.round(wholeSongReview.metrics.energyContrastScore * 100)}%`}
                  />
                  <ReviewMetric
                    label="同一伴奏境界"
                    value={`${wholeSongReview.metrics.repeatedSupportPatternCount}件`}
                  />
                  <ReviewMetric
                    label="頂点先取り"
                    value={`${wholeSongReview.metrics.climaxReservationRiskCount}件`}
                  />
                </div>
                {wholeSongReview.findings
                  .filter((finding) => finding.severity !== "pass")
                  .slice(0, 2)
                  .map((finding) => (
                    <p key={finding.id} className="mt-2 text-[10px] leading-4 text-amber-200">
                      {finding.title}：{finding.recommendation}
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
                      <span className="shrink-0 text-[10px] text-primary">
                        E{plan.targetEnergy}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-body-muted">
                      {directorFunctionLabel(plan.narrativeFunction)} · {climaxPolicyLabel(plan.climaxPolicy)}
                    </div>
                    <div className="mt-1 text-[10px] text-ink-muted-48">
                      密度上限 {plan.densityCeiling} · 追加余地 {plan.additionBudget}
                    </div>
                  </button>
                )
              })}
            </div>
            {currentDirectorPlan && (
              <div className="mt-3 space-y-2">
                <div className="grid gap-2 text-[11px] sm:grid-cols-3">
                  <DirectorNote
                    label="このSectionで導入"
                    value={currentDirectorPlan.introduce.join(" / ")}
                  />
                  <DirectorNote
                    label="まだ温存"
                    value={currentDirectorPlan.withhold.length > 0
                      ? currentDirectorPlan.withhold.join(" / ")
                      : "クライマックス資源を使用可能"}
                  />
                  <DirectorNote
                    label="次への渡し方"
                    value={currentDirectorPlan.transitionIntent}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3 rounded-sm border border-hairline bg-white/[0.02] px-3 py-2">
                  <span className="text-[10px] font-medium text-body-on-dark">作曲者の固定値</span>
                  <label className="flex items-center gap-1 text-[10px] text-body-muted">
                    Energy
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
                      className="!py-1 text-[10px]"
                    >
                      <option value="auto">Auto</option>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>E{value}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-body-muted">
                    密度上限
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
                      className="!py-1 text-[10px]"
                    >
                      <option value="auto">Auto</option>
                      {Array.from(
                        { length: Math.max(1, project.arrangementSettings.maximumParts) },
                        (_, index) => index + 1,
                      ).map((value) => (
                        <option key={value} value={value}>{value} parts</option>
                      ))}
                    </Select>
                  </label>
                  {currentDirectorPlan.climaxPolicy === "express" && (
                    <span className="text-[9px] text-primary">ClimaxはEnergy 5で固定</span>
                  )}
                </div>
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
                      Director Review · Active構成
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-body-muted">
                      {arrangementReview.summary}
                    </p>
                  </div>
                  <div className={`rounded-pill px-3 py-1 text-[11px] font-medium ${reviewStatusClass(arrangementReview.status)}`}>
                    {reviewStatusLabel(arrangementReview.status)}
                    {arrangementReview.status !== "pending" && ` · ${arrangementReview.score}/100`}
                  </div>
                </div>
                {arrangementReview.status !== "pending" && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                    <ReviewMetric
                      label="密度使用率"
                      value={`${Math.round(arrangementReview.metrics.densityUtilization * 100)}%`}
                    />
                    <ReviewMetric
                      label="実音の余白"
                      value={`${Math.round(arrangementReview.metrics.silenceRatio * 100)}%`}
                    />
                    <ReviewMetric
                      label="重大衝突"
                      value={`${arrangementReview.metrics.blockingCollisionCount}件`}
                    />
                    <ReviewMetric
                      label="頂点先取り"
                      value={arrangementReview.metrics.climaxResourceRisk ? "あり" : "なし"}
                    />
                  </div>
                )}
                {arrangementReview.findings.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {arrangementReview.findings.map((finding) => (
                      <div
                        key={finding.id}
                        className="rounded-sm border border-hairline bg-white/[0.025] px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-medium ${finding.severity === "pass"
                            ? "text-emerald-300"
                            : finding.severity === "blocking"
                              ? "text-red-200"
                              : "text-amber-200"
                          }`}>
                            {finding.title}
                          </span>
                          <span className="text-[9px] text-ink-muted-48">
                            {finding.principleId}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-body-muted">
                          {finding.evidence}
                        </p>
                        <p className="mt-1 text-[10px] leading-4 text-body-on-dark">
                          {finding.recommendation}
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
                  <Layers3 size={15} className="text-primary" /> Orchestration & Performance
                </div>
                <p className="mt-1 max-w-3xl text-[11px] leading-5 text-body-muted">
                  {orchestrationPlan.performanceArc}
                </p>
              </div>
              <span className="rounded-pill bg-white/8 px-2.5 py-1 text-[10px] text-body-muted">
                同時発音パート上限 {orchestrationPlan.maxSimultaneousParts}
              </span>
            </div>
            {orchestrationReview && (
              <div className="mt-3 rounded-sm border border-hairline bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-body-on-dark">
                      {orchestrationReview.status === "strong"
                        ? <CircleCheck size={14} className="text-emerald-300" />
                        : <TriangleAlert size={14} className={orchestrationReview.status === "revise" ? "text-red-300" : "text-amber-200"} />}
                      Orchestration Masking Review
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-body-muted">
                      {orchestrationReview.summary}
                    </p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-1 text-[10px] font-medium ${reviewStatusClass(orchestrationReview.status)}`}>
                    {reviewStatusLabel(orchestrationReview.status)} · {orchestrationReview.score}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ReviewMetric label="前景競合" value={`${orchestrationReview.metrics.foregroundCompetitionCount}件`} />
                  <ReviewMetric label="強弱競合" value={`${orchestrationReview.metrics.dynamicMaskingCount}件`} />
                  <ReviewMetric label="同系音色" value={`${orchestrationReview.metrics.familyDuplicationCount}組`} />
                  <ReviewMetric label="音域集中" value={`${orchestrationReview.metrics.registerCrowdingCount}組`} />
                </div>
                {orchestrationReview.findings.some((finding) => finding.severity !== "pass") && (
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    {orchestrationReview.findings
                      .filter((finding) => finding.severity !== "pass")
                      .slice(0, 2)
                      .map((finding) => (
                        <div key={finding.id} className="rounded-sm bg-white/[0.04] px-3 py-2">
                          <div className={finding.severity === "blocking" ? "text-[10px] text-red-200" : "text-[10px] text-amber-100"}>
                            {finding.title}
                          </div>
                          <p className="mt-1 text-[9px] leading-4 text-body-muted">
                            {finding.recommendation}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            {audibleLayerReview && (
              <div className="mt-3 rounded-sm border border-hairline bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-body-on-dark">
                      {audibleLayerReview.status === "strong"
                        ? <CircleCheck size={14} className="text-emerald-300" />
                        : <AudioLines size={14} className={audibleLayerReview.status === "revise" ? "text-red-300" : "text-amber-200"} />}
                      Active Note Collision Review
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-body-muted">
                      {audibleLayerReview.summary}
                    </p>
                  </div>
                  <span className={`rounded-pill px-2.5 py-1 text-[10px] font-medium ${reviewStatusClass(audibleLayerReview.status)}`}>
                    {reviewStatusLabel(audibleLayerReview.status)} · {audibleLayerReview.score}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <ReviewMetric label="監査レイヤー" value={`${audibleLayerReview.metrics.reviewedSupportLayerCount}層`} />
                  <ReviewMetric label="同音重複" value={`${audibleLayerReview.metrics.samePitchOverlapBeats.toFixed(2)}拍`} />
                  <ReviewMetric label="短2度重複" value={`${audibleLayerReview.metrics.semitoneOverlapBeats.toFixed(2)}拍`} />
                  <ReviewMetric label="感情点アタック" value={`${audibleLayerReview.metrics.protectedAttackCount}回`} />
                  <ReviewMetric label="同時アタック" value={`${audibleLayerReview.metrics.simultaneousAttackCount}回`} />
                  <ReviewMetric label="補助間重複" value={`${audibleLayerReview.metrics.supportCollisionBeats.toFixed(2)}拍`} />
                </div>
                {audibleLayerReview.findings.some((finding) => finding.severity !== "pass") && (
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    {audibleLayerReview.findings
                      .filter((finding) => finding.severity !== "pass")
                      .slice(0, 2)
                      .map((finding) => (
                        <div key={finding.id} className="rounded-sm bg-white/[0.04] px-3 py-2">
                          <div className={finding.severity === "blocking" ? "text-[10px] text-red-200" : "text-[10px] text-amber-100"}>
                            {finding.title}
                          </div>
                          <p className="mt-1 text-[9px] leading-4 text-body-muted">
                            {finding.evidence}
                          </p>
                          <p className="mt-1 text-[9px] leading-4 text-body-on-dark">
                            {finding.recommendation}
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
                    <span className={`rounded-pill px-2 py-0.5 text-[9px] ${part.sourceState === "active"
                      ? "bg-emerald-400/10 text-emerald-200"
                      : "bg-primary/10 text-primary"
                    }`}>
                      {part.sourceState === "active" ? "現在使用中" : "導入候補"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag>{part.register}</Tag>
                    <Tag>{orchestrationDistanceLabel(part.distance)}</Tag>
                    <Tag>{part.articulation}</Tag>
                    <Tag>{part.dynamic}</Tag>
                    <Tag>{part.timing}</Tag>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-body-muted">
                    <strong className="text-body-on-dark">役割：</strong>{part.purpose}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-ink-muted-48">
                    <strong className="text-body-muted">登場：</strong>{part.entry}
                  </p>
                  <p className="text-[10px] leading-4 text-ink-muted-48">
                    <strong className="text-body-muted">退場：</strong>{part.exit}
                  </p>
                  <p className="mt-1 text-[9px] text-ink-muted-48">
                    Velocity {part.velocityRange[0]}–{part.velocityRange[1]}
                  </p>
                  {part.role !== "intentional-silence" && effectiveSectionId && (
                    <details className="mt-2 border-t border-hairline pt-2">
                      <summary className="cursor-pointer text-[9px] text-primary">
                        演奏を固定・調整{override ? " · 固定あり" : ""}
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-3">
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
                          className="self-end rounded-sm border border-hairline px-2 py-1.5 text-[9px] text-body-muted hover:text-body-on-dark"
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
              <div className="mt-3 rounded-sm border border-dashed border-hairline px-3 py-2 text-[10px] leading-4 text-body-muted">
                <strong className="text-primary">このSectionでは温存：</strong>
                {orchestrationPlan.withheldGestures.join(" / ")}
              </div>
            )}
          </SectionCard>
        )}

        <SectionCard>
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <label className="flex flex-col gap-1.5 text-[11px] text-body-muted">
              対象セクション
              <Select
                value={effectiveSectionId ?? ""}
                onChange={(event) => selectSection(event.target.value || null)}
              >
                {project.sections.length === 0 && <option value="">セクションなし</option>}
                {project.sections.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} · {SECTION_ROLE_LABELS[candidate.role]}
                  </option>
                ))}
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
              <ContextStat label="コード" value={`${context?.chords.length ?? 0}件`} />
              <ContextStat
                label="Active Melody"
                value={context?.activeMelody.present ? `${context.activeMelody.noteCount}音` : "なし"}
              />
              <ContextStat label="Song Profile" value={context?.project.songProfile ?? "—"} />
              <ContextStat label="長さ" value={section ? `${section.lengthBars}小節` : "—"} />
            </div>
          </div>

          {session && session.turns.length > 0 && (
            <div className="mt-4 rounded-lg border border-hairline bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-body-on-dark">
                  <MessageCircle size={14} className="text-primary" /> このセクションの相談履歴
                </div>
                <button
                  type="button"
                  className="text-[10px] text-ink-muted-48 hover:text-body-on-dark"
                  onClick={() => {
                    if (effectiveSectionId) setAiPartnerSession(effectiveSectionId, null)
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
                ? "例：メロディは変えず、Direction 2をもっと不穏に。ベルは使わないで"
                : "例：このイントロに、余白を残しながら曲の顔になるピアノフレーズがほしい"}
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
                  <AudioLines size={15} className="text-primary" /> 音源を聴かせる（第二弾）
                </div>
                <p className="mt-1 text-[10px] leading-4 text-ink-muted-48">
                  Logic Pro等から書き出したMP3/WAV・12MB以下。解析時だけ送信し、保存しません。
                </p>
              </div>
              {!audio && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border border-primary px-3.5 py-2 text-[12px] text-primary transition hover:bg-primary/10">
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
                  <p className="text-[10px] text-body-muted">
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
                    ? "音源を聴いて3案を相談"
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
                    <Lightbulb size={15} className="text-primary" /> 現状診断
                  </div>
                  <p className="text-[13px] leading-6 text-body-muted">
                    {response.diagnosis.currentStrength}
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-body-on-dark">
                    {response.diagnosis.primaryOpportunity}
                  </p>
                </div>
                <div className="w-full rounded-sm border border-primary/20 bg-primary/8 px-3 py-2 sm:w-auto sm:min-w-[15rem]">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                    <Coins size={13} /> 今回のAI利用料
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-body-on-dark">
                    {response.cached
                      ? "キャッシュ利用・追加費用なし"
                      : `概算 $${response.usage.estimatedCostUsd.toFixed(4)}`}
                  </div>
                  <div className="mt-0.5 break-words text-[10px] text-ink-muted-48">
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
                  <div className="text-[10px] font-medium uppercase tracking-wide text-primary">
                    会話で確定した制約
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {session?.confirmedConstraints.map((constraint) => (
                      <span key={constraint} className="inline-flex items-center gap-1 rounded-pill bg-white/8 px-2.5 py-1 text-[10px] text-body-muted">
                        {constraint}
                        <button
                          type="button"
                          aria-label={`${constraint}を解除`}
                          className="rounded-full p-0.5 hover:bg-white/10 hover:text-body-on-dark"
                          onClick={() => {
                            if (!effectiveSectionId || !session) return
                            setAiPartnerSession(
                              effectiveSectionId,
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
                  このセクションは、音を追加しない案も有力と診断されています。
                </p>
              )}
              {(response.diagnosis.audioEvidence ?? []).length > 0 && (
                <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-primary">
                    <AudioLines size={13} /> 音源から聴き取った根拠
                  </div>
                  <ul className="mt-1 space-y-1 text-[11px] leading-5 text-body-muted">
                    {(response.diagnosis.audioEvidence ?? []).map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                  <p className="mt-1 text-[10px] text-ink-muted-48">
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
                        <span className="text-[10px] uppercase tracking-[0.16em] text-primary">
                          Direction {index + 1}
                        </span>
                        <h2 className="mt-1 text-[15px] font-semibold text-body-on-dark">
                          {intent.title}
                        </h2>
                      </div>
                      <span className="rounded-pill bg-white/8 px-2.5 py-1 text-[10px] text-body-muted">
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
                    </div>
                    <p className="mt-3 text-[12px] leading-5 text-body-on-dark">
                      {intent.generationBrief}
                    </p>
                    {intent.generator === "accompaniment" &&
                      intent.accompanimentPatternId !== "none" && (
                        <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-body-muted">
                          <strong className="text-primary">提案するリズム：</strong>
                          {accompanimentPatternName(
                            project,
                            intent.accompanimentPatternId,
                          )}
                        </div>
                      )}
                    {intent.generator === "rhythm" && intent.rhythmPlan.enabled && (
                      <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] leading-5 text-body-muted">
                        <div className="font-medium text-primary">
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
                        <span className="text-[10px] uppercase tracking-wide text-primary">
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
                      {intent.why}
                    </p>
                    <div className="mt-auto pt-4">
                      {!noGenerator && !proposalOnly && (
                        <Button
                          variant="secondary"
                          className="w-full !whitespace-normal text-center"
                          disabled={counterUnavailable || generatingIntentId === intent.id}
                          onClick={() => generateFromIntent(intent)}
                        >
                          <Music2 size={14} /> この案を生成
                        </Button>
                      )}
                      {proposalOnly && (
                        <>
                          <Button
                            variant="secondary"
                            className="w-full"
                            disabled={intent.rhythmPlan.events.length === 0}
                            onClick={() => downloadRhythm(intent)}
                          >
                            <Download size={14} /> ドラムMIDIを書き出す
                          </Button>
                          <p className="mt-2 text-center text-[10px] leading-4 text-body-muted">
                            セクション長まで反復し、Logic ProでSoftware Instrumentへ割り当てられるChannel 1で出力します。
                          </p>
                        </>
                      )}
                      {counterUnavailable && (
                        <p className="mt-2 text-[10px] text-amber-200">
                          Counter生成にはActive Melodyが必要です。
                        </p>
                      )}
                    </div>
                  </SectionCard>
                )
              })}
            </div>

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

        <p className="text-center text-[10px] leading-5 text-ink-muted-48">
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
      <div className="text-[10px] text-ink-muted-48">{label}</div>
      <div className="mt-0.5 truncate text-[12px] text-body-on-dark">{value}</div>
    </div>
  )
}

function DiagnosisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-muted-48">{title}</div>
      <ul className="mt-1 space-y-1 text-[11px] leading-5 text-body-muted">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-pill border border-hairline px-2 py-0.5 text-[10px] text-body-muted">
      {children}
    </span>
  )
}

function directorFunctionLabel(
  value: ArrangementDirectorFunction,
): string {
  return {
    establish: "世界を提示",
    develop: "主題を展開",
    lift: "期待を上昇",
    declare: "主題を宣言",
    suspend: "時間を停止",
    transform: "視点を転換",
    release: "余韻へ解放",
  }[value]
}

function climaxPolicyLabel(
  value: ArrangementDirectorClimaxPolicy,
): string {
  return {
    reserve: "温存",
    approach: "接近",
    express: "頂点",
    recover: "残響",
  }[value]
}

function DirectorNote({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-primary">{label}</div>
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

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-ink-muted-48">{label}</div>
      <div className="mt-0.5 text-[11px] text-body-on-dark">{value}</div>
    </div>
  )
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
        className="min-w-0 !py-1 text-[9px]"
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
