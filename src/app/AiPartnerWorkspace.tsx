import { useEffect, useMemo, useState } from "react"
import {
  AudioLines,
  Bot,
  Coins,
  Lightbulb,
  LoaderCircle,
  Music2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react"
import { AI_AUDIO_ACCEPT, prepareAiAudio } from "@/ai-arranger/audioAnalysis"
import { buildAiArrangementContext } from "@/ai-arranger/context"
import { requestArrangementAdvice } from "@/ai-arranger/client"
import {
  decorationSettingsForIntent,
  phraseLengthForIntent,
  signatureLengthForIntent,
  signatureDirectionForIntent,
  targetTabForIntent,
} from "@/ai-arranger/generationBridge"
import type {
  AiArrangementIntent,
  AiArrangementResponse,
  AiAudioPayload,
} from "@/ai-arranger/types"
import { SECTION_ROLE_LABELS } from "@/core/section"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Pill, SectionCard, Select } from "@/ui/primitives"
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

  useEffect(() => {
    setResponse(null)
    setError(null)
  }, [effectiveSectionId, project.projectId])

  const submit = async (bypassCache = false) => {
    if (!context) {
      setError("先にコード進行を持つセクションを選択してください。")
      return
    }
    if (context.chords.length === 0) {
      setError("選択セクションにコード進行がありません。")
      return
    }
    setBusy(true)
    setError(null)
    try {
      setResponse(
        await requestArrangementAdvice(
          { prompt, context, ...(audio ? { audio } : {}) },
          { bypassCache },
        ),
      )
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
    }
    const target = targetTabForIntent(intent)
    if (target) onNavigate(target)
    setGeneratingIntentId(null)
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

          <label className="mt-4 flex flex-col gap-1.5 text-[11px] text-body-muted">
            何を相談しますか？
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={1500}
              rows={4}
              placeholder="例：このイントロに、余白を残しながら曲の顔になるピアノフレーズがほしい"
              className="resize-y rounded-lg border border-hairline bg-surface-tile-2 px-3 py-2.5 text-[14px] leading-6 text-body-on-dark outline-none placeholder:text-ink-muted-48 focus:border-primary-focus"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <Pill key={example} onClick={() => setPrompt(example)} className="!text-[11px]">
                {example}
              </Pill>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-hairline bg-white/[0.025] p-3">
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
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void submit(false)}
              disabled={busy || preparingAudio || prompt.trim().length < 3 || !context}
            >
              {busy ? <LoaderCircle className="animate-spin" size={15} /> : <Bot size={15} />}
              {busy ? "楽曲を分析中…" : audio ? "音源を聴いて3案を相談" : "AIに3案を相談"}
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
                <div className="flex items-center gap-2 text-[11px] text-ink-muted-48">
                  <Coins size={14} />
                  {response.cached
                    ? "キャッシュ · 追加費用なし"
                    : `概算 $${response.usage.estimatedCostUsd.toFixed(4)}`}
                  <span>· {response.model}</span>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DiagnosisList title="守るもの" items={response.diagnosis.protect} />
                <DiagnosisList title="避けるもの" items={response.diagnosis.avoid} />
              </div>
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
                    <div className="mt-3 rounded-sm bg-white/[0.04] p-3 text-[11px] leading-5 text-body-muted">
                      <strong className="text-body-on-dark">音色：</strong>
                      {intent.soundPalette}
                      <br />
                      <strong className="text-body-on-dark">演奏：</strong>
                      {intent.performanceDirection}
                    </div>
                    {intent.soundSourceSuggestions.length > 0 && (
                      <div className="mt-3">
                        <span className="text-[10px] uppercase tracking-wide text-ink-muted-48">
                          音源検索の手掛かり
                        </span>
                        {intent.soundSourceSuggestions.slice(0, 2).map((source) => (
                          <p key={`${source.family}-${source.character}`} className="mt-1 text-[11px] leading-5 text-body-muted">
                            {source.family} · {source.character} — {source.searchTerms.join(" / ")}
                          </p>
                        ))}
                      </div>
                    )}
                    <p className="mt-3 text-[11px] leading-5 text-ink-muted-48">
                      {intent.why}
                    </p>
                    <div className="mt-auto pt-4">
                      {!noGenerator && (
                        <Button
                          variant="secondary"
                          className="w-full !whitespace-normal text-center"
                          disabled={counterUnavailable || generatingIntentId === intent.id}
                          onClick={() => generateFromIntent(intent)}
                        >
                          <Music2 size={14} /> この方向を音の候補にする
                        </Button>
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
                onClick={() => void submit(true)}
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
