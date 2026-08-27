import type { ComposerProject } from "@/core/project"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import { reviewArrangementSection } from "./arrangementReview"
import { reviewAudibleLayerCollisions } from "./audibleLayerReview"
import { reviewWholeSongArrangement } from "./wholeSongArrangementReview"
import {
  resolveWholeSongActionStatus,
  type WholeSongActionGenerator,
  type WholeSongArrangementAction,
  type WholeSongDirectionId,
} from "./wholeSongDirectionPlan"
import type {
  AiAccompanimentPatternId,
  AiCreativeRisk,
  AiRhythmCharacter,
  AiSilenceStrategy,
  ArrangementDirectorSectionPlan,
  OrchestrationFamily,
  OrchestrationRole,
} from "./types"

export type ArrangementPackagePartRole =
  | "lead"
  | "bass"
  | "rhythm"
  | "harmony"
  | "strings"
  | "counter"
  | "color"
  | "space"

export type ArrangementPackagePartState =
  | "protect"
  | "enter"
  | "continue"
  | "withdraw"
  | "transform"
  | "answer"
  | "hold"
  | "silence"

export type ArrangementPackageStage = "foundation" | "movement" | "color"

export interface ArrangementPackagePartPlan {
  id: string
  sectionId: string
  sectionName: string
  partRole: ArrangementPackagePartRole
  state: ArrangementPackagePartState
  purpose: string
  register: "low" | "middle" | "high" | "wide"
  distance: "near" | "middle" | "distant"
  intensity: 1 | 2 | 3 | 4 | 5
  stage: ArrangementPackageStage | null
  execution: WholeSongArrangementAction | null
  implementation: "active" | "generator" | "design-only" | "withheld"
}

export interface ArrangementPackageSectionPlan {
  sectionId: string
  sectionName: string
  sectionRole: string
  targetEnergy: 1 | 2 | 3 | 4 | 5
  densityCeiling: number
  climaxPolicy: ArrangementDirectorSectionPlan["climaxPolicy"]
  parts: ArrangementPackagePartPlan[]
}

export interface ArrangementPackageFinding {
  id: string
  severity: "pass" | "notice" | "warning" | "blocking"
  title: string
  evidence: string
  recommendation: string
  sectionIds: string[]
}

export interface ArrangementPackageQualityGate {
  status: "ready" | "watch" | "blocked" | "pending"
  score: number
  findings: ArrangementPackageFinding[]
}

export interface MultiPartArrangementPackage {
  version: "1.0.0"
  directionId: WholeSongDirectionId
  title: string
  summary: string
  stages: Array<{
    id: ArrangementPackageStage
    title: string
    purpose: string
    actions: WholeSongArrangementAction[]
  }>
  sections: ArrangementPackageSectionPlan[]
  qualityGate: ArrangementPackageQualityGate
  executionGate: ArrangementPackageQualityGate
}

const PACKAGE_TITLES: Record<WholeSongDirectionId, string> = {
  "preserve-space": "余白と距離のMulti-Part Package",
  "controlled-escalation": "役割交代で開くMulti-Part Package",
  "rhythmic-propulsion": "周期とアクセントのMulti-Part Package",
  "motif-relay": "Motif受け渡しMulti-Part Package",
  "balanced-architecture": "主旋律中心のBalanced Multi-Part Package",
}

function patternFor(
  directionId: WholeSongDirectionId,
  energy: number,
): AiAccompanimentPatternId {
  if (directionId === "preserve-space") return "broken-ninth"
  if (directionId === "motif-relay") return "chord-entry"
  if (directionId === "balanced-architecture") return "arpeggio-five"
  return energy >= 4 ? "syncopated" : "pulse-root-fifth"
}

