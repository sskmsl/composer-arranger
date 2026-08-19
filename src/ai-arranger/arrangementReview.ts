import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import type {
  ArrangementDirectorBlueprint,
  ArrangementReviewFinding,
  ArrangementSectionReview,
} from "./types"

function activeMelodyFor(
  project: ComposerProject,
  sectionId: string,
): MelodyVariant | null {
  const id = project.sectionMelodyAssignments[sectionId]
  return project.melodyVariants.find(
    (variant) => variant.id === id && variant.sectionId === sectionId,
  ) ?? null
}

function assignedReactiveLayers(
  project: ComposerProject,
  sectionId: string,
): ReactiveLayerCandidate[] {
  const ids = [
    project.sectionReactiveLayerAssignments?.[sectionId],
    project.sectionDecorationLayerAssignments?.[sectionId],
  ].filter((id): id is string => Boolean(id))
  return ids.flatMap((id) => {
    const candidate = project.reactiveLayerCandidates?.find(
      (layer) => layer.id === id && layer.sectionId === sectionId,
    )
    return candidate ? [candidate] : []
  })
}

function occupiedRatio(notes: MelodyNote[], totalBeats: number): number {
  if (totalBeats <= 0 || notes.length === 0) return 0
  const ranges = notes
    .map((note) => ({
      start: Math.max(0, note.startBeat),
      end: Math.min(totalBeats, note.startBeat + note.durationBeats),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start)
  let occupied = 0
  let start = ranges[0]?.start ?? 0
  let end = ranges[0]?.end ?? 0
  for (const range of ranges.slice(1)) {
    if (range.start <= end) {
      end = Math.max(end, range.end)
    } else {
      occupied += end - start
      start = range.start
      end = range.end
    }
  }
  occupied += Math.max(0, end - start)
  return Math.min(1, occupied / totalBeats)
}

function melodyPeak(variant: MelodyVariant | null): number | null {
  if (!variant || variant.notes.length === 0) return null
  return Math.max(...variant.notes.map((note) => note.pitch))
}

function finding(
  value: ArrangementReviewFinding,
): ArrangementReviewFinding {
  return value
}

export function reviewArrangementSection(
  project: ComposerProject,
  blueprint: ArrangementDirectorBlueprint,
  sectionId: string,
): ArrangementSectionReview {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  const plan = blueprint.sections.find((candidate) => candidate.sectionId === sectionId)
  const melody = activeMelodyFor(project, sectionId)
  const reactiveLayers = assignedReactiveLayers(project, sectionId)
  const reviewedSourceIds = [
    melody?.id,
    project.sectionAccompanimentPatternAssignments[sectionId],
    ...reactiveLayers.map((layer) => layer.id),
  ].filter((id): id is string => Boolean(id))

  if (!section || !plan) {
    return {
      version: "1.0.0",
      sectionId,
      status: "pending",
      score: 0,
      summary: "DirectorのSection設計がまだありません。",
      metrics: {
        densityUtilization: 0,
        silenceRatio: 1,
        blockingCollisionCount: 0,
        protectedMomentOverlapBeats: 0,
        climaxResourceRisk: false,
      },
      findings: [],
      reviewedSourceIds,
    }
  }

  const leadExpected = (section.content?.lead ?? "melody") !== "none"
  if (!melody && leadExpected) {
    return {
      version: "1.0.0",
      sectionId,
      status: "pending",
      score: 0,
      summary: "Active Melodyを設定すると、実音に基づくレビューを開始できます。",
      metrics: {
        densityUtilization: plan.densityCeiling > 0
          ? plan.existingLayerCount / plan.densityCeiling
          : 0,
        silenceRatio: 1,
        blockingCollisionCount: 0,
        protectedMomentOverlapBeats: 0,
        climaxResourceRisk: false,
      },
      findings: [],
      reviewedSourceIds,
    }
  }

  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const totalBeats = section.lengthBars * beatsPerBar
  const soundingNotes = [
    ...(melody?.notes ?? []),
    ...reactiveLayers.flatMap((layer) => layer.notes),
  ]
  const silenceRatio = 1 - occupiedRatio(soundingNotes, totalBeats)
  const densityUtilization = plan.densityCeiling > 0
    ? plan.existingLayerCount / plan.densityCeiling
    : 0
  const blockingLayers = reactiveLayers.filter(
    (layer) => layer.collisions.hasBlockingCollision,
  )
  const protectedMomentOverlapBeats = reactiveLayers.reduce(
    (sum, layer) => sum + layer.collisions.protectedMomentOverlapBeats,
    0,
  )

  const climaxMelody = blueprint.climaxSectionId
    ? activeMelodyFor(project, blueprint.climaxSectionId)
    : null
  const currentPeak = melodyPeak(melody)
  const climaxPeak = melodyPeak(climaxMelody)
  const climaxResourceRisk =
    plan.climaxPolicy !== "express" &&
    currentPeak !== null &&
    climaxPeak !== null &&
    currentPeak >= climaxPeak

  const findings: ArrangementReviewFinding[] = []
  let score = 100

  if (plan.existingLayerCount > plan.densityCeiling) {
    const excess = plan.existingLayerCount - plan.densityCeiling
    score -= 18 + excess * 8
    findings.push(finding({
      id: "density-ceiling",
      severity: excess >= 2 ? "blocking" : "warning",
      principleId: "contrast-over-density",
      title: "Directorの密度上限を超えています",
      evidence: `現在${plan.existingLayerCount}層に対し、このSectionの上限は${plan.densityCeiling}層です。`,
      recommendation: "最も役割が重複する補助レイヤーを一つ外し、Section間の落差を戻してください。",
    }))
  }

  if (blockingLayers.length > 0) {
    score -= 28 * blockingLayers.length
    findings.push(finding({
      id: "melody-collision",
      severity: "blocking",
      principleId: "melody-sovereignty",
      title: "主旋律を妨げる衝突があります",
      evidence: `${blockingLayers.map((layer) => layer.name).join(" / ")}で同音・短2度・保護区間の重なりが検出されました。`,
      recommendation: "該当レイヤーを再生成するか、主旋律の休符区間だけへ配置してください。",
    }))
  } else if (protectedMomentOverlapBeats > 0.5) {
    score -= 12
    findings.push(finding({
      id: "protected-moment",
      severity: "warning",
      principleId: "melody-sovereignty",
      title: "主旋律の感情点に補助音が重なっています",
      evidence: `最高音・長音・跳躍着地との重なりが${protectedMomentOverlapBeats.toFixed(2)}拍あります。`,
      recommendation: "感情点の直前か鳴り終わりへ移し、主旋律の到達を単独で聴かせてください。",
    }))
  }

  const minimumSilence = plan.silenceStrategy === "structural"
    ? 0.25
    : plan.silenceStrategy === "breathing"
      ? 0.12
      : 0.03
  if (silenceRatio + 0.04 < minimumSilence) {
    score -= 14
    findings.push(finding({
      id: "silence-budget",
      severity: "warning",
      principleId: "meaningful-silence",
      title: "計画した余白が実音で失われています",
      evidence: `実音の無音率は${Math.round(silenceRatio * 100)}%で、${plan.silenceStrategy}設計の目安を下回ります。`,
      recommendation: "連続音を均等に削らず、フレーズ後またはSection境界へ意味のある無音を作ってください。",
    }))
  }

  if (climaxResourceRisk) {
    score -= 16
    findings.push(finding({
      id: "early-climax",
      severity: "warning",
      principleId: "delayed-payoff",
      title: "曲の最高音をクライマックス前に先取りしています",
      evidence: `このSectionの最高音${currentPeak}が、頂点Sectionの最高音${climaxPeak}以上です。`,
      recommendation: "現在Sectionをオクターブではなく局所輪郭で抑え、頂点Sectionだけに上方の余地を残してください。",
    }))
  }

  const timeline = blueprint.sections
  const nextPlan = timeline[plan.order + 1]
  const lastEnd = Math.max(0, ...(melody?.notes ?? []).map(
    (note) => note.startBeat + note.durationBeats,
  ))
  const endGap = Math.max(0, totalBeats - lastEnd)
  if (nextPlan && nextPlan.targetEnergy > plan.targetEnergy && endGap < 0.25) {
    score -= 7
    findings.push(finding({
      id: "transition-breath",
      severity: "notice",
      principleId: "narrative-necessity",
      title: "次Sectionへ渡す呼吸が短い状態です",
      evidence: `次はEnergy ${nextPlan.targetEnergy}へ上がりますが、末尾の余白は${endGap.toFixed(2)}拍です。`,
      recommendation: "最後の音を短くするか、残響だけを次Sectionへ跨がせて入口の効果を温存してください。",
    }))
  }

  score = Math.max(0, Math.round(score))
  const status = findings.some((item) => item.severity === "blocking")
    ? "revise"
    : findings.some((item) => item.severity === "warning")
      ? "watch"
      : "strong"

  if (findings.length === 0) {
    findings.push(finding({
      id: "constitution-aligned",
      severity: "pass",
      principleId: "emotional-specificity",
      title: "ConstitutionとDirectorの範囲内です",
      evidence: "密度、余白、主旋律保護、クライマックス温存に重大な競合はありません。",
      recommendation: "数値上は採用可能です。最終判断はNeutral Auditionで行ってください。",
    }))
  }

  return {
    version: "1.0.0",
    sectionId,
    status,
    score,
    summary: status === "strong"
      ? "現在のActive構成は、曲全体の設計と両立しています。"
      : status === "watch"
        ? "採用可能ですが、曲全体の効果を高める調整余地があります。"
        : "Set Activeのまま確定する前に、主旋律保護または密度を修正してください。",
    metrics: {
      densityUtilization,
      silenceRatio,
      blockingCollisionCount: blockingLayers.length,
      protectedMomentOverlapBeats,
      climaxResourceRisk,
    },
    findings,
    reviewedSourceIds,
  }
}
