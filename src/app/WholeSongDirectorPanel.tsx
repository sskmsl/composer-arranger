import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Check, CircleAlert, MessageCircle, Sparkles, WandSparkles } from "lucide-react"
import { executeArrangementAction } from "@/ai-arranger/arrangementActionExecution"
import {
  buildWholeSongDirectionProgram,
  type WholeSongArrangementAction,
  type WholeSongDirectionId,
} from "@/ai-arranger/wholeSongDirectionPlan"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, SectionCard } from "@/ui/primitives"
import type { MainTab } from "./App"

const GENERATOR_LABELS: Record<WholeSongArrangementAction["generator"], string> = {
  signature: "Signature",
  counter: "Counter",
  decoration: "Decoration",
  accompaniment: "Accompaniment",
  none: "追加なし",
}

const STATUS_LABELS: Record<WholeSongArrangementAction["status"], string> = {
  available: "生成可能",
  "already-active": "現在案あり",
  unavailable: "要件不足",
  preserve: "保持",
}

export function WholeSongDirectorPanel({ onNavigate }: { onNavigate: (tab: MainTab) => void }) {
  const project = useProjectStore((state) => state.project)
  const setWorkspace = useProjectStore((state) => state.setArrangementDirectorWorkspace)
  const savedBrief = project.arrangementDirectorWorkspace?.brief ?? ""
  const [briefDraft, setBriefDraft] = useState(savedBrief)
  const program = useMemo(
    () => buildWholeSongDirectionProgram(project, savedBrief),
    [project, savedBrief],
  )
  const selectedDirectionId = project.arrangementDirectorWorkspace?.selectedDirectionId
    ?? program.recommendedDirectionId
  const selectedDirection = program.directions.find((direction) => direction.id === selectedDirectionId)
    ?? program.directions[0]
  const defaultActionIds = (actions: WholeSongArrangementAction[]) => actions
    .filter((action) => action.status === "available" && action.generator !== "accompaniment")
    .map((action) => action.id)
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(
    () => new Set(defaultActionIds(selectedDirection.actions)),
  )
  const [generatedActionIds, setGeneratedActionIds] = useState<Set<string>>(new Set())
  const [lastTarget, setLastTarget] = useState<MainTab | null>(null)

  useEffect(() => setBriefDraft(savedBrief), [project.projectId, savedBrief])

  const saveBrief = () => {
    const nextProgram = buildWholeSongDirectionProgram(project, briefDraft)
    const nextId = project.arrangementDirectorWorkspace?.selectedDirectionId
      ?? nextProgram.recommendedDirectionId
    const nextDirection = nextProgram.directions.find((direction) => direction.id === nextId)
      ?? nextProgram.directions[0]
    setWorkspace({
      brief: briefDraft.trim(),
      selectedDirectionId: nextId,
    })
    setSelectedActionIds(new Set(defaultActionIds(nextDirection.actions)))
    setGeneratedActionIds(new Set())
    setLastTarget(null)
  }

  const selectDirection = (directionId: WholeSongDirectionId) => {
    const direction = program.directions.find((candidate) => candidate.id === directionId)
    if (!direction) return
    setWorkspace({ selectedDirectionId: directionId })
    setSelectedActionIds(new Set(defaultActionIds(direction.actions)))
    setGeneratedActionIds(new Set())
    setLastTarget(null)
  }

  const execute = (action: WholeSongArrangementAction): MainTab | null => {
    const result = executeArrangementAction(action)
    if (result.generated) {
      setGeneratedActionIds((current) => new Set(current).add(action.id))
    }
    return result.target
  }

  const generateSelected = () => {
    let target: MainTab | null = null
    for (const action of selectedDirection.actions) {
      if (!selectedActionIds.has(action.id)) continue
      target = execute(action) ?? target
    }
    setLastTarget(target)
  }

  const availableCount = selectedDirection.actions.filter((action) => action.status === "available").length
  const selectedCount = selectedDirection.actions.filter(
    (action) => action.status === "available" && selectedActionIds.has(action.id),
  ).length

  return (
    <SectionCard className="border-primary/25 bg-primary/[0.035]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-body-on-dark">
            <Sparkles size={16} className="text-primary-on-dark" /> Arrangement Director · 第3弾
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-body-muted">
            Melody・コード・テンポ・Sectionを設計図として守り、全曲で何を起こすかを先に決めます。
          </p>
        </div>
        <div className="rounded-pill bg-white/8 px-3 py-1 text-[11px] text-body-muted">
          {program.diagnosis.confirmedSections}/{program.diagnosis.totalSections} Section確認 · Review {program.diagnosis.score}
        </div>
      </div>

      <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-primary-on-dark">
        どんな景色にしたいか
        <textarea
          value={briefDraft}
          maxLength={1500}
          rows={3}
          onChange={(event) => setBriefDraft(event.target.value)}
          placeholder="例：Aメロは近く静かに、Bメロで内声を増やし、サビ前は上昇線、サビでHallと高域を開く。主旋律は変えない。"
          className="mt-1.5 w-full resize-y rounded-lg border border-hairline bg-surface-tile-2 px-3 py-2.5 text-[13px] normal-case leading-5 tracking-normal text-body-on-dark outline-none placeholder:text-ink-muted-48 focus:border-primary-focus"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={saveBrief} disabled={briefDraft.trim() === savedBrief.trim()}>
          <WandSparkles size={14} /> 全曲方針を5案設計
        </Button>
        <span className="text-[11px] text-ink-muted-48">
          全曲Arc: {program.diagnosis.energyArc}
        </span>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {program.directions.map((direction) => {
          const selected = direction.id === selectedDirection.id
          const available = direction.actions.filter((action) => action.status === "available").length
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-body-on-dark">{direction.title}</span>
                {direction.id === program.recommendedDirectionId && (
                  <span className="rounded-pill bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">推奨</span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-primary-on-dark">{direction.subtitle}</p>
              <p className="mt-2 text-[11px] leading-4 text-body-muted">{direction.summary}</p>
              <p className="mt-2 text-[11px] text-ink-muted-48">生成可能 {available}件</p>
              {direction.id === program.recommendedDirectionId && (
                <p className="mt-2 border-t border-emerald-300/15 pt-2 text-[11px] leading-4 text-emerald-100">
                  {program.recommendationReason}
                </p>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-4 rounded-lg border border-hairline bg-white/[0.025] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-body-on-dark">{selectedDirection.title} · 実行計画</div>
            <p className="mt-1 text-[11px] text-body-muted">
              生成対象だけを選択してください。既存Melodyは変更せず、候補は自動採用しません。
            </p>
          </div>
          <span className="text-[11px] text-ink-muted-48">{selectedCount}/{availableCount}件選択</span>
        </div>

        <div className="mt-3 space-y-2">
          {selectedDirection.actions.map((action) => {
            const selectable = action.status === "available"
            const checked = selectedActionIds.has(action.id)
            return (
              <label
                key={action.id}
                className={`grid gap-2 rounded-sm border px-3 py-2.5 sm:grid-cols-[1.2rem_8rem_7rem_minmax(0,1fr)] sm:items-center ${selectable
                  ? "border-hairline bg-white/[0.03]"
                  : "border-white/5 bg-white/[0.015] opacity-70"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!selectable}
                  onChange={(event) => setSelectedActionIds((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(action.id)
                    else next.delete(action.id)
                    return next
                  })}
                  className="accent-primary"
                />
                <span className="text-[11px] font-medium text-body-on-dark">{action.sectionName}</span>
                <span className="text-[11px] text-primary-on-dark">{GENERATOR_LABELS[action.generator]}</span>
                <div className="min-w-0">
                  <p className="text-[11px] leading-4 text-body-muted">{action.purpose}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted-48">
                    {action.family} · {STATUS_LABELS[action.status]} · {action.statusReason}
                  </p>
                </div>
              </label>
            )
          })}
        </div>

        {selectedDirection.actions.some((action) => action.generator === "accompaniment" && action.status === "available") && (
          <p className="mt-3 flex items-start gap-1.5 rounded-sm bg-amber-300/8 px-3 py-2 text-[11px] leading-4 text-amber-100">
            <CircleAlert size={13} className="mt-0.5 shrink-0" /> Accompanimentは候補プールを持たないため、選択時はSectionへ直接適用します。Undoで戻せます。
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={generateSelected} disabled={selectedCount === 0}>
            <WandSparkles size={14} /> 選択した{selectedCount}件を生成
          </Button>
          <Button variant="ghost" onClick={() => onNavigate("ai-partner")}>
            <MessageCircle size={14} /> AI Partnerで方向を詰める
          </Button>
          {lastTarget && (
            <Button variant="secondary" onClick={() => onNavigate(lastTarget)}>
              <ArrowRight size={14} /> 生成候補を試聴
            </Button>
          )}
          {generatedActionIds.size > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-200">
              <Check size={12} /> {generatedActionIds.size}件生成済み・Activeは維持
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