function executionAction(
  project: ComposerProject,
  directionId: WholeSongDirectionId,
  plan: ArrangementDirectorSectionPlan,
  generator: WholeSongActionGenerator,
  role: OrchestrationRole,
  family: OrchestrationFamily,
  stage: ArrangementPackageStage,
  purpose: string,
): WholeSongArrangementAction {
  const section = project.sections.find((candidate) => candidate.id === plan.sectionId)!
  const sparse = directionId === "preserve-space" || plan.targetEnergy <= 2
  const rhythmCharacter: AiRhythmCharacter = directionId === "preserve-space"
    ? "spacious"
    : directionId === "motif-relay"
      ? "fragmented"
      : directionId === "balanced-architecture"
        ? "flowing"
        : "pulsed"
  const silenceStrategy: AiSilenceStrategy = plan.silenceStrategy
  const creativeRisk: AiCreativeRisk = directionId === "motif-relay" ? "bold" : "focused"
  return {
    id: `${directionId}:${plan.sectionId}:${stage}:${generator}`,
    sectionId: plan.sectionId,
    sectionName: plan.sectionName,
    generator,
    role,
    family,
    purpose,
    entry: plan.climaxPolicy === "approach"
      ? "Section後半から限定的に入り、次の入口を先取りしない"
      : "主旋律のアタックと感情点を避けて入る",
    exit: plan.transitionIntent,
    density: sparse ? "sparse" : plan.targetEnergy >= 4 ? "active" : "balanced",
    register: role === "pulse-foundation" ? "low" : role === "transition-color" ? "high" : "middle",
    drama: plan.climaxPolicy === "express" ? "open" : plan.climaxPolicy === "approach" ? "growing" : "restrained",
    motion: plan.climaxPolicy === "approach" ? "ascending" : plan.climaxPolicy === "recover" ? "descending" : "wave",
    rhythmCharacter,
    silenceStrategy,
    creativeRisk,
    lengthBars: Math.max(1, Math.min(8, generator === "signature" ? 2 : section.lengthBars)) as WholeSongArrangementAction["lengthBars"],
    accompanimentPatternId: generator === "accompaniment" ? patternFor(directionId, plan.targetEnergy) : "none",
    ...resolveWholeSongActionStatus(project, plan.sectionId, generator, role),
  }
}

function stateFor(
  hasPrevious: boolean,
  previousEnergy: number | null,
  currentEnergy: number,
  active: boolean,
  intended: boolean,
): ArrangementPackagePartState {
  if (!intended) return active ? "withdraw" : "silence"
  if (!hasPrevious) return "enter"
  if (previousEnergy === currentEnergy) return "continue"
  return "transform"
}

function planPart(
  value: ArrangementPackagePartPlan,
): ArrangementPackagePartPlan {
  return value
}

