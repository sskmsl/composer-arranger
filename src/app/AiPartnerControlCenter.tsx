import { useMemo, useState } from "react"
import { ArrowRight, Check, CheckCircle2, Layers3, WandSparkles, Waypoints } from "lucide-react"
import { buildAiPartnerOrchestrationPlan } from "@/ai-arranger/aiPartnerOrchestrator"
import {
  executeArrangementAction,
  executeArrangementActions,
} from "@/ai-arranger/arrangementActionExecution"
import { buildMultiPartArrangementPackage } from "@/ai-arranger/multiPartArrangementPackage"
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
  const [batchResult, setBatchResult] = useState<{ generated: number; skipped: number } | null>(null)
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
  const fullSongActions = fullSongPackage.stages.flatMap((stage) =>
    stage.actions.filter((action) => action.status === "available"),
  )

  const runNext = () => {
    if (!plan.nextAction) return
    const result = executeArrangementAction(plan.nextAction)
    setGenerated(result.generated)
    if (result.target) onNavigate(result.target)
  }

  const runFullSong = () => {
    const result = executeArrangementActions(fullSongActions)
    setBatchResult({ generated: result.generatedCount, skipped: result.skippedCount })
  }

  const selectDirection = (directionId: WholeSongDirectionId) => {
    setWorkspace({ selectedDirectionId: directionId })
    setBatchResult(null)
  }

  return (
    <SectionCard className="border-primary/30 bg-primary/[0.045]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-body-on-dark">
            <Waypoints size={16} className="text-primary" /> AI Partnerの次の一手
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-body-muted">
            曲全体・現在のSection・会話で確定した制約・採用／Rejectを見て、既存Generatorから一つだけ優先提案します。
          </p>
        </div>
        <span className="rounded-pill bg-white/8 px-3 py-1 text-[11px] text-body-muted">
          Review {plan.score} · 候補作業 {plan.remainingActionCount}件
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-hairline bg-surface-tile-2 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-primary">
            {plan.directionTitle}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-body-on-dark">{plan.diagnosis}</p>
          <p className="mt-2 text-[11px] leading-5 text-body-muted">全曲Arc: {plan.energyArc}</p>
          <p className="mt-1 text-[11px] leading-5 text-body-muted">{plan.feedbackSummary}</p>
        </div>

        <div className="rounded-lg border border-primary/25 bg-primary/[0.06] p-3">
          {plan.nextAction ? (
            <>
              <div className="flex items-center gap-2 text-[12px] font-semibold text-body-on-dark">
                <WandSparkles size={15} className="text-primary" />
                {plan.nextAction.sectionName} · {LABELS[plan.nextAction.generator]}
              </div>
              <p className="mt-2 text-[11px] leading-5 text-body-on-dark">{plan.nextAction.purpose}</p>
              <p className="mt-1 text-[11px] leading-5 text-body-muted">{plan.nextActionReason}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={runNext}>
                  <WandSparkles size={14} /> この作業を実行
                </Button>
                <Button variant="secondary" onClick={() => onNavigate("arrangement")}>
                  曲全体の実行計画 <ArrowRight size={14} />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-200">
                <CheckCircle2 size={15} /> 追加生成は保留
              </div>
              <p className="mt-2 text-[11px] leading-5 text-body-muted">{plan.nextActionReason}</p>
            </>
          )}
          {generated && (
            <p className="mt-2 text-[11px] text-emerald-200">
              候補を生成しました。自動採用せず、Generator画面で試聴できます。
            </p>
          )}
        </div>
      </div>

      {plan.protect.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.protect.map((item) => (
            <span key={item} className="rounded-pill border border-hairline px-2.5 py-1 text-[11px] text-body-muted">
              守る: {item}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 rounded-lg border border-primary/25 bg-black/10 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-body-on-dark">全曲アレンジ方針 · 5案</div>
            <p className="mt-1 text-[11px] leading-5 text-body-muted">
              選択しただけでは音を生成しません。各案は、Sectionごとの主要なGenerator・楽器Family・役割まで先に設計します。
            </p>
          </div>
          <span className="rounded-pill bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-100">
            AI推奨: {directionProgram.directions.find((item) => item.id === directionProgram.recommendedDirectionId)?.title}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
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
                  {selected && <Check size={14} className="shrink-0 text-primary" />}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-primary">{direction.subtitle}</p>
                <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-body-muted">{direction.summary}</p>
                <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
                  {direction.actions.slice(0, 4).map((action) => (
                    <p key={action.id} className="truncate text-[11px] text-ink-muted-48">
                      {action.sectionName}: {LABELS[action.generator]} · {action.family}
                    </p>
                  ))}
                  {direction.actions.length > 4 && (
                    <p className="text-[11px] text-ink-muted-48">ほか{direction.actions.length - 4} Section</p>
                  )}
                </div>
                {direction.id === directionProgram.recommendedDirectionId && (
                  <p className="mt-2 text-[11px] leading-4 text-emerald-100">
                    推奨理由: {directionProgram.recommendationReason}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-400/[0.045] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-body-on-dark">
              {selectedDirection.title} · Full Song Arrangement
            </div>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-body-muted">
              Foundation → Movement → Colorの順で、各Sectionに必要な既存Generatorだけを実行します。StringsはString Answer候補として生成し、BassとSpaceは専用Generatorがないため設計指示のまま保持します。
            </p>
          </div>
          <span className="rounded-pill bg-violet-400/10 px-2.5 py-1 text-[11px] text-violet-100">
            Plan {fullSongPackage.qualityGate.score} · 実行可能 {fullSongActions.length}件
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={runFullSong} disabled={fullSongActions.length === 0}>
            <Layers3 size={14} /> この案だけを実音生成
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("arrangement")}>
            実行計画とQuality Gateを確認 <ArrowRight size={14} />
          </Button>
          {batchResult && (
            <span className="text-[11px] text-emerald-200">
              {batchResult.generated}件生成{batchResult.skipped > 0 ? ` · ${batchResult.skipped}件保留` : ""}。自動採用はしていません。
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
