import type { ComposerProject } from "@/core/project"
import type { Section, SectionRole } from "@/core/section"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import type {
  ArrangementDirectorBlueprint,
  ArrangementDirectorClimaxPolicy,
  ArrangementDirectorFunction,
  ArrangementDirectorSectionPlan,
} from "./types"
import { importedRolesInSection } from "./importedArrangementAnalysis"

const ENERGY_BY_ROLE: Record<SectionRole, 1 | 2 | 3 | 4 | 5> = {
  intro: 2,
  verse: 2,
  "pre-chorus": 3,
  chorus: 4,
  "breakdown-chorus": 2,
  "grand-chorus": 5,
  "c-melody": 3,
  bridge: 3,
  instrumental: 3,
  outro: 1,
}

const FUNCTION_BY_ROLE: Record<SectionRole, ArrangementDirectorFunction> = {
  intro: "establish",
  verse: "develop",
  "pre-chorus": "lift",
  chorus: "declare",
  "breakdown-chorus": "suspend",
  "grand-chorus": "declare",
  "c-melody": "transform",
  bridge: "transform",
  instrumental: "transform",
  outro: "release",
}

function climaxSection(sections: Section[]): Section | null {
  const lastOf = (role: SectionRole) =>
    [...sections].reverse().find((section) => section.role === role)
  return lastOf("grand-chorus")
    ?? lastOf("chorus")
    ?? null
}

function existingLayerCount(project: ComposerProject, sectionId: string): number {
  let count = project.chords.some((chord) => chord.sectionId === sectionId) ? 1 : 0
  if (project.sectionMelodyAssignments[sectionId]) count += 1
  if (project.sectionAccompanimentPatternAssignments[sectionId]) count += 1
  if (project.sectionReactiveLayerAssignments?.[sectionId]) count += 1
  if (project.sectionDecorationLayerAssignments?.[sectionId]) count += 1
  // 外部曲MIDIは「現在採用中のLayer」ではなく分析用の原素材。
  // 既存Layerとして数えると候補生成予算が0になり、AI Partnerが何も提案できなくなる。
  // Logic往復素材だけは現在の制作状態として従来どおり密度へ含める。
  if (project.importedArrangement?.sourceKind === "logic-project") {
    const importedSupportingRoles = [...importedRolesInSection(project, sectionId)].filter(
      (role) => role !== "melody" && role !== "harmony",
    )
    count += importedSupportingRoles.length
  }
  return count
}

function climaxPolicyFor(
  section: Section,
  order: number,
  climaxOrder: number,
): ArrangementDirectorClimaxPolicy {
  if (climaxOrder < 0) return "reserve"
  if (order === climaxOrder) return "express"
  if (order > climaxOrder) return "recover"
  if (climaxOrder - order <= 2 || section.role === "pre-chorus") return "approach"
  return "reserve"
}

function registerFor(
  energy: number,
  policy: ArrangementDirectorClimaxPolicy,
): ArrangementDirectorSectionPlan["registerFocus"] {
  if (policy === "express") return "full"
  if (policy === "recover") return "low-middle"
  if (energy <= 1) return "low"
  if (energy === 2) return "low-middle"
  if (energy === 3) return "middle"
  return "middle-high"
}

function silenceFor(
  role: SectionRole,
  energy: number,
): ArrangementDirectorSectionPlan["silenceStrategy"] {
  if (role === "intro" || role === "breakdown-chorus" || role === "outro") {
    return "structural"
  }
  if (energy >= 4) return "minimal"
  return "breathing"
}

function introduceFor(
  role: SectionRole,
  policy: ArrangementDirectorClimaxPolicy,
): string[] {
  if (policy === "express") return ["最大の音域幅", "曲全体で温存した音色", "主題の最も明確な回帰"]
  if (role === "intro") return ["世界を識別する短い音色またはMotif", "前景と背景の距離"]
  if (role === "verse") return ["主旋律の呼吸を支える最小限の脈動"]
  if (role === "pre-chorus") return ["次Sectionへ向かう方向性", "限定的な音域拡張"]
  if (role === "breakdown-chorus") return ["既知の主題を別の距離から見せる空間"]
  if (role === "outro") return ["残響または未解決の記憶"]
  return ["前Sectionと異なる一つの編曲上の視点"]
}