function partsForSection(
  project: ComposerProject,
  directionId: WholeSongDirectionId,
  plan: ArrangementDirectorSectionPlan,
  previous: ArrangementDirectorSectionPlan | undefined,
): ArrangementPackagePartPlan[] {
  const section = project.sections.find((candidate) => candidate.id === plan.sectionId)!
  const hasMelody = Boolean(project.sectionMelodyAssignments[plan.sectionId])
  const hasPattern = Boolean(project.sectionAccompanimentPatternAssignments[plan.sectionId])
  const hasCounter = Boolean(project.sectionReactiveLayerAssignments?.[plan.sectionId])
  const hasDecoration = Boolean(project.sectionDecorationLayerAssignments?.[plan.sectionId])
  const hasChords = project.chords.some((chord) => chord.sectionId === plan.sectionId)
  const lowEnergy = plan.targetEnergy <= 2
  const isIntro = section.role === "intro"
  const isOutro = section.role === "outro"
  const approach = plan.climaxPolicy === "approach"
  const express = plan.climaxPolicy === "express"
  const recovery = plan.climaxPolicy === "recover"
  const rhythmWanted = !isOutro && (
    directionId === "controlled-escalation"
      ? plan.targetEnergy >= 2
      : directionId === "rhythmic-propulsion"
        ? plan.targetEnergy >= 1
      : directionId === "motif-relay"
        ? plan.targetEnergy >= 3 || isIntro
        : directionId === "balanced-architecture"
          ? plan.targetEnergy >= 3
          : plan.targetEnergy >= 3
  )
  const stringsWanted = hasMelody && !isIntro && !isOutro && (approach || express)
  const counterWanted = hasMelody && !stringsWanted && !isIntro && !isOutro && (
    directionId === "motif-relay"
      ? ["develop", "declare", "transform"].includes(plan.narrativeFunction)
      : directionId === "rhythmic-propulsion"
        ? false
        : plan.targetEnergy >= 3 && plan.targetEnergy <= 4
  )
  const colorWanted = isIntro || isOutro || approach || recovery
  const previousEnergy = previous?.targetEnergy ?? null
  const parts: ArrangementPackagePartPlan[] = []

  parts.push(planPart({
    id: `${plan.sectionId}:lead`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "lead", state: hasMelody ? "protect" : "silence",
    purpose: hasMelody ? "主旋律を唯一の前景として守る" : "Active Melody確定までLead領域を空ける",
    register: "middle", distance: "near", intensity: plan.targetEnergy,
    stage: null, execution: null, implementation: hasMelody ? "active" : "withheld",
  }))

  parts.push(planPart({
    id: `${plan.sectionId}:bass`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "bass",
    state: hasChords ? stateFor(Boolean(previous), previousEnergy, plan.targetEnergy, true, true) : "silence",
    purpose: directionId === "preserve-space"
      ? "コード説明ではなく、持続と休符で重力を作る"
      : "Kickと完全同期せず、Sectionの重心と進行方向を示す",
    register: "low", distance: "middle", intensity: Math.max(1, plan.targetEnergy - 1) as 1 | 2 | 3 | 4 | 5,
    stage: null, execution: null, implementation: hasChords ? "design-only" : "withheld",
  }))

  const rhythmExecution = rhythmWanted
    ? executionAction(project, directionId, plan, "accompaniment", "pulse-foundation", "analog-synth", "foundation", "音数ではなく周期とアクセントで推進力を作る")
    : null
  parts.push(planPart({
    id: `${plan.sectionId}:rhythm`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "rhythm",
    state: stateFor(Boolean(previous), previousEnergy, plan.targetEnergy, hasPattern, rhythmWanted),
    purpose: rhythmWanted ? "主旋律の隙間にPulseを置き、Sectionの歩幅を作る" : "周期を消して前後Sectionとの落差を作る",
    register: "low", distance: "middle", intensity: rhythmWanted ? plan.targetEnergy : 1,
    stage: rhythmExecution ? "foundation" : null,
    execution: rhythmExecution,
    implementation: hasPattern ? "active" : rhythmExecution ? "generator" : "withheld",
  }))

  parts.push(planPart({
    id: `${plan.sectionId}:harmony`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "harmony", state: hasChords ? (recovery ? "withdraw" : "hold") : "silence",
    purpose: lowEnergy ? "長い減衰と共通音で空間を保つ" : "コードの全構成音を鳴らさず、主旋律の居場所を残す",
    register: "middle", distance: lowEnergy ? "distant" : "middle", intensity: Math.max(1, plan.targetEnergy - 1) as 1 | 2 | 3 | 4 | 5,
    stage: null, execution: null, implementation: hasChords ? "active" : "withheld",
  }))

  const counterExecution = counterWanted
    ? executionAction(project, directionId, plan, "counter", "counter-voice", "strings", "movement", "主旋律の長音と休符へ別視点から応答する")
    : null
  parts.push(planPart({
    id: `${plan.sectionId}:counter`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "counter", state: counterWanted ? "answer" : hasCounter ? "withdraw" : "silence",
    purpose: counterWanted ? "主旋律を二重化せず、空白へ短く応答する" : "主旋律の主権と余白を守る",
    register: express ? "high" : "middle", distance: "middle", intensity: counterWanted ? Math.max(1, plan.targetEnergy - 1) as 1 | 2 | 3 | 4 | 5 : 1,
    stage: counterExecution ? "movement" : null,
    execution: counterExecution,
    implementation: hasCounter ? "active" : counterExecution ? "generator" : "withheld",
  }))

  const stringsExecution = stringsWanted
    ? executionAction(
        project,
        directionId,
        plan,
        "counter",
        "counter-voice",
        "strings",
        "movement",
        express
          ? "温存した弦の上声を一度だけ開き、主旋律の長音を支える"
          : "長音と限定された上昇内声で、次Sectionへの方向を作る",
      )
    : null
  parts.push(planPart({
    id: `${plan.sectionId}:strings`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "strings",
    state: stringsWanted ? (express ? "enter" : "transform") : recovery ? "withdraw" : "hold",
    purpose: express ? "温存した上声と幅を一度だけ開く" : approach ? "長音または内声の上昇で次Sectionへ方向を作る" : "高域を使い切らず背景の持続へ留める",
    register: express ? "wide" : approach ? "high" : "middle", distance: express ? "near" : "distant", intensity: express ? 5 : Math.max(1, plan.targetEnergy - 1) as 1 | 2 | 3 | 4 | 5,
    stage: stringsExecution ? "movement" : null,
    execution: stringsExecution,
    implementation: hasCounter ? "active" : stringsExecution ? "generator" : "design-only",
  }))

  const colorGenerator: WholeSongActionGenerator = isIntro ? "signature" : "decoration"
  const colorExecution = colorWanted
    ? executionAction(project, directionId, plan, colorGenerator, "transition-color", isIntro ? "mallet-bell" : "atmospheric-pad", "color", isIntro ? "曲を識別する短い記憶の核を提示する" : "Section境界の時間と残響を演奏する")
    : null
  parts.push(planPart({
    id: `${plan.sectionId}:color`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "color", state: colorWanted ? (isIntro ? "enter" : recovery ? "hold" : "transform") : hasDecoration ? "withdraw" : "silence",
    purpose: colorWanted ? (isIntro ? "冒頭だけで世界を識別できる音色と間を作る" : "次の主要アタックを奪わず時間を接続する") : "装飾の希少性を守る",
    register: isIntro ? "middle" : "high", distance: "distant", intensity: colorWanted ? Math.max(1, plan.targetEnergy - 1) as 1 | 2 | 3 | 4 | 5 : 1,
    stage: colorExecution ? "color" : null,
    execution: colorExecution,
    implementation: hasDecoration ? "active" : colorExecution ? "generator" : "withheld",
  }))

  parts.push(planPart({
    id: `${plan.sectionId}:space`, sectionId: plan.sectionId, sectionName: plan.sectionName,
    partRole: "space", state: lowEnergy || recovery ? "hold" : express ? "transform" : "continue",
    purpose: lowEnergy ? "Dryな前景と長い遠景を分け、余白を音楽として保持する" : "音量ではなく距離変化でSectionの広がりを作る",
    register: "wide", distance: "distant", intensity: directionId === "preserve-space" ? 4 : plan.targetEnergy,
    stage: null, execution: null, implementation: "design-only",
  }))

  return parts
}

