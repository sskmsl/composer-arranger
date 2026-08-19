import type {
  OrchestrationMaskingReview,
  OrchestrationPartPlan,
  SectionOrchestrationPlan,
} from "./types"

const DISTANCE_RANK: Record<OrchestrationPartPlan["distance"], number> = {
  intimate: 0,
  near: 1,
  middle: 2,
  distant: 3,
}

const DYNAMIC_RANK: Record<OrchestrationPartPlan["dynamic"], number> = {
  pp: 0,
  p: 1,
  mp: 2,
  mf: 3,
  f: 4,
}

const REGISTER_BAND: Record<OrchestrationPartPlan["register"], readonly [number, number]> = {
  low: [36, 55],
  "low-middle": [43, 64],
  middle: [55, 74],
  "middle-high": [64, 84],
  full: [36, 96],
}

function registerOverlap(
  left: OrchestrationPartPlan,
  right: OrchestrationPartPlan,
): number {
  const [leftLow, leftHigh] = REGISTER_BAND[left.register]
  const [rightLow, rightHigh] = REGISTER_BAND[right.register]
  const overlap = Math.max(0, Math.min(leftHigh, rightHigh) - Math.max(leftLow, rightLow))
  const smallerWidth = Math.min(leftHigh - leftLow, rightHigh - rightLow)
  return smallerWidth > 0 ? overlap / smallerWidth : 0
}

export function reviewOrchestrationMasking(
  plan: SectionOrchestrationPlan | undefined,
): OrchestrationMaskingReview {
  if (!plan) {
    return {
      version: "1.0.0",
      sectionId: "",
      status: "pending",
      score: 0,
      summary: "Orchestration Planがまだありません。",
      metrics: {
        foregroundCompetitionCount: 0,
        dynamicMaskingCount: 0,
        familyDuplicationCount: 0,
        registerCrowdingCount: 0,
      },
      findings: [],
    }
  }

  const audible = plan.parts.filter((part) => part.role !== "intentional-silence")
  const lead = audible.find((part) => part.role === "lead-focus")
  const supports = audible.filter((part) => part.role !== "lead-focus")
  const foregroundCompetition = lead
    ? supports.filter((part) => DISTANCE_RANK[part.distance] <= DISTANCE_RANK[lead.distance])
    : []
  const dynamicMasking = lead
    ? supports.filter((part) => {
        const supportDynamic = DYNAMIC_RANK[part.dynamic]
        const leadDynamic = DYNAMIC_RANK[lead.dynamic]
        return supportDynamic > leadDynamic || (
          supportDynamic === leadDynamic &&
          DISTANCE_RANK[part.distance] <= DISTANCE_RANK[lead.distance] + 1
        )
      })
    : []
  const familyPairs: Array<[OrchestrationPartPlan, OrchestrationPartPlan]> = []
  const crowdedPairs: Array<[OrchestrationPartPlan, OrchestrationPartPlan]> = []
  for (let leftIndex = 0; leftIndex < audible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < audible.length; rightIndex += 1) {
      const left = audible[leftIndex]
      const right = audible[rightIndex]
      const overlap = registerOverlap(left, right)
      if (left.family === right.family && overlap >= 0.5) familyPairs.push([left, right])
      if (
        overlap >= 0.7 &&
        Math.abs(DISTANCE_RANK[left.distance] - DISTANCE_RANK[right.distance]) <= 1
      ) {
        crowdedPairs.push([left, right])
      }
    }
  }

  const findings: OrchestrationMaskingReview["findings"] = []
  let score = 100
  if (foregroundCompetition.length > 0) {
    score -= foregroundCompetition.length * 18
    findings.push({
      id: "foreground-competition",
      severity: "warning",
      title: "補助Roleが主役と同じか近い前景にいます",
      evidence: foregroundCompetition.map((part) => part.role).join(" / "),
      recommendation: "補助Roleを中景以遠へ下げるか、主役だけを最前景へ固定してください。",
      partIds: [lead?.id, ...foregroundCompetition.map((part) => part.id)].filter((id): id is string => Boolean(id)),
    })
  }
  if (dynamicMasking.length > 0) {
    score -= dynamicMasking.length * 18
    findings.push({
      id: "dynamic-masking",
      severity: "warning",
      title: "補助RoleのDynamicが主役以上です",
      evidence: dynamicMasking.map((part) => `${part.role}:${part.dynamic}`).join(" / "),
      recommendation: "主役のVelocityを上げる前に、補助Roleを一段階下げて相対差を作ってください。",
      partIds: [lead?.id, ...dynamicMasking.map((part) => part.id)].filter((id): id is string => Boolean(id)),
    })
  }
  if (familyPairs.length > 0) {
    score -= familyPairs.length * 9
    findings.push({
      id: "family-duplication",
      severity: "notice",
      title: "同じ音色Familyと音域へ複数Roleが集中しています",
      evidence: familyPairs.map(([left, right]) => `${left.role} + ${right.role}`).join(" / "),
      recommendation: "片方のFamily、音域、または距離を変え、役割を耳で識別できる状態にしてください。",
      partIds: [...new Set(familyPairs.flatMap(([left, right]) => [left.id, right.id]))],
    })
  }
  if (crowdedPairs.length > 0) {
    score -= crowdedPairs.length * 10
    findings.push({
      id: "register-crowding",
      severity: "warning",
      title: "近い距離で音域が重なり、マスキングしやすい状態です",
      evidence: crowdedPairs.map(([left, right]) => `${left.role} + ${right.role}`).join(" / "),
      recommendation: "オクターブ移動より先に、どちらが前景かを決めて音域または距離を分離してください。",
      partIds: [...new Set(crowdedPairs.flatMap(([left, right]) => [left.id, right.id]))],
    })
  }

  score = Math.max(0, Math.round(score))
  const blockingCombination = foregroundCompetition.length > 0 && dynamicMasking.length > 0
  const status = blockingCombination
    ? "revise"
    : findings.some((finding) => finding.severity === "warning")
      ? "watch"
      : "strong"
  if (findings.length === 0) {
    findings.push({
      id: "orchestration-separated",
      severity: "pass",
      title: "Roleごとの前後・強弱・音域が分離されています",
      evidence: "主役を覆う前景競合や重大な音域集中は検出されませんでした。",
      recommendation: "実音では音色の倍音量が異なるため、Neutral Auditionで最終確認してください。",
      partIds: audible.map((part) => part.id),
    })
  }
  return {
    version: "1.0.0",
    sectionId: plan.sectionId,
    status,
    score,
    summary:
      status === "strong"
        ? "Roleの前後関係と演奏強度は主旋律を守る配置です。"
        : status === "revise"
          ? "補助Roleが主役と同じ前景・強度へ入り、マスキングの危険があります。"
          : "採用可能ですが、音域または前後関係を分ける余地があります。",
    metrics: {
      foregroundCompetitionCount: foregroundCompetition.length,
      dynamicMaskingCount: dynamicMasking.length,
      familyDuplicationCount: familyPairs.length,
      registerCrowdingCount: crowdedPairs.length,
    },
    findings,
  }
}
