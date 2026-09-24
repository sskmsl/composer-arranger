import { useEffect, useMemo, useRef, useState } from "react"
import {
  AudioLines,
  ArrowRight,
  Bot,
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
  X,
} from "lucide-react"
import { rhythmPreviewPlayer } from "@/audio/rhythmPreviewPlayer"
import { previewPlayer } from "@/audio/previewPlayer"
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
import {
  audibleDirectionPresentation,
  conciseDirectionText,
  plainDirectionText,
} from "@/ai-arranger/directionPresentation"
import {
  directionAuditionDirectiveForIntent,
  directionAuditionRanges,
  directionAuditionSeed,
  directionAuditionTracks,
} from "@/ai-arranger/directionAudition"
import {
  directiveWithTimelineConstraints,
  parseArrangementTimelineConstraints,
} from "@/ai-arranger/timelineConstraints"
import {
  arrangementStructureChangeLabel,
  parseArrangementStructureChanges,
} from "@/ai-arranger/structureChanges"
import { executeArrangementStructureChanges } from "@/ai-arranger/structureChangeExecution"
import type { AiArrangementIntent, AiArrangementResponse, AiAudioPayload } from "@/ai-arranger/types"
import { SECTION_ROLE_LABELS } from "@/core/section"
import {
  arrangementSoundInstructionFromText,
  arrangementSoundInstructionLabel,
} from "@/core/arrangementIntent"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { generateFullSongArrangement as buildFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Pill, SectionCard, Select } from "@/ui/primitives"
import { downloadMidi } from "@/midi/exportMelody"
import type { MainTab } from "./App"
import { AiPartnerControlCenter } from "./AiPartnerControlCenter"
import { AiPartnerAnalysisPanel } from "./AiPartnerAnalysisPanel"
import { ContextStat, DiagnosisList } from "./AiPartnerParts"
import {
  formatDuration,
  accompanimentPatternName,
  rhythmSubdivisionLabel,
  rhythmFeelLabel,
} from "./aiPartnerLabels"

const EXAMPLE_PROMPTS = [
  "コード・メロディ・テンポは維持。Section間のフレーズと、主旋律とは異なる音域・音階感のバックシンセを全曲に提案して",
  "主旋律は変えず、1〜8小節は主旋律なし、25〜28小節は完全無音にして",
  "曲全体で余白と残響を守り、サビまで段階的に世界を開いて",
  "主旋律を壊さず、Sectionごとの役割差でサビ前の期待を高めて",
]

const DEFAULT_WHOLE_SONG_PROMPT = "コード・主旋律・テンポは変えず、曲全体を判断して、必要な伴奏・つなぎ・装飾だけを性格の異なる3案で提案して"

const WHOLE_SONG_SESSION_ID = "__whole_song__"

