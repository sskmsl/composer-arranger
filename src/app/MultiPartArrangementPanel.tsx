import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Check, Layers3, ShieldCheck, WandSparkles } from "lucide-react"
import { executeArrangementAction } from "@/ai-arranger/arrangementActionExecution"
import {
  buildMultiPartArrangementPackage,
  type ArrangementPackagePartRole,
  type ArrangementPackagePartState,
  type ArrangementPackageStage,
} from "@/ai-arranger/multiPartArrangementPackage"
import { buildWholeSongDirectionProgram } from "@/ai-arranger/wholeSongDirectionPlan"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, SectionCard } from "@/ui/primitives"
import type { MainTab } from "./App"

const PART_LABELS: Record<ArrangementPackagePartRole, string> = {
  lead: "Melody",
  bass: "Bass",
  rhythm: "Rhythm",
  harmony: "Harmony",
  strings: "Strings",
  counter: "Counter",
  color: "Color",
  space: "Space",
}

const STATE_LABELS: Record<ArrangementPackagePartState, string> = {
  protect: "守る",
  enter: "登場",
  continue: "継続",
  withdraw: "退場",
  transform: "変形",
  answer: "応答",
  hold: "保持",
  silence: "休止",
}

const STATE_CLASS: Record<ArrangementPackagePartState, string> = {
  protect: "border-sky-400/25 bg-sky-400/8 text-sky-100",
  enter: "border-emerald-400/25 bg-emerald-400/8 text-emerald-100",
  continue: "border-white/10 bg-white/[0.035] text-body-muted",
  withdraw: "border-amber-300/20 bg-amber-300/5 text-amber-100",
  transform: "border-violet-400/25 bg-violet-400/8 text-violet-100",
  answer: "border-primary/30 bg-primary/10 text-primary",
  hold: "border-cyan-300/20 bg-cyan-300/5 text-cyan-100",
  silence: "border-white/5 bg-black/15 text-ink-muted-48",
}