function qualityGate(sections: ArrangementPackageSectionPlan[]): ArrangementPackageQualityGate {
  const findings: ArrangementPackageFinding[] = []
  let score = 100
  const overcrowded = sections.filter((section) => {
    const intended = section.parts.filter((part) => !["silence", "withdraw"].includes(part.state)).length
    // Lead・Spaceは同時発音レイヤー数へ直接数えない。
    return intended - 2 > section.densityCeiling
  })
  if (overcrowded.length > 0) {
    score -= overcrowded.length * 14
    findings.push({
      id: "planned-density", severity: "warning", title: "計画Roleが密度上限を超えるSectionがあります",
      evidence: overcrowded.map((section) => section.sectionName).join(" / "),
      recommendation: "高Energy側へ足す前に、低優先のCounterまたはColorをwithdrawへ変更してください。",
      sectionIds: overcrowded.map((section) => section.sectionId),
    })
  }
  const unavailable = sections.flatMap((section) => section.parts).filter(
    (part) => part.execution?.status === "unavailable",
  )
  if (unavailable.length > 0) {
    score -= Math.min(24, unavailable.length * 6)
    findings.push({
      id: "unavailable-actions", severity: "notice", title: "素材確定後に実行できるRoleがあります",
      evidence: unavailable.map((part) => `${part.sectionName}:${part.partRole}`).join(" / "),
      recommendation: "Active Melodyまたはコードを先に確定し、該当段階だけ再評価してください。",
      sectionIds: [...new Set(unavailable.map((part) => part.sectionId))],
    })
  }
  const climax = sections.find((section) => section.climaxPolicy === "express")
  const earlyMax = sections.filter((section) => section.climaxPolicy !== "express" && section.parts.some(
    (part) => part.partRole !== "space" && part.intensity === 5,
  ))
  if (climax && earlyMax.length > 0) {
    score -= earlyMax.length * 12
    findings.push({
      id: "early-maximum", severity: "warning", title: "Climax前に最大強度を使う計画があります",
      evidence: earlyMax.map((section) => section.sectionName).join(" / "),
      recommendation: `最大強度を${climax.sectionName}へ温存し、該当Sectionは距離または休止で差を作ってください。`,
      sectionIds: earlyMax.map((section) => section.sectionId),
    })
  }
  const hasWithdrawal = sections.some((section) => section.parts.some((part) => part.state === "withdraw" || part.state === "silence"))
  if (!hasWithdrawal && sections.length > 1) {
    score -= 18
    findings.push({
      id: "no-withdrawal", severity: "warning", title: "全曲で退場するRoleがありません",
      evidence: "すべてのSectionで同じRoleが継続し、対比を作る空白がありません。",
      recommendation: "最低1つの低Energy SectionでRhythm・Counter・Colorのいずれかを完全に休ませてください。",
      sectionIds: sections.map((section) => section.sectionId),
    })
  }
  score = Math.max(0, Math.round(score))
  if (findings.length === 0) {
    findings.push({
      id: "package-ready", severity: "pass", title: "役割・退場・Climax温存が両立しています",
      evidence: "密度上限、素材要件、最大強度、Section間の退場に重大な競合はありません。",
      recommendation: "Foundationから段階的に生成し、各段階で実音レビューを行ってください。",
      sectionIds: sections.map((section) => section.sectionId),
    })
  }
  const status = findings.some((finding) => finding.severity === "blocking")
    ? "blocked"
    : findings.some((finding) => finding.severity === "warning")
      ? "watch"
      : "ready"
  return { status, score, findings }
}

