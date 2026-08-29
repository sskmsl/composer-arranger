import { useMemo, useState } from "react"
import { ArrowRight, Check, CheckCircle2, Layers3, WandSparkles, Waypoints } from "lucide-react"
import { buildAiPartnerOrchestrationPlan } from "@/ai-arranger/aiPartnerOrchestrator"
import {
  executeArrangementAction,
  executeArrangementActions,
} from "@/ai-arranger/arrangementActionExecution"
import { buildMultiPartArrangementPackage } from "@/ai-arranger/multiPartArrangementPackage"
import { generationResultLinks } from "@/ai-arranger/generationResultNavigation"
import {
  buildWholeSongDirectionProgram,
  type WholeSongDirectionId,
} from "@/ai-arranger/wholeSongDirectionPlan"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, SectionCard } from "@/ui/primitives"
import type { MainTab } from "./App"

const LABELS = {
  signature: "Signature Phrase",
  counter: "Counter",
  decoration: "Decoration",
  accompaniment: "Accompaniment",
  none: "追加なし",
} as const

export function AiPartnerControlCenter({ onNavigate }: { onNavigate: (tab: MainTab) => void }) {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const setWorkspace = useProjectStore((state) => state.setArrangementDirectorWorkspace)
  const [generated, setGenerated] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    generated: number
    skipped: number
    targets: MainTab[]
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
  const activeStep = batchResult ? 2 : 1

  const runNext = () => {
    if (!plan.nextAction) return
    const result = executeArrangementAction(plan.nextAction)
    setGenerated(result.generated)
    if (result.target) onNavigate(result.target)
  }

  const runFullSong = () => {
    const result = executeArrangementActions(fullSongActions)
    setBatchResult({
      generated: result.generatedCount,
      skipped: result.skippedCount,
      targets: result.targets,
    })
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
        <p className="mt-2 text-[12px] leading-5 text-body-on-dark">{plan.diagnosis}</p>
        <p className="mt-1 text-[11px] leading-4 text-body-muted">全曲の流れ: {plan.energyArc}</p>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-body-on-dark">どの方向で進めますか？</div>
          <span className="rounded-pill bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-100">
            AI推奨: {directionProgram.directions.find((item) => item.id === directionProgram.recommendedDirectionId)?.title}
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
                  <span className="text-[12px] font-semibold text-body-on-dark">{direction.title}</span>
                  {selected && <Check size={14} className="shrink-0 text-primary-on-dark" />}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-primary-on-dark">{direction.subtitle}</p>
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
            <div className="text-[14px] font-semibold text-body-on-dark">{selectedDirection.title}で進める</div>
            <p className="mt-1 text-[11px] leading-4 text-body-muted">{selectedDirection.summary}</p>
            {selectedDirection.id === directionProgram.recommendedDirectionId && (
              <p className="mt-1 text-[11px] leading-4 text-emerald-100">{directionProgram.recommendationReason}</p>
            )}
          </div>
          <Button onClick={runFullSong} disabled={fullSongActions.length === 0} className="shrink-0 justify-center sm:min-w-52">
            <Layers3 size={14} /> この方針で全曲候補を生成
          </Button>
        </div>
        {fullSongActions.length === 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-amber-100">この曲は追加生成より、現在の候補を試聴する段階です。</p>
            <Button variant="secondary" onClick={() => onNavigate("audition")}>
              現在の候補を試聴 <ArrowRight size={14} />
            </Button>
          </div>
        )}
        {batchResult && (
          <div className="mt-3 rounded-sm border border-emerald-300/20 bg-emerald-400/[0.07] p-3">
            <p className="text-[11px] text-emerald-100">
              {batchResult.generated}件の候補を生成しました{batchResult.skipped > 0 ? `（${batchResult.skipped}件保留）` : ""}。自動採用はしていません。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {generationResultLinks(batchResult.targets).map((result) => (
                <Button key={result.tab} onClick={() => onNavigate(result.tab)}>
                  {result.label}候補を確認 <ArrowRight size={14} />
                </Button>
              ))}
              <Button variant="secondary" onClick={() => setBatchResult(null)}>別の方針を試す</Button>
              <Button variant="ghost" onClick={() => onNavigate("arrangement")}>詳細を調整</Button>
            </div>
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
                <span key={item} className="rounded-pill border border-hairline px-2 py-1 text-[11px] text-body-muted">{item}</span>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-body-muted">{plan.feedbackSummary}</p>
          </div>
          <div className="rounded-sm bg-white/[0.03] p-3">
            {plan.nextAction ? (
              <>
                <div className="text-[11px] font-medium text-body-on-dark">
                  個別の次の一手: {plan.nextAction.sectionName} · {LABELS[plan.nextAction.generator]}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-body-muted">{plan.nextAction.purpose}</p>
                <Button variant="secondary" className="mt-2" onClick={runNext}><WandSparkles size={14} /> この作業だけ生成</Button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-emerald-200"><CheckCircle2 size={14} /> 個別追加は保留</div>
            )}
            {generated && <p className="mt-2 text-[11px] text-emerald-200">候補を生成しました。</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-ink-muted-48">Plan {fullSongPackage.qualityGate.score} · 実行可能 {fullSongActions.length}件</span>
          <Button variant="ghost" onClick={() => onNavigate("arrangement")}>実行計画とQuality Gate <ArrowRight size={14} /></Button>
        </div>
      </details>
    </SectionCard>
  )
}
