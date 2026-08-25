import type { ComposerProject } from "@/core/project"
import type {
  ArrangementDirectorBlueprint,
  ArrangementSectionReview,
  WholeSongArrangementFinding,
  WholeSongArrangementReview,
} from "./types"
import { reviewArrangementSection } from "./arrangementReview"
import { importedRolesInSection } from "./importedArrangementAnalysis"

function activeLayerCount(project: ComposerProject, sectionId: string): number {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return 0
  let count = 0
  if (project.sectionMelodyAssignments[sectionId]) count += 1
  if ((section.content?.accompaniment ?? "chords") !== "none") count += 1
  if (project.sectionAccompanimentPatternAssignments[sectionId]) count += 1
  if (project.sectionReactiveLayerAssignments?.[sectionId]) count += 1
  if (project.sectionDecorationLayerAssignments?.[sectionId]) count += 1
  count += [...importedRolesInSection(project, sectionId)].filter(
    (role) => role !== "melody" && role !== "harmony",
  ).length
  return count
}

function energyContrastScore(
  project: ComposerProject,
  director: ArrangementDirectorBlueprint,
): number {
  const comparisons: number[] = []
  for (let index = 1; index < director.sections.length; index += 1) {
    const previous = director.sections[index - 1]
    const current = director.sections[index]
    const targetDelta = current.targetEnergy - previous.targetEnergy
    if (targetDelta === 0) continue
    const actualDelta =
      activeLayerCount(project, current.sectionId) -
      activeLayerCount(project, previous.sectionId)
    comparisons.push(
      actualDelta === 0 ? 0.4 : Math.sign(actualDelta) === Math.sign(targetDelta) ? 1 : 0,
    )
  }
  if (comparisons.length === 0) return 1
  return comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length
}

function repeatedSupportPatterns(
  project: ComposerProject,
  director: ArrangementDirectorBlueprint,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let index = 1; index < director.sections.length; index += 1) {
    const previous = director.sections[index - 1]
    const current = director.sections[index]
    const previousPattern = project.sectionAccompanimentPatternAssignments[previous.sectionId]
    const currentPattern = project.sectionAccompanimentPatternAssignments[current.sectionId]
    if (
      previousPattern &&
      currentPattern === previousPattern &&
      current.targetEnergy !== previous.targetEnergy
    ) {
      pairs.push([previous.sectionId, current.sectionId])
    }
  }
  return pairs
}

function finding(
  value: WholeSongArrangementFinding,
): WholeSongArrangementFinding {
  return value
}

export function reviewWholeSongArrangement(
  project: ComposerProject,
  director: ArrangementDirectorBlueprint,
  sectionReviews: ArrangementSectionReview[] = director.sections.map((section) =>
    reviewArrangementSection(project, director, section.sectionId),
  ),
): WholeSongArrangementReview {
  const pending = sectionReviews.filter((review) => review.status === "pending")
  const blocking = sectionReviews.filter((review) => review.status === "revise")
  const climaxRisks = sectionReviews.filter(
    (review) => review.metrics.climaxResourceRisk,
  )
  const contrast = energyContrastScore(project, director)
  const repeatedPatterns = repeatedSupportPatterns(project, director)
  const findings: WholeSongArrangementFinding[] = []
  let score = 100

  if (pending.length > 0) {
    score -= Math.min(25, pending.length * 5)
    findings.push(finding({
      id: "unfinished-sections",
      severity: pending.length === sectionReviews.length ? "warning" : "notice",
      principleId: "narrative-necessity",
      title: "全曲判断に必要なActive素材が未確定です",
      evidence: `${pending.length}セクションが未確定のため、曲全体の起伏は暫定評価です。`,
      recommendation: "各Sectionで主役となる素材だけを先にSet Activeし、補助レイヤーは後から判断してください。",
      sectionIds: pending.map((review) => review.sectionId),
    }))
  }

  if (blocking.length > 0) {
    score -= blocking.length * 24
    findings.push(finding({
      id: "blocking-sections",
      severity: "blocking",
      principleId: "melody-sovereignty",
      title: "局所レビューで重大な競合があります",
      evidence: `${blocking.length}セクションに主旋律衝突または密度超過があります。`,
      recommendation: "新しいレイヤーを追加せず、該当SectionのRevise項目を先に解消してください。",
      sectionIds: blocking.map((review) => review.sectionId),
    }))
  }

  if (contrast < 0.55) {
    score -= 16
    findings.push(finding({
      id: "flat-energy-contrast",
      severity: "warning",
      principleId: "contrast-over-density",
      title: "DirectorのEnergy差が実際のレイヤー差へ現れていません",
      evidence: `Section間のEnergy追従度は${Math.round(contrast * 100)}%です。`,
      recommendation: "高Energy側へ足す前に、低Energy側の補助レイヤーを退場させて落差を作ってください。",
      sectionIds: director.sections.map((section) => section.sectionId),
    }))
  }

  if (repeatedPatterns.length > 0) {
    score -= Math.min(18, repeatedPatterns.length * 8)
    findings.push(finding({
      id: "repeated-support-pattern",
      severity: "warning",
      principleId: "ritual-and-mutation",
      title: "Energyが変わる境界で同じ伴奏Patternが続いています",
      evidence: `${repeatedPatterns.length}境界で伴奏の役割交代が起きていません。`,
      recommendation: "Patternを増やすだけでなく、休止・音域交代・別の周期へ置換してください。",
      sectionIds: [...new Set(repeatedPatterns.flat())],
    }))
  }

  if (climaxRisks.length > 0) {
    score -= climaxRisks.length * 12
    findings.push(finding({
      id: "global-climax-reservation",
      severity: "warning",
      principleId: "delayed-payoff",
      title: "クライマックス前に最高音資源を使用しています",
      evidence: `${climaxRisks.length}セクションが頂点Section以上の最高音へ達しています。`,
      recommendation: "該当Sectionの音域上限を局所的に下げ、頂点の希少性を戻してください。",
      sectionIds: climaxRisks.map((review) => review.sectionId),
    }))
  }

  score = Math.max(0, Math.round(score))
  const status = blocking.length > 0
    ? "revise"
    : pending.length === sectionReviews.length
      ? "pending"
      : findings.some((item) => item.severity === "warning")
        ? "watch"
        : "strong"
  if (findings.length === 0) {
    findings.push(finding({
      id: "whole-song-aligned",
      severity: "pass",
      principleId: "emotional-specificity",
      title: "曲全体の役割差と安全条件が両立しています",
      evidence: "密度差、伴奏交代、主旋律保護、クライマックス温存に重大な競合はありません。",
      recommendation: "Whole-song AuditionでSection境界の感情的な必然性を最終確認してください。",
      sectionIds: director.sections.map((section) => section.sectionId),
    }))
  }

  return {
    version: "1.0.0",
    status,
    score,
    summary:
      status === "strong"
        ? "全曲の役割差とクライマックス温存はDirector設計と整合しています。"
        : status === "pending"
          ? "Active素材を設定すると、全曲の起伏と役割交代を評価できます。"
          : status === "revise"
            ? "曲全体を確定する前に、重大な局所競合を修正してください。"
            : "全曲として成立していますが、Section間の対比を強める余地があります。",
    metrics: {
      reviewedSectionCount: sectionReviews.length - pending.length,
      pendingSectionCount: pending.length,
      blockingSectionCount: blocking.length,
      energyContrastScore: contrast,
      repeatedSupportPatternCount: repeatedPatterns.length,
      climaxReservationRiskCount: climaxRisks.length,
    },
    findings,
  }
}
