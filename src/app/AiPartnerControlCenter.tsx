import { useMemo, useState } from "react"
import { ArrowRight, Check, CheckCircle2, Layers3, LoaderCircle, WandSparkles, Waypoints } from "lucide-react"
import { buildAiPartnerOrchestrationPlan } from "@/ai-arranger/aiPartnerOrchestrator"
import { plainDirectionText } from "@/ai-arranger/directionPresentation"
import {
  executeArrangementAction,
  executeArrangementActions,
} from "@/ai-arranger/arrangementActionExecution"
import { buildMultiPartArrangementPackage } from "@/ai-arranger/multiPartArrangementPackage"
import {
  currentCandidateResultItems,
  wholeSongGenerationResultItems,
  type CurrentCandidateResultItem,
  type WholeSongGenerationResultItem,
  type WholeSongGenerationResultStatus,
} from "@/ai-arranger/generationResultNavigation"
import {
  buildWholeSongDirectionProgram,
  type WholeSongDirectionId,
} from "@/ai-arranger/wholeSongDirectionPlan"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, SectionCard } from "@/ui/primitives"
import type { MainTab } from "./App"

const LABELS = {
  melody: "主旋律",
  phrase: "短いフレーズ",
  signature: "曲の目印になるフレーズ",
  counter: "主旋律へ返す第二の旋律",
  decoration: "一音や短い装飾",
  accompaniment: "伴奏",
  none: "追加なし",
} as const

const RESULT_STATUS_LABELS: Record<WholeSongGenerationResultStatus, string> = {
  candidate: "候補生成済み",
  applied: "Sectionへ適用済み",
  existing: "現在案を維持",
  preserved: "追加なし",
  unavailable: "要件不足",
  failed: "生成保留",
}

const RESULT_STATUS_CLASSES: Record<WholeSongGenerationResultStatus, string> = {
  candidate: "bg-primary/10 text-primary-on-dark",
  applied: "bg-emerald-400/10 text-emerald-100",
  existing: "bg-cyan-400/10 text-cyan-100",
  preserved: "bg-white/5 text-body-muted",
  unavailable: "bg-amber-300/10 text-amber-100",
  failed: "bg-red-400/10 text-red-200",
}