function executionQualityGate(
  project: ComposerProject,
  director: ReturnType<typeof buildArrangementDirectorBlueprint>,
): ArrangementPackageQualityGate {
  const sectionReviews = director.sections.map((section) =>
    reviewArrangementSection(project, director, section.sectionId),
  )
  const whole = reviewWholeSongArrangement(project, director, sectionReviews)
  const audible = director.sections.map((section) =>
    reviewAudibleLayerCollisions(project, section.sectionId),
  )
  const reviewedAudible = audible.filter((review) => review.status !== "pending")
  const blocking = audible.filter((review) => review.status === "revise")
  const warnings = audible.filter((review) => review.status === "watch")
  const findings: ArrangementPackageFinding[] = []
  const sectionName = (sectionId: string) =>
    director.sections.find((section) => section.sectionId === sectionId)?.sectionName ?? sectionId

  if (blocking.length > 0) {
    findings.push({
      id: "audible-blocking", severity: "blocking", title: "実際に鳴るレイヤーが主旋律を妨げています",
      evidence: blocking.map((review) => `${sectionName(review.sectionId)}: ${review.summary}`).join(" / "),
      recommendation: "該当Sectionだけを再生成し、発音位置・休符・音域の順で主旋律から離してください。",
      sectionIds: blocking.map((review) => review.sectionId),
    })
  } else if (warnings.length > 0) {
    findings.push({
      id: "audible-warning", severity: "warning", title: "実音に調整余地があります",
      evidence: warnings.map((review) => `${sectionName(review.sectionId)}: ${review.summary}`).join(" / "),
      recommendation: "全体を作り直さず、警告Sectionの補助レイヤーだけを再生成してください。",
      sectionIds: warnings.map((review) => review.sectionId),
    })
  }

  for (const item of whole.findings.filter((finding) => finding.severity !== "pass").slice(0, 2)) {
    findings.push({
      id: `whole:${item.id}`,
      severity: item.severity,
      title: item.title,
      evidence: item.evidence,
      recommendation: item.recommendation,
      sectionIds: item.sectionIds,
    })
  }

  if (reviewedAudible.length === 0) {
    findings.push({
      id: "audible-pending", severity: "notice", title: "実音Quality Gateは素材確定待ちです",
      evidence: "Active Melodyと補助レイヤーが揃うと、Preview/MIDIと同じ材料で衝突を再評価します。",
      recommendation: "Foundationから一段階ずつ生成し、各段階でこの評価を確認してください。",
      sectionIds: director.sections.map((section) => section.sectionId),
    })
  } else if (findings.length === 0) {
    findings.push({
      id: "audible-ready", severity: "pass", title: "現在のActiveレイヤーに重大な実音衝突はありません",
      evidence: "主旋律との同音・短2度・感情点アタックと、全曲の密度差を確認しました。",
      recommendation: "次の段階だけを追加し、追加後に再評価してください。",
      sectionIds: reviewedAudible.map((review) => review.sectionId),
    })
  }

  const audibleAverage = reviewedAudible.length > 0
    ? reviewedAudible.reduce((sum, review) => sum + review.score, 0) / reviewedAudible.length
    : whole.score
  const score = Math.max(0, Math.round((whole.score + audibleAverage) / 2))
  const status: ArrangementPackageQualityGate["status"] = blocking.length > 0 || whole.status === "revise"
    ? "blocked"
    : reviewedAudible.length === 0 || whole.status === "pending"
      ? "pending"
      : warnings.length > 0 || whole.status === "watch"
        ? "watch"
        : "ready"
  return { status, score, findings }
}