function transitionFor(
  section: Section,
  next: Section | undefined,
  currentEnergy: number,
  nextEnergy: number | undefined,
): string {
  if (!next) return section.role === "outro"
    ? "解決を説明しすぎず、残響または持続音に余韻を渡す"
    : "終止を閉じすぎず、曲の外側へ余韻を残す"
  if ((nextEnergy ?? ENERGY_BY_ROLE[next.role]) > currentEnergy) {
    return "音数より期待を増やし、次Sectionの1拍目まで最大効果を温存する"
  }
  if ((nextEnergy ?? ENERGY_BY_ROLE[next.role]) < currentEnergy) {
    return "一つの核を残して他の層を引き、落差を聴かせる"
  }
  return "共通する一要素を保持し、別の要素だけを交代させる"
}

export function buildArrangementDirectorBlueprint(
  project: ComposerProject,
): ArrangementDirectorBlueprint {
  const sections = normalizeSectionTimeline(project.sections)
  const manualClimaxId = project.arrangementDirectorOverrides?.climaxSectionId
  const climax = manualClimaxId
    ? sections.find((section) => section.id === manualClimaxId) ?? climaxSection(sections)
    : climaxSection(sections)
  const climaxOrder = sections.findIndex((section) => section.id === climax?.id)
  const maximumParts = Math.max(1, Math.round(project.arrangementSettings.maximumParts))
  const spaceAdjustment = project.arrangementSettings.spacePriority >= 0.7 ? 1 : 0

  const energies = sections.map((section, order): 1 | 2 | 3 | 4 | 5 => {
    const policy = climaxPolicyFor(section, order, climaxOrder)
    const override = project.arrangementDirectorOverrides?.sections[section.id]?.targetEnergy
    if (policy === "express") return 5
    if (policy === "recover") return Math.min(override ?? ENERGY_BY_ROLE[section.role], 2) as 1 | 2
    return override ?? ENERGY_BY_ROLE[section.role]
  })

  const plans = sections.map((section, order): ArrangementDirectorSectionPlan => {
    const policy = climaxPolicyFor(section, order, climaxOrder)
    const energy = energies[order]
    const rawCeiling = Math.round(1 + ((maximumParts - 1) * energy) / 5)
    const automaticDensityCeiling = Math.max(
      1,
      Math.min(maximumParts, rawCeiling - (policy === "express" ? 0 : spaceAdjustment)),
    )
    const manualDensity = project.arrangementDirectorOverrides?.sections[section.id]?.densityCeiling
    const densityCeiling = manualDensity === undefined
      ? automaticDensityCeiling
      : Math.max(1, Math.min(maximumParts, Math.round(manualDensity)))
    const existing = existingLayerCount(project, section.id)
    return {
      sectionId: section.id,
      sectionName: section.name,
      sectionRole: section.role,
      order,
      narrativeFunction: FUNCTION_BY_ROLE[section.role],
      targetEnergy: energy,
      densityCeiling,
      existingLayerCount: existing,
      additionBudget: Math.max(0, densityCeiling - existing),
      registerFocus: registerFor(energy, policy),
      silenceStrategy: silenceFor(section.role, energy),
      climaxPolicy: policy,
      protect: [
        "Active Melodyの可読性",
        policy === "express" ? "これまで蓄積した期待" : "クライマックス用の希少性",
      ],
      introduce: introduceFor(section.role, policy),
      withhold: policy === "express"
        ? []
        : ["曲中の最高音", "最大密度", "最も強い音色", "完全な解決"],
      transitionIntent: transitionFor(
        section,
        sections[order + 1],
        energy,
        energies[order + 1],
      ),
    }
  })

  return {
    version: "1.0.0",
    arcSummary: plans.length === 0
      ? "Section未設定"
      : plans.map((plan) => `${plan.sectionName}:${plan.targetEnergy}`).join(" → "),
    climaxSectionId: climax?.id ?? null,
    globalProtect: ["主旋律の可読性", "Section間の対比", "反復されるMotifの記憶性"],
    reservedForClimax: ["曲中の最高音", "最大密度", "最も強い音色", "完全な解決"],
    sections: plans,
  }
}

export function currentDirectorSectionPlan(
  blueprint: ArrangementDirectorBlueprint,
  sectionId: string,
): ArrangementDirectorSectionPlan | null {
  return blueprint.sections.find((plan) => plan.sectionId === sectionId) ?? null
}