export function AiPartnerControlCenter({ onNavigate }: { onNavigate: (tab: MainTab) => void }) {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const setWorkspace = useProjectStore((state) => state.setArrangementDirectorWorkspace)
  const focusCandidateWorkspace = useProjectStore((state) => state.focusCandidateWorkspace)
  const generateFullSongArrangement = useProjectStore((state) => state.generateFullSongArrangement)
  const [generated, setGenerated] = useState(false)
  const [showCurrentResults, setShowCurrentResults] = useState(false)
  const [generatingFullSong, setGeneratingFullSong] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<{
    generated: number
    skipped: number
    items: WholeSongGenerationResultItem[]
  } | null>(null)
  const plan = useMemo(
    () => buildAiPartnerOrchestrationPlan(project, selectedSectionId),
    [project, selectedSectionId],
  )
  const directionProgram = useMemo(
    () => buildWholeSongDirectionProgram(project, plan.constraints.join("。")),
    [plan.constraints, project],
  )
  const selectedDirectionId = project.arrangementDirectorWorkspace?.selectedDirectionId
    ?? directionProgram.recommendedDirectionId
  const selectedDirection = directionProgram.directions.find(
    (direction) => direction.id === selectedDirectionId,
  ) ?? directionProgram.directions[0]
  const fullSongPackage = useMemo(
    () => buildMultiPartArrangementPackage(project, plan.directionId),
    [plan.directionId, project],
  )
  const fullSongActions = selectedDirection.actions.filter(
    (action) => action.status === "available",
  )
  const currentResults = useMemo(
    () => currentCandidateResultItems(project),
    [project],
  )
  const activeStep = batchResult ? 2 : 1

  const runNext = () => {
    if (!plan.nextAction) return
    const result = executeArrangementAction(plan.nextAction)
    setGenerated(result.generated)
    if (result.target) onNavigate(result.target)
  }

  const runFullSong = async () => {
    if (generatingFullSong || fullSongActions.length === 0) return
    setGeneratingFullSong(true)
    setGenerationError(null)
    setBatchResult(null)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const result = executeArrangementActions(fullSongActions)
      const directionEnergyDelta = selectedDirection.character === "minimal"
        ? -8
        : selectedDirection.character === "cinematic"
          ? 8
          : selectedDirection.character === "rhythmic"
            ? 5
            : selectedDirection.character === "dark-experimental"
              ? 2
              : 0
      generateFullSongArrangement(
        `${selectedDirection.title}。${selectedDirection.summary}`,
        {
          intention: selectedDirection.summary,
          character: selectedDirection.character,
          energyDelta: directionEnergyDelta,
          surpriseLevel: selectedDirection.character === "dark-experimental" ? 0.6 : 0.15,
        },
      )
      setBatchResult({
        generated: result.generatedCount,
        skipped: result.skippedCount,
        items: wholeSongGenerationResultItems(selectedDirection.actions, result.results),
      })
    } catch (reason) {
      setGenerationError(reason instanceof Error ? reason.message : "全曲候補を生成できませんでした。")
    } finally {
      setGeneratingFullSong(false)
    }
  }

  const openResult = (item: WholeSongGenerationResultItem) => {
    if (!item.target || item.generator === "none") return
    const current = currentResults.find(
      (candidate) =>
        candidate.sectionId === item.sectionId &&
        candidate.generator === item.generator,
    )
    focusCandidateWorkspace(item.sectionId, item.generator, current?.latestBatchId)
    onNavigate(item.target)
  }

  const openCurrentResult = (item: CurrentCandidateResultItem) => {
    focusCandidateWorkspace(item.sectionId, item.generator, item.latestBatchId)
    onNavigate(item.target)
  }

  const selectDirection = (directionId: WholeSongDirectionId) => {
    setWorkspace({ selectedDirectionId: directionId })
    setBatchResult(null)
  }

  return (
    <SectionCard className="border-primary/30 bg-primary/[0.045]">
      <div className="grid grid-cols-3 gap-2">
        {["曲を診断", "方針を選ぶ", "生成して試聴"].map((label, index) => (
          <div key={label} className={`rounded-sm border px-2 py-2 text-center text-[11px] ${index === activeStep
            ? "border-primary/45 bg-primary/10 text-primary-on-dark"
            : "border-hairline bg-white/[0.025] text-body-muted"
          }`}>
            <span className="mr-1 opacity-60">{index + 1}</span>{label}
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-hairline bg-surface-tile-2 p-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
          <Waypoints size={15} className="text-primary-on-dark" /> この曲の診断
        </div>
        <p className="mt-2 text-[12px] leading-5 text-body-on-dark">{plainDirectionText(plan.diagnosis)}</p>
        <p className="mt-1 text-[11px] leading-4 text-body-muted">曲の盛り上がり方: {plainDirectionText(plan.energyArc)}</p>
      </div>

      {project.sourceImport?.type === "midi" && (
        <div className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-400/[0.055] px-3 py-2.5">
          <p className="text-[12px] font-semibold text-emerald-100">原曲保護モード</p>
          <p className="mt-1 text-[11px] leading-4 text-body-muted">
            読み込んだコードと主旋律は変更しません。Accompaniment・Counter・Decoration・Signature Phraseなど、独立した補助パートだけを候補生成します。
          </p>
        </div>
      )}

      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-body-on-dark">どの方向で進めますか？</div>
          <span className="rounded-pill bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-100">
            AI推奨: {plainDirectionText(directionProgram.directions.find((item) => item.id === directionProgram.recommendedDirectionId)?.title ?? "")}
          </span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {directionProgram.directions.map((direction) => {
            const selected = direction.id === selectedDirection.id
            return (
              <button
                key={direction.id}
                type="button"
                onClick={() => selectDirection(direction.id)}
                className={`rounded-lg border p-3 text-left transition ${selected
                  ? "border-primary bg-primary/10"
                  : "border-hairline bg-white/[0.025] hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold text-body-on-dark">{plainDirectionText(direction.title)}</span>
                  {selected && <Check size={14} className="shrink-0 text-primary-on-dark" />}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-primary-on-dark">{plainDirectionText(direction.subtitle)}</p>
                {direction.id === directionProgram.recommendedDirectionId && (
                  <span className="mt-2 inline-block rounded-pill bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-100">推奨</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-primary/35 bg-primary/[0.07] p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-body-on-dark">{plainDirectionText(selectedDirection.title)}で進める</div>
            <p className="mt-1 text-[11px] leading-4 text-body-muted">{plainDirectionText(selectedDirection.summary)}</p>
            {selectedDirection.id === directionProgram.recommendedDirectionId && (
              <p className="mt-1 text-[11px] leading-4 text-emerald-100">{plainDirectionText(directionProgram.recommendationReason)}</p>
            )}
          </div>
          <Button onClick={() => void runFullSong()} disabled={generatingFullSong || fullSongActions.length === 0} className="shrink-0 justify-center sm:min-w-52">
            {generatingFullSong ? <LoaderCircle size={14} className="animate-spin" /> : <Layers3 size={14} />}
            {generatingFullSong ? "全曲候補を生成中…" : "この方針で全曲候補を生成"}
          </Button>
        </div>
        {generationError && (
          <p className="mt-3 rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
            生成に失敗しました: {generationError}
          </p>
        )}
        {fullSongActions.length === 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] text-amber-100">この曲は追加生成より、現在の候補を試聴する段階です。</p>
              <Button variant="secondary" onClick={() => setShowCurrentResults((value) => !value)}>
                Section別に現在候補を確認 <ArrowRight size={14} />
              </Button>
            </div>
            {showCurrentResults && (
              <div className="mt-3 rounded-sm border border-white/10 bg-black/10 p-3">
                {currentResults.length === 0 ? (
                  <p className="text-[11px] text-body-muted">試聴できる候補はまだありません。</p>
                ) : (
                  <div className="space-y-1.5">
                    {currentResults.map((item) => (
                      <div
                        key={item.id}
                        className="grid gap-2 rounded-sm border border-white/10 bg-white/[0.025] px-3 py-2 sm:grid-cols-[7rem_8rem_minmax(0,1fr)_auto] sm:items-center"
                      >
                        <span className="text-[11px] font-semibold text-body-on-dark">{item.sectionName}</span>
                        <span className="text-[11px] text-primary-on-dark">{LABELS[item.generator]}</span>
                        <span className="text-[11px] text-body-muted">
                          {item.generator === "accompaniment"
                            ? "適用中の伴奏"
                            : `最新 ${item.candidateCount}候補${item.applied ? " · Active設定あり" : ""}`}
                        </span>
                        <Button variant="secondary" onClick={() => openCurrentResult(item)}>
                          このSectionを確認・試聴 <ArrowRight size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {batchResult && (
          <div className="mt-3 rounded-sm border border-emerald-300/20 bg-emerald-400/[0.07] p-3">
            <p className="text-[13px] font-semibold text-emerald-100">全曲の追加パートを生成しました</p>
            <p className="mt-1 text-[11px] leading-4 text-body-muted">
              次は、読み込んだ原曲だけの音と、AI生成パートを重ねた音を聴き比べてください。
            </p>
            <Button className="mt-3" onClick={() => onNavigate("arrangement")}>
              <Layers3 size={14} /> 生成前後を聴き比べる
            </Button>
            <details className="mt-3 rounded-sm border border-white/10 bg-black/10 p-3">
              <summary className="cursor-pointer text-[11px] text-body-muted">
                Section別の生成内容を見る（{batchResult.generated}件生成{batchResult.skipped > 0 ? `・${batchResult.skipped}件保留` : ""}）
              </summary>
              <div className="mt-3 space-y-1.5">
                {batchResult.items.map((item) => (
                  <div
                    key={item.actionId}
                    className="grid gap-2 rounded-sm border border-white/10 bg-black/10 px-3 py-2 sm:grid-cols-[7rem_7rem_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <span className="text-[11px] font-semibold text-body-on-dark">{item.sectionName}</span>
                    <span className="text-[11px] text-primary-on-dark">{LABELS[item.generator]}</span>
                    <div className="min-w-0">
                      <span className={`inline-flex rounded-pill px-2 py-0.5 text-[11px] ${RESULT_STATUS_CLASSES[item.status]}`}>
                        {RESULT_STATUS_LABELS[item.status]}
                      </span>
                      <p className="mt-1 text-[11px] leading-4 text-body-muted">{plainDirectionText(item.purpose)}</p>
                    </div>
                    {item.target && (
                      <Button variant="secondary" onClick={() => openResult(item)}>
                        {item.status === "candidate" ? `${LABELS[item.generator]}候補を確認・試聴` : "Sectionを確認"} <ArrowRight size={14} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </details>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setBatchResult(null)}>別の方針を試す</Button>
            </div>
          </div>
        )}
        {!batchResult && project.fullSongArrangement && (
          <div className="mt-3 flex flex-col gap-2 rounded-sm border border-primary/25 bg-primary/[0.055] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[12px] font-semibold text-body-on-dark">生成済みの全曲アレンジがあります</p>
              <p className="mt-1 text-[11px] text-body-muted">原曲のみ／原曲＋AI生成／AI生成のみを切り替えて確認できます。</p>
            </div>
            <Button variant="secondary" onClick={() => onNavigate("arrangement")}>
              生成前後を聴き比べる <ArrowRight size={14} />
            </Button>
          </div>
        )}
      </div>

      <details className="mt-3 rounded-lg border border-hairline bg-black/10 p-3">
        <summary className="cursor-pointer text-[11px] font-medium text-body-muted hover:text-body-on-dark">
          詳細設定・次の一手を表示
        </summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-sm bg-white/[0.03] p-3">
            <div className="text-[11px] font-medium text-body-on-dark">守る条件</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plan.protect.map((item) => (
                <span key={item} className="rounded-pill border border-hairline px-2 py-1 text-[11px] text-body-muted">{plainDirectionText(item)}</span>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-body-muted">{plainDirectionText(plan.feedbackSummary)}</p>
          </div>
          <div className="rounded-sm bg-white/[0.03] p-3">
            {plan.nextAction ? (
              <>
                <div className="text-[11px] font-medium text-body-on-dark">
                  個別の次の一手: {plan.nextAction.sectionName} · {LABELS[plan.nextAction.generator]}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-body-muted">{plainDirectionText(plan.nextAction.purpose)}</p>
                <Button variant="secondary" className="mt-2" onClick={runNext}><WandSparkles size={14} /> この作業だけ生成</Button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-emerald-200"><CheckCircle2 size={14} /> 個別追加は保留</div>
            )}
            {generated && <p className="mt-2 text-[11px] text-emerald-200">候補を生成しました。</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-ink-muted-48">内部確認 {fullSongPackage.qualityGate.score}点 · 生成できる項目 {fullSongActions.length}件</span>
          <Button variant="ghost" onClick={() => onNavigate("arrangement")}>詳しい生成内容を見る <ArrowRight size={14} /></Button>
        </div>
      </details>
    </SectionCard>
  )
}