export function buildMultiPartArrangementPackage(
  project: ComposerProject,
  directionId: WholeSongDirectionId,
): MultiPartArrangementPackage {
  const director = buildArrangementDirectorBlueprint(project)
  const sections = director.sections.map((plan, index): ArrangementPackageSectionPlan => ({
    sectionId: plan.sectionId,
    sectionName: plan.sectionName,
    sectionRole: plan.sectionRole,
    targetEnergy: plan.targetEnergy,
    densityCeiling: plan.densityCeiling,
    climaxPolicy: plan.climaxPolicy,
    parts: partsForSection(project, directionId, plan, director.sections[index - 1]),
  }))
  const actions = sections.flatMap((section) => section.parts.flatMap((part) => part.execution ? [part.execution] : []))
  return {
    version: "1.0.0",
    directionId,
    title: PACKAGE_TITLES[directionId],
    summary: "Melodyを設計図として保護し、各Roleの登場・継続・変形・退場を全Sectionで揃えた実行計画です。",
    stages: [
      { id: "foundation", title: "1. Foundation", purpose: "周期と低域の重心を先に決める", actions: actions.filter((action) => action.id.includes(":foundation:")) },
      { id: "movement", title: "2. Movement", purpose: "主旋律の余白に応答と方向性を作る", actions: actions.filter((action) => action.id.includes(":movement:")) },
      { id: "color", title: "3. Color", purpose: "Signature・境界・残響を最後に限定配置する", actions: actions.filter((action) => action.id.includes(":color:")) },
    ],
    sections,
    qualityGate: qualityGate(sections),
    executionGate: executionQualityGate(project, director),
  }
}