const GENERATOR_LABELS: Record<AiArrangementIntent["generator"], string> = {
  melody: "主旋律",
  phrase: "短いフレーズ",
  signature: "イントロ",
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
  const [playingDirectionIntentId, setPlayingDirectionIntentId] = useState<string | null>(null)
  const [preparingDirectionIntentId, setPreparingDirectionIntentId] = useState<string | null>(null)
  const directionPreviewRunRef = useRef(0)
  const [audio, setAudio] = useState<AiAudioPayload | null>(null)
  const [preparingAudio, setPreparingAudio] = useState(false)
  const [customConsultationOpen, setCustomConsultationOpen] = useState(Boolean(initialPrompt))
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
    setCustomConsultationOpen(true)
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
  const projectTotalBars = project.sections.reduce(
    (sum, candidate) => sum + Math.max(1, candidate.lengthBars),
    0,
  )
  const recognizedTimelineConstraints = useMemo(
    () => parseArrangementTimelineConstraints(
      [
        project.arrangementDirectorWorkspace?.brief ?? "",
        session?.turns.at(-1)?.userMessage ?? "",
        ...(session?.confirmedConstraints ?? []),
        prompt,
      ].filter(Boolean).join("。"),
      projectTotalBars,
    ),
    [project.arrangementDirectorWorkspace?.brief, projectTotalBars, prompt, session],
  )
  const recognizedTimelineLabels = [
    recognizedTimelineConstraints.melodyStartBar && recognizedTimelineConstraints.melodyStartBar > 1
      ? `主旋律は${recognizedTimelineConstraints.melodyStartBar}小節目から`
      : null,
    recognizedTimelineConstraints.melodySilenceRanges.length > 0
      ? `主旋律を休む：${recognizedTimelineConstraints.melodySilenceRanges.map((range) =>
          range.startBar === range.endBar ? `${range.startBar}小節` : `${range.startBar}〜${range.endBar}小節`,
        ).join("、")}`
      : null,
    recognizedTimelineConstraints.fullSilenceRanges.length > 0
      ? `完全無音：${recognizedTimelineConstraints.fullSilenceRanges.map((range) =>
          range.startBar === range.endBar ? `${range.startBar}小節` : `${range.startBar}〜${range.endBar}小節`,
        ).join("、")}`
      : null,
  ].filter((label): label is string => Boolean(label))
  const recognizedStructureChanges = useMemo(
    () => parseArrangementStructureChanges(
      project,
      [
        project.arrangementDirectorWorkspace?.brief ?? "",
        session?.turns.at(-1)?.userMessage ?? "",
        ...(session?.confirmedConstraints ?? []),
        prompt,
      ].filter(Boolean).join("。"),
    ),
    [project, prompt, session],
  )
  const recognizedSoundInstruction = arrangementSoundInstructionFromText([
    project.arrangementDirectorWorkspace?.brief ?? "",
    session?.turns.at(-1)?.userMessage ?? "",
    ...(session?.confirmedConstraints ?? []),
    prompt,
  ].filter(Boolean).join("。"))
  const orchestrationPlan = context?.orchestration.sections.find(
    (plan) => plan.sectionId === effectiveSectionId,
  )

  useEffect(() => {
    setResponse(session?.latestResponse ?? null)
    setError(null)
  }, [effectiveSectionId, project.projectId, session?.latestResponse, session?.updatedAt])

  useEffect(
    () => () => {
      rhythmPreviewPlayer.stop()
      directionPreviewRunRef.current += 1
      previewPlayer.stop()
    },
    [],
  )

  useEffect(() => {
    rhythmPreviewPlayer.stop()
    directionPreviewRunRef.current += 1
    previewPlayer.stop()
    setPlayingRhythmIntentId(null)
    setPlayingDirectionIntentId(null)
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
      directionPreviewRunRef.current += 1
      previewPlayer.stop()
      setPlayingDirectionIntentId(null)
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
    directionPreviewRunRef.current += 1
    previewPlayer.stop()
    setPlayingDirectionIntentId(null)
    setGeneratingIntentId(intent.id)
    if (isWholeSongConsultation) {
      const instructionBrief = [
        project.arrangementDirectorWorkspace?.brief ?? "",
        session?.turns.at(-1)?.userMessage ?? "",
        ...(session?.confirmedConstraints ?? []),
      ].filter(Boolean).join("。")
      const executableBrief = [instructionBrief, intent.generationBrief].filter(Boolean).join("。")
      const parsedStructureChanges = parseArrangementStructureChanges(project, executableBrief)
      const structureChanges = parsedStructureChanges.length > 0
        ? parsedStructureChanges
        : project.fullSongArrangement?.plan.directive?.structureChanges ?? []
      executeArrangementStructureChanges(
        structureChanges,
        project.fullSongArrangement?.plan.directive?.structureChanges,
      )
      const effectiveProject = useProjectStore.getState().project
      const { direction } = wholeSongDirectionForAiIntent(effectiveProject, intent, instructionBrief)
      const totalBars = effectiveProject.sections.reduce((sum, candidate) => sum + Math.max(1, candidate.lengthBars), 0)
      const generationDirective = directiveWithTimelineConstraints(
        {
          ...directionAuditionDirectiveForIntent(intent),
          structureChanges,
          soundInstruction: arrangementSoundInstructionFromText(executableBrief)
            ?? directionAuditionDirectiveForIntent(intent).soundInstruction,
        },
        executableBrief,
        totalBars,
      )
      const availableActions = direction.actions.filter(
        (action) => action.status === "available",
      )
      const result = executeArrangementActions(availableActions)
      generateFullSongArrangement([
        instructionBrief,
        intent.title,
        intent.generationBrief,
        intent.necessityReason ?? intent.why,
      ].filter(Boolean).join("。"), generationDirective)
      setWholeSongGeneration({
        intentId: intent.id,
        directionTitle: `${intent.title} → ${direction.title}`,
        generated: result.generatedCount,
        skipped: result.skippedCount,
        items: wholeSongGenerationResultItems(direction.actions, result.results),
      })
      setArrangementDirectorWorkspace({
        brief: instructionBrief,
        selectedDirectionId: direction.id,
      })
      setGeneratingIntentId(null)
      onNavigate("arrangement")
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
    directionPreviewRunRef.current += 1
    previewPlayer.stop()
    setPlayingDirectionIntentId(null)
    const started = rhythmPreviewPlayer.play({
      bpm: project.song.tempo,
      timeSignature: project.song.timeSignature,
      rhythmPlan: intent.rhythmPlan,
      performancePlan: performancePartForIntent(intent, orchestrationPlan) ?? undefined,
      onEnded: () => setPlayingRhythmIntentId(null),
    })
    setPlayingRhythmIntentId(started ? intent.id : null)
  }

  const previewWholeSongDirection = async (
    intent: AiArrangementIntent,
    directionIndex: number,
    includeSource = false,
  ) => {
    if (!isWholeSongConsultation) return
    const previewKey = `${intent.id}:${includeSource ? "combined" : "generated"}`
    if (playingDirectionIntentId === previewKey) {
      directionPreviewRunRef.current += 1
      previewPlayer.stop()
      setPlayingDirectionIntentId(null)
      return
    }
    setPreparingDirectionIntentId(intent.id)
    setError(null)
    rhythmPreviewPlayer.stop()
    setPlayingRhythmIntentId(null)
    directionPreviewRunRef.current += 1
    previewPlayer.stop()
    setPlayingDirectionIntentId(null)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const instructionBrief = [
        project.arrangementDirectorWorkspace?.brief ?? "",
        session?.turns.at(-1)?.userMessage ?? "",
        ...(session?.confirmedConstraints ?? []),
        intent.title,
        intent.generationBrief,
      ].filter(Boolean).join("。")
      const totalBars = project.sections.reduce((sum, candidate) => sum + Math.max(1, candidate.lengthBars), 0)
      const directive = directiveWithTimelineConstraints(
        {
          ...directionAuditionDirectiveForIntent(intent),
          structureChanges: parseArrangementStructureChanges(project, instructionBrief),
          soundInstruction: arrangementSoundInstructionFromText(instructionBrief)
            ?? directionAuditionDirectiveForIntent(intent).soundInstruction,
        },
        instructionBrief,
        totalBars,
      )
      const arrangement = buildFullSongArrangement(project, {
        seed: directionAuditionSeed(project, response?.requestId ?? "local", intent, directionIndex),
        revision: directionIndex,
        brief: instructionBrief,
        directive,
      })
      const auditionTracks = directionAuditionTracks(arrangement.tracks, directive.add ?? [])
      const material = buildSongPlaybackMaterial(project, directive.timelineConstraints)
      const ranges = directionAuditionRanges(project, arrangement, auditionTracks)
      if (auditionTracks.length === 0 && intent.generator !== "none") {
        setError("この案の追加音を作れませんでした。別の案を選ぶか、相談内容を少し具体的にしてください。")
        return
      }
      if (ranges.length === 0 || (auditionTracks.length === 0 && !includeSource)) {
        setError("この案は音を追加しない方針です。原曲との重ね聴きは必要ありません。")
        return
      }
      const runId = directionPreviewRunRef.current
      const importedSource = project.sourceImport?.type === "midi"
      setPlayingDirectionIntentId(previewKey)
      const playRange = (index: number) => {
        if (directionPreviewRunRef.current !== runId || index >= ranges.length) {
          if (directionPreviewRunRef.current === runId) setPlayingDirectionIntentId(null)
          return
        }
        previewPlayer.play({
          bpm: project.song.tempo,
          chords: includeSource && !importedSource ? material.chords : [],
          accompaniment: includeSource
            ? importedSource ? material.importedBacking : material.accompanimentPattern
            : [],
          melody: includeSource ? material.melody : [],
          arrangementTracks: auditionTracks,
          mode: includeSource ? "chords-melody" : "melody-only",
          range: ranges[index],
          onEnded: () => playRange(index + 1),
        })
      }
      playRange(0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "この案の試聴を準備できませんでした。")
    } finally {
      setPreparingDirectionIntentId(null)
    }
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

        <AiPartnerAnalysisPanel context={context} effectiveSectionId={effectiveSectionId} />

        <SectionCard>
          <div className="mb-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
              <MessageCircle size={15} className="text-primary-on-dark" /> {session?.turns.length ? "AIと制作意図を詰める" : "まずAIへ制作意図を伝える"}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-body-muted">
              コード・主旋律はそのまま保護します。「9小節目から主旋律」「25〜28小節は完全無音」のような位置指定もできます。
            </p>
          </div>
          {!response && !(session?.turns.length) && (
            <div className="rounded-lg border border-primary/35 bg-primary/[0.07] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-body-on-dark">迷ったら、AIにそのまま任せられます</p>
                  <p className="mt-1 text-[11px] leading-5 text-body-muted">コード・主旋律・テンポは守り、曲全体へ必要な追加パートを3案に分けて提案します。</p>
                </div>
                <Button
                  className="min-h-11 shrink-0 justify-center"
                  onClick={() => void submit(false, DEFAULT_WHOLE_SONG_PROMPT)}
                  disabled={busy || preparingAudio || !context}
                >
                  {busy ? <LoaderCircle className="animate-spin" size={15} /> : <Bot size={15} />}
                  {busy ? "楽曲を分析中…" : "AIにおまかせで3案を作る"}
                </Button>
              </div>
            </div>
          )}

          <details
            className="mt-3 rounded-lg border border-hairline bg-white/[0.015] p-3"
            open={customConsultationOpen}
            onToggle={(event) => setCustomConsultationOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-[11px] font-medium text-body-muted hover:text-body-on-dark">
              {response || session?.turns.length ? "AIへ追加で相談する" : "希望や相談範囲を指定する（任意）"}
            </summary>
            <div className="mt-4">
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
                      {plainDirectionText(turn.partnerReply)}
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
                  : "例：メロディは変えず、2案目をもっと不穏に。ベルは使わないで"
                : isWholeSongConsultation
                  ? "例：曲全体を通して余白を守り、曲の部分ごとに役割を変えながらサビへ向かう3案がほしい"
                  : "例：この部分に、余白を残しながら次へつながるフレーズがほしい"}
              className="resize-y rounded-lg border border-hairline bg-surface-tile-2 px-3 py-2.5 text-[14px] leading-6 text-body-on-dark outline-none placeholder:text-ink-muted-48 focus:border-primary-focus"
            />
          </label>
          {isWholeSongConsultation && recognizedTimelineLabels.length > 0 && (
            <div className="mt-2 rounded-md border border-emerald-300/25 bg-emerald-400/[0.07] px-3 py-2 text-[11px] text-emerald-100">
              <strong className="font-semibold">実際の曲構成へ反映する指定</strong>
              <span className="ml-2">{recognizedTimelineLabels.join(" ／ ")}</span>
            </div>
          )}
          {isWholeSongConsultation && recognizedStructureChanges.length > 0 && (
            <div className="mt-2 rounded-md border border-sky-300/25 bg-sky-400/[0.07] px-3 py-2 text-[11px] text-sky-100">
              <strong className="font-semibold">この案で進むと変更する曲構成</strong>
              <span className="ml-2">
                {recognizedStructureChanges.map(arrangementStructureChangeLabel).join(" ／ ")}
              </span>
            </div>
          )}
          {isWholeSongConsultation && recognizedSoundInstruction && (
            <div className="mt-2 rounded-md border border-violet-300/25 bg-violet-400/[0.07] px-3 py-2 text-[11px] text-violet-100">
              <strong className="font-semibold">音として反映する指定</strong>
              <span className="ml-2">{arrangementSoundInstructionLabel(recognizedSoundInstruction)}（{recognizedSoundInstruction.target === "intro" ? "イントロ" : "指定した部分"}）</span>
            </div>
          )}
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
            </div>
          </details>
          {/* 「おまかせ」ボタンの失敗も見えるよう、閉じる欄の外に出す */}
          {error && (
            <p role="alert" className="mt-3 rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-200">
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
                    <strong className="text-body-on-dark">今の良さ：</strong>
                    {conciseDirectionText(response.diagnosis.currentStrength, 56)}
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-body-on-dark">
                    <strong>次に変える：</strong>
                    {conciseDirectionText(response.diagnosis.primaryOpportunity, 56)}
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
                    ? "曲全体では、あえて音を追加しない部分を残す案も有力です。"
                    : "この部分は、あえて音を追加しない案も有力です。"}
                </p>
              )}
              {(response.diagnosis.audioEvidence ?? []).length > 0 && (
                <div className="mt-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-primary-on-dark">
                    <AudioLines size={13} /> 音源から聴き取った根拠
                  </div>
                  <ul className="mt-1 space-y-1 text-[11px] leading-5 text-body-muted">
                    {(response.diagnosis.audioEvidence ?? []).map((item) => <li key={item}>• {conciseDirectionText(item, 64)}</li>)}
                  </ul>
                  <p className="mt-1 text-[11px] text-ink-muted-48">
                    {plainDirectionText(response.diagnosis.audioConfidenceNote ?? "音源解析は編曲判断の補助情報です。")}
                  </p>
                </div>
              )}
            </SectionCard>

            <div className="grid gap-4 xl:grid-cols-3">
              {response.intents.map((intent, index) => {
                const presentation = audibleDirectionPresentation(intent)
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
                          {presentation.title}
                        </h2>
                      </div>
                      <span className="rounded-pill bg-white/8 px-2.5 py-1 text-[11px] text-body-muted">
                        {GENERATOR_LABELS[intent.generator]}
                      </span>
                    </div>
                    <p className="mt-3 text-[13px] leading-6 text-body-on-dark">
                      {presentation.summary}
                    </p>
                    <ul className="mt-3 space-y-1.5 rounded-sm bg-white/[0.04] p-3 text-[12px] leading-5 text-body-muted">
                      {presentation.changes.map((change) => <li key={change}>• {change}</li>)}
                    </ul>
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
                          {rhythmSubdivisionLabel(intent.rhythmPlan.subdivision)} · {rhythmFeelLabel(intent.rhythmPlan.feel)}
                        </div>
                        <div className="mt-1"><strong className="text-body-on-dark">低いドラム：</strong>{plainDirectionText(intent.rhythmPlan.kickPattern)}</div>
                        <div><strong className="text-body-on-dark">拍を示すドラム：</strong>{plainDirectionText(intent.rhythmPlan.snarePattern)}</div>
                        <div><strong className="text-body-on-dark">細かい刻み：</strong>{plainDirectionText(intent.rhythmPlan.hatPattern)}</div>
                        {intent.rhythmPlan.percussionPattern && (
                          <div><strong className="text-body-on-dark">その他の打楽器：</strong>{plainDirectionText(intent.rhythmPlan.percussionPattern)}</div>
                        )}
                        <div className="mt-1 text-ink-muted-48">{plainDirectionText(intent.rhythmPlan.variation)}</div>
                      </div>
                    )}
                    <details className="mt-3 rounded-sm border border-white/8 bg-white/[0.025] p-3 text-[11px] leading-5 text-body-muted">
                      <summary className="cursor-pointer text-body-on-dark">音色と詳しい制作メモ</summary>
                      <div className="mt-2">
                        <strong className="text-body-on-dark">AI案名：</strong>{plainDirectionText(intent.title)}
                        <br />
                        <strong className="text-body-on-dark">具体的な変化：</strong>{plainDirectionText(intent.generationBrief)}
                        <br />
                        <strong className="text-body-on-dark">音色：</strong>{plainDirectionText(intent.soundPalette)}
                        <br />
                        <strong className="text-body-on-dark">演奏：</strong>{plainDirectionText(intent.performanceDirection)}
                      </div>
                    </details>
                    {intent.soundSourceSuggestions.length > 0 && (
                      <div className="mt-3 rounded-sm border border-white/8 bg-white/[0.025] p-3">
                        <span className="text-[11px] uppercase tracking-wide text-primary-on-dark">
                          おすすめ音源（手持ちライブラリ）
                        </span>
                        {intent.soundSourceSuggestions.slice(0, 2).map((source) => (
                          <div key={`${source.product}-${source.character}`} className="mt-2 text-[11px] leading-5 text-body-muted">
                            <div className="font-medium text-body-on-dark">{source.product}</div>
                            <div>{plainDirectionText(source.family)} · {plainDirectionText(source.character)}</div>
                            <div className="text-ink-muted-48">検索語：{source.searchTerms.join(" / ")}</div>
                            <div className="text-ink-muted-48">{plainDirectionText(source.reason)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-3 text-[11px] leading-5 text-ink-muted-48">
                      {conciseDirectionText(intent.necessityReason ?? intent.why, 64)}
                    </p>
                    <div className="mt-auto pt-4">
                      {isWholeSongConsultation && (
                        <div className="grid gap-2">
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              className="w-full !whitespace-normal text-center"
                              disabled={preparingDirectionIntentId !== null || noGenerator}
                              onClick={() => void previewWholeSongDirection(intent, index, false)}
                            >
                              {preparingDirectionIntentId === intent.id
                                ? <LoaderCircle className="animate-spin" size={14} />
                                : playingDirectionIntentId === `${intent.id}:generated`
                                  ? <Square size={14} />
                                  : <Play size={14} />}
                              {preparingDirectionIntentId === intent.id
                                ? "準備中…"
                                : playingDirectionIntentId === `${intent.id}:generated`
                                  ? "停止"
                                  : "追加音だけ聴く"}
                            </Button>
                            <Button
                              variant="secondary"
                              className="w-full !whitespace-normal text-center"
                              disabled={preparingDirectionIntentId !== null || noGenerator}
                              onClick={() => void previewWholeSongDirection(intent, index, true)}
                            >
                              {playingDirectionIntentId === `${intent.id}:combined` ? <Square size={14} /> : <Play size={14} />}
                              {playingDirectionIntentId === `${intent.id}:combined` ? "停止" : "原曲と重ねる"}
                            </Button>
                          </div>
                          <p className="text-center text-[11px] leading-4 text-body-muted">
                            まず追加音だけで3案を比べ、必要なら原曲と重ねて確認できます。
                          </p>
                          <Button
                            variant="secondary"
                            className="w-full !whitespace-normal text-center"
                            disabled={generatingIntentId === intent.id || preparingDirectionIntentId !== null}
                            onClick={() => generateFromIntent(intent)}
                          >
                            <Layers3 size={14} /> この案で全曲を生成して結果を見る
                          </Button>
                        </div>
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
                          第二の旋律を作るには、採用中の主旋律が必要です。
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
                      全曲候補を曲の部分ごとに生成しました
                    </div>
                    <p className="mt-1 text-[11px] text-emerald-100">
                      {plainDirectionText(wholeSongGeneration.directionTitle)} · {wholeSongGeneration.generated}件生成
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
                    同じ意図から全曲の盛り上がり方と楽器別MIDIも生成しました。主旋律とコードは変更していません。
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
                              ? "曲のこの部分へ適用済み"
                              : item.status === "existing"
                                ? "現在案を維持"
                                : item.status === "preserved"
                                  ? "追加なし"
                                  : item.status === "unavailable"
                                    ? "要件不足"
                                    : "生成保留"}
                        </span>
                        <div>{plainDirectionText(item.purpose)}</div>
                      </div>
                      {item.target && (
                        <Button variant="secondary" onClick={() => openWholeSongResult(item)}>
                          {item.status === "candidate" ? `${GENERATOR_LABELS[item.generator]}候補を確認・試聴` : "この部分を確認"}
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