export function MultiPartArrangementPanel({ onNavigate }: { onNavigate: (tab: MainTab) => void }) {
  const project = useProjectStore((state) => state.project)
  const brief = project.arrangementDirectorWorkspace?.brief ?? ""
  const directionProgram = useMemo(
    () => buildWholeSongDirectionProgram(project, brief),
    [project, brief],
  )
  const directionId = project.arrangementDirectorWorkspace?.selectedDirectionId
    ?? directionProgram.recommendedDirectionId
  const arrangementPackage = useMemo(
    () => buildMultiPartArrangementPackage(project, directionId),
    [project, directionId],
  )
  const [stageId, setStageId] = useState<ArrangementPackageStage>("foundation")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [generatedIds, setGeneratedIds] = useState<Set<string>>(new Set())
  const [lastTarget, setLastTarget] = useState<MainTab | null>(null)

  useEffect(() => {
    setStageId("foundation")
    setSelectedIds(new Set())
    setGeneratedIds(new Set())
    setLastTarget(null)
  }, [directionId, project.projectId])

  const stage = arrangementPackage.stages.find((candidate) => candidate.id === stageId)
    ?? arrangementPackage.stages[0]
  const availableActions = stage.actions.filter((action) => action.status === "available")
  const selectedCount = availableActions.filter((action) => selectedIds.has(action.id)).length

  const generateStage = () => {
    let nextTarget: MainTab | null = null
    const completed = new Set(generatedIds)
    for (const action of availableActions) {
      if (!selectedIds.has(action.id)) continue
      const result = executeArrangementAction(action)
      if (result.generated) completed.add(action.id)
      nextTarget = result.target ?? nextTarget
    }
    setGeneratedIds(completed)
    setSelectedIds(new Set())
    setLastTarget(nextTarget)
  }

  const chooseAll = () => setSelectedIds(new Set(availableActions.map((action) => action.id)))

  return (
    <SectionCard className="border-violet-400/20 bg-violet-400/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-body-on-dark">
            <Layers3 size={16} className="text-violet-300" /> Multi-Part Arrangement Package · 第4弾
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-body-muted">
            {arrangementPackage.summary}
          </p>
          <p className="mt-1 text-[11px] text-violet-200">{arrangementPackage.title}</p>
        </div>
        <div className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-[11px] ${arrangementPackage.qualityGate.status === "ready"
          ? "bg-emerald-400/10 text-emerald-200"
          : arrangementPackage.qualityGate.status === "blocked"
            ? "bg-red-400/10 text-red-200"
            : "bg-amber-300/10 text-amber-100"
        }`}>
          {arrangementPackage.qualityGate.status === "ready" ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
          Plan Quality {arrangementPackage.qualityGate.score}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {arrangementPackage.sections.map((section) => (
          <article key={section.sectionId} className="rounded-lg border border-hairline bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[12px] font-semibold text-body-on-dark">{section.sectionName}</span>
                <span className="ml-2 text-[11px] text-ink-muted-48">Energy {section.targetEnergy} · 上限 {section.densityCeiling} Role</span>
              </div>
              <span className="rounded-pill bg-white/5 px-2 py-0.5 text-[11px] text-body-muted">{section.climaxPolicy}</span>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              {section.parts.map((part) => (
                <div key={part.id} className={`min-w-0 rounded-sm border px-2 py-2 ${STATE_CLASS[part.state]}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wide">{PART_LABELS[part.partRole]}</span>
                    <span className="shrink-0 text-[11px] opacity-70">{STATE_LABELS[part.state]}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11px] leading-4 opacity-80">{part.purpose}</p>
                  <p className="mt-1 text-[11px] opacity-55">{part.register} · {part.distance}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-hairline bg-white/[0.025] p-3">
        <div className="text-[12px] font-semibold text-body-on-dark">段階的に生成</div>
        <p className="mt-1 text-[11px] leading-4 text-body-muted">
          Foundation → Movement → Colorの順に確認します。Bass・Strings・Spaceは現段階では設計指示として保持し、低品質な仮MIDIは作りません。
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {arrangementPackage.stages.map((candidate) => {
            const active = candidate.id === stage.id
            const available = candidate.actions.filter((action) => action.status === "available").length
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => {
                  setStageId(candidate.id)
                  setSelectedIds(new Set())
                  setLastTarget(null)
                }}
                className={`rounded-lg border p-3 text-left ${active ? "border-violet-400/50 bg-violet-400/10" : "border-hairline bg-white/[0.02]"}`}
              >
                <span className="text-[11px] font-semibold text-body-on-dark">{candidate.title}</span>
                <p className="mt-1 text-[11px] leading-4 text-body-muted">{candidate.purpose}</p>
                <p className="mt-2 text-[11px] text-ink-muted-48">生成可能 {available}件</p>
              </button>
            )
          })}
        </div>

        <div className="mt-3 space-y-1.5">
          {stage.actions.length === 0 && (
            <p className="rounded-sm bg-white/[0.025] px-3 py-2 text-[11px] text-ink-muted-48">この段階で追加生成すべきRoleはありません。</p>
          )}
          {stage.actions.map((action) => {
            const available = action.status === "available"
            return (
              <label key={action.id} className={`grid gap-2 rounded-sm border px-3 py-2 sm:grid-cols-[1.2rem_8rem_7rem_minmax(0,1fr)] sm:items-center ${available ? "border-hairline bg-white/[0.03]" : "border-white/5 bg-white/[0.015] opacity-65"}`}>
                <input
                  type="checkbox"
                  disabled={!available}
                  checked={selectedIds.has(action.id)}
                  onChange={(event) => setSelectedIds((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(action.id)
                    else next.delete(action.id)
                    return next
                  })}
                  className="accent-violet-400"
                />
                <span className="text-[11px] font-medium text-body-on-dark">{action.sectionName}</span>
                <span className="text-[11px] text-violet-200">{action.generator}</span>
                <span className="text-[11px] leading-4 text-body-muted">{action.purpose} · {action.statusReason}</span>
              </label>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={chooseAll} disabled={availableActions.length === 0}>生成可能を選択</Button>
          <Button onClick={generateStage} disabled={selectedCount === 0}>
            <WandSparkles size={14} /> この段階を{selectedCount}件生成
          </Button>
          {lastTarget && (
            <Button variant="secondary" onClick={() => onNavigate(lastTarget)}>
              <ArrowRight size={14} /> 生成候補を試聴
            </Button>
          )}
          {generatedIds.size > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-200"><Check size={12} /> {generatedIds.size}件生成済み</span>
          )}
        </div>
        {stage.id === "foundation" && availableActions.length > 0 && (
          <p className="mt-2 text-[11px] leading-4 text-amber-100">FoundationのAccompanimentはSectionへ直接適用されます。必要なSectionだけ選び、Undoで戻せます。</p>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-white/5 bg-black/10 px-3 py-2">
          <div>
            <p className="text-[11px] font-medium text-body-on-dark">実音 Quality Gate</p>
            <p className="mt-0.5 text-[11px] text-body-muted">現在Set ActiveのPreview／MIDI材料を段階生成のたびに再評価します。</p>
          </div>
          <span className={`rounded-pill px-2.5 py-1 text-[11px] ${arrangementPackage.executionGate.status === "ready"
            ? "bg-emerald-400/10 text-emerald-200"
            : arrangementPackage.executionGate.status === "blocked"
              ? "bg-red-400/10 text-red-200"
              : arrangementPackage.executionGate.status === "pending"
                ? "bg-white/5 text-body-muted"
                : "bg-amber-300/10 text-amber-100"
          }`}>
            {arrangementPackage.executionGate.status} · {arrangementPackage.executionGate.score}
          </span>
        </div>
        {arrangementPackage.executionGate.findings.map((finding) => (
          <div key={`execution:${finding.id}`} className="rounded-sm border border-white/5 bg-black/10 px-3 py-2">
            <p className="text-[11px] font-medium text-body-on-dark">{finding.title}</p>
            <p className="mt-1 text-[11px] leading-4 text-body-muted">{finding.evidence}</p>
            <p className="mt-1 text-[11px] leading-4 text-cyan-200">{finding.recommendation}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        <p className="text-[11px] font-medium text-body-on-dark">Plan Quality Gate</p>
        {arrangementPackage.qualityGate.findings.map((finding) => (
          <div key={finding.id} className="rounded-sm border border-white/5 bg-black/10 px-3 py-2">
            <p className="text-[11px] font-medium text-body-on-dark">{finding.title}</p>
            <p className="mt-1 text-[11px] leading-4 text-body-muted">{finding.evidence}</p>
            <p className="mt-1 text-[11px] leading-4 text-violet-200">{finding.recommendation}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
