import { useMemo, useState } from "react"
import {
  AudioLines,
  CircleCheck,
  Layers3,
  Waypoints,
  TriangleAlert,
} from "lucide-react"
import { buildAiArrangementContext } from "@/ai-arranger/context"
import { plainDirectionText } from "@/ai-arranger/directionPresentation"
import type { OrchestrationPartPlan } from "@/ai-arranger/types"
import { useProjectStore } from "@/store/useProjectStore"
import { SectionCard, Select } from "@/ui/primitives"
import { Tag, DirectorNote, OrchestrationOverrideSelect } from "./AiPartnerParts"
import {
  energyLabel,
  reviewStatusLabel,
  reviewStatusClass,
  orchestrationRoleLabel,
  orchestrationFamilyLabel,
  orchestrationDistanceLabel,
  registerLabel,
  articulationLabel,
  dynamicLabel,
  timingLabel,
} from "./aiPartnerLabels"

/**
 * アレンジ画面の「曲の流れと楽器の役割」。曲全体の流れ(どこを静かにし、どこで広げるか)、
 * 編曲の評価、楽器の割り当てを表示・調整する。変更は全曲アレンジの生成に使われる。
 * 親から context を受け取り、変更はストアへ直接送る。
 */
export function AiPartnerAnalysisPanel({ effectiveSectionId }: { effectiveSectionId: string | null }) {
  const project = useProjectStore((state) => state.project)
  // 解析は重いので、欄を開いている間だけ行う
  const [open, setOpen] = useState(false)
  const context = useMemo(
    () => (open && effectiveSectionId ? buildAiArrangementContext(project, effectiveSectionId, "section") : null),
    [effectiveSectionId, open, project],
  )
  const selectSection = useProjectStore((state) => state.selectSection)
  const setArrangementDirectorClimax = useProjectStore((state) => state.setArrangementDirectorClimax)
  const setArrangementDirectorSectionOverride = useProjectStore((state) => state.setArrangementDirectorSectionOverride)
  const setSectionOrchestrationOverride = useProjectStore((state) => state.setSectionOrchestrationOverride)
  const director = context?.arrangementDirector
  const currentDirectorPlan = director?.sections.find((plan) => plan.sectionId === effectiveSectionId)
  const arrangementReview = context?.arrangementReview
  const wholeSongReview = context?.wholeSongArrangementReview
  const orchestrationPlan = context?.orchestration.sections.find((plan) => plan.sectionId === effectiveSectionId)
  const orchestrationReview = context?.orchestrationReview
  const audibleLayerReview = context?.audibleLayerReview

  return (
    <details
      className="rounded-lg border border-hairline bg-white/[0.015] p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-[12px] font-medium text-body-on-dark">
        曲の流れと楽器の役割（盛り上げる場所・強さを細かく決める）
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
              最も盛り上げる場所
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
                  {plainDirectionText(wholeSongReview.summary)}
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
                  • {plainDirectionText(finding.recommendation)}
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
                  {plainDirectionText(plan.transitionIntent)}
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
                  : "温存していた高い音や強い音を使える"}
              />
              <DirectorNote
                label="次へつなぐ"
                value={currentDirectorPlan.transitionIntent}
              />
            </div>
            <details className="rounded-sm border border-hairline bg-white/[0.02] px-3 py-2">
              <summary className="cursor-pointer text-[11px] text-body-muted hover:text-body-on-dark">
                この部分の強さを手動で調整
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
                    <option key={value} value={value}>{energyLabel(value)}</option>
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
                <span className="text-[11px] text-primary-on-dark">最も盛り上げる場所なので「最も強い」で固定</span>
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
                  この部分の状態
                </div>
                <p className="mt-1 text-[11px] leading-5 text-body-muted">
                  {plainDirectionText(arrangementReview.summary)}
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
                      • {plainDirectionText(finding.recommendation)}
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
              {plainDirectionText(orchestrationPlan.performanceArc)}
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
                  {plainDirectionText(orchestrationReview.summary)}
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
                        • {plainDirectionText(finding.recommendation)}
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
                  {plainDirectionText(audibleLayerReview.summary)}
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
                        • {plainDirectionText(finding.recommendation)}
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
                <strong className="text-body-on-dark">役割：</strong>{plainDirectionText(part.purpose)}
              </p>
              {part.role !== "intentional-silence" && effectiveSectionId && (
                <details className="mt-2 border-t border-hairline pt-2">
                  <summary className="cursor-pointer text-[11px] text-primary-on-dark">
                    演奏の詳細・調整{override ? " · 固定あり" : ""}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag>{registerLabel(part.register)}</Tag>
                    <Tag>{orchestrationDistanceLabel(part.distance)}</Tag>
                    <Tag>{articulationLabel(part.articulation)}</Tag>
                    <Tag>{dynamicLabel(part.dynamic)}</Tag>
                    <Tag>{timingLabel(part.timing)}</Tag>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-body-muted">
                    鳴り始め：{plainDirectionText(part.entry)}　鳴り終わり：{plainDirectionText(part.exit)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted-48">
                    音の強さ {part.velocityRange[0]}–{part.velocityRange[1]}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                    <OrchestrationOverrideSelect
                      label="楽器の種類"
                      value={override?.family ?? "auto"}
                      options={[
                        ["lead-voice", "主役の音"], ["piano-keys", "ピアノ／鍵盤"],
                        ["strings", "弦楽器"], ["analog-synth", "アナログシンセ"],
                        ["atmospheric-pad", "広がる持続音"], ["mallet-bell", "ベル／打楽器系の音"],
                        ["percussion", "打楽器"],
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
                      options={[
                        ["legato", "滑らかにつなぐ"], ["sustained", "長く保つ"],
                        ["pulsed", "短く繰り返す"], ["detached", "一音ずつ切る"],
                        ["swelling", "次第に大きくする"], ["decaying", "次第に消える"],
                      ]}
                      onChange={(value) => setSectionOrchestrationOverride(
                        effectiveSectionId,
                        part.role,
                        { articulation: value === "auto" ? null : value as OrchestrationPartPlan["articulation"] },
                      )}
                    />
                    <OrchestrationOverrideSelect
                      label="音の強さ"
                      value={override?.dynamic ?? "auto"}
                      options={["pp", "p", "mp", "mf", "f"].map((value) => [value, value])}
                      onChange={(value) => setSectionOrchestrationOverride(
                        effectiveSectionId,
                        part.role,
                        { dynamic: value === "auto" ? null : value as OrchestrationPartPlan["dynamic"] },
                      )}
                    />
                    <OrchestrationOverrideSelect
                      label="発音位置"
                      value={override?.timing ?? "auto"}
                      options={[
                        ["strict", "拍どおり"], ["slightly-ahead", "少し前"],
                        ["slightly-behind", "少し後ろ"], ["floating", "拍へ厳密に合わせない"],
                      ]}
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
                      すべて自動へ戻す
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
            {orchestrationPlan.withheldGestures.map(plainDirectionText).join(" / ")}
          </div>
        )}
      </SectionCard>
      )}
      </div>
    </details>
  )
}
