import type { ComposerProject } from "@/core/project"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import { buildOrchestrationBlueprint } from "./orchestrationIntelligence"
import { reviewArrangementSection } from "./arrangementReview"
import { reviewWholeSongArrangement } from "./wholeSongArrangementReview"
import type {
  AiAccompanimentPatternId,
  AiArrangementIntent,
  AiCreativeRisk,
  AiMotion,
  AiRhythmCharacter,
  AiSilenceStrategy,
  OrchestrationFamily,
  OrchestrationRole,
} from "./types"

export type WholeSongDirectionId =
  | "preserve-space"
  | "controlled-escalation"
  | "motif-relay"

export type WholeSongActionGenerator =
  | "signature"
  | "counter"
  | "decoration"
  | "accompaniment"
  | "none"

export interface WholeSongArrangementAction {
  id: string
  sectionId: string
  sectionName: string
  generator: WholeSongActionGenerator
  role: OrchestrationRole
  family: OrchestrationFamily
  purpose: string
  entry: string
  exit: string
  density: "sparse" | "balanced" | "active"
  register: "low" | "middle" | "high"
  drama: "restrained" | "growing" | "open"
  motion: AiMotion
  rhythmCharacter: AiRhythmCharacter
  silenceStrategy: AiSilenceStrategy
  creativeRisk: AiCreativeRisk
  lengthBars: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  accompanimentPatternId: AiAccompanimentPatternId
  status: "available" | "already-active" | "unavailable" | "preserve"
  statusReason: string
}

export interface WholeSongArrangementDirection {
  id: WholeSongDirectionId
  title: string
  subtitle: string
  summary: string
  protect: string[]
  avoid: string[]
  actions: WholeSongArrangementAction[]
}

export interface WholeSongDirectionProgram {
  version: "1.0.0"
  brief: string
  diagnosis: {
    summary: string
    score: number
    energyArc: string
    confirmedSections: number
    totalSections: number
    opportunityCount: number
  }
  recommendedDirectionId: WholeSongDirectionId
  directions: [
    WholeSongArrangementDirection,
    WholeSongArrangementDirection,
    WholeSongArrangementDirection,
  ]
}

function clampLength(value: number): WholeSongArrangementAction["lengthBars"] {
  return Math.max(1, Math.min(8, Math.round(value))) as WholeSongArrangementAction["lengthBars"]
}

function registerFor(value: string): WholeSongArrangementAction["register"] {
  if (value === "low" || value === "low-middle") return "low"
  if (value === "middle-high" || value === "full") return "high"
  return "middle"
}

function activeForRole(
  project: ComposerProject,
  sectionId: string,
  role: OrchestrationRole,
): boolean {
  if (role === "pulse-foundation") {
    return Boolean(project.sectionAccompanimentPatternAssignments[sectionId])
  }
  if (role === "counter-voice") {
    return Boolean(project.sectionReactiveLayerAssignments?.[sectionId])
  }
  if (role === "transition-color") {
    return Boolean(project.sectionDecorationLayerAssignments?.[sectionId])
  }
  return false
}

function actionStatus(
  project: ComposerProject,
  sectionId: string,
  generator: WholeSongActionGenerator,
  role: OrchestrationRole,
): Pick<WholeSongArrangementAction, "status" | "statusReason"> {
  if (generator === "none") {
    return { status: "preserve", statusReason: "追加せず、現在の余白と残響を構成として保持します。" }
  }
  if (activeForRole(project, sectionId, role)) {
    return { status: "already-active", statusReason: "同じ役割のActive Layerがあるため、まず現在案を試聴します。" }
  }
  if (generator === "counter" && !project.sectionMelodyAssignments[sectionId]) {
    return { status: "unavailable", statusReason: "Counter生成には、このSectionのActive Melodyが必要です。" }
  }
  if (!project.chords.some((chord) => chord.sectionId === sectionId)) {
    return { status: "unavailable", statusReason: "生成に必要なコード進行がありません。" }
  }
  return { status: "available", statusReason: "候補を生成できます。生成しても自動採用はしません。" }
}

function action(
  project: ComposerProject,
  directionId: WholeSongDirectionId,
  value: Omit<WholeSongArrangementAction, "id" | "status" | "statusReason">,
): WholeSongArrangementAction {
  return {
    ...value,
    id: `${directionId}:${value.sectionId}:${value.generator}`,
    ...actionStatus(project, value.sectionId, value.generator, value.role),
  }
}

function actionForSection(
  project: ComposerProject,
  directionId: WholeSongDirectionId,
  sectionPlan: ReturnType<typeof buildArrangementDirectorBlueprint>["sections"][number],
  orchestration: ReturnType<typeof buildOrchestrationBlueprint>["sections"][number] | undefined,
): WholeSongArrangementAction {
  const section = project.sections.find((candidate) => candidate.id === sectionPlan.sectionId)!
  const partFor = (role: OrchestrationRole) =>
    orchestration?.parts.find((candidate) => candidate.role === role)
  let generator: WholeSongActionGenerator = "none"
  let role: OrchestrationRole = "intentional-silence"

  if (directionId === "preserve-space") {
    if (sectionPlan.climaxPolicy === "approach" || sectionPlan.climaxPolicy === "recover") {
      generator = "decoration"
      role = "transition-color"
    } else if (section.role === "intro" && sectionPlan.additionBudget > 0) {
      generator = "signature"
      role = "transition-color"
    } else if (sectionPlan.climaxPolicy === "express" && sectionPlan.additionBudget > 0) {
      generator = project.sectionMelodyAssignments[section.id] ? "counter" : "accompaniment"
      role = generator === "counter" ? "counter-voice" : "pulse-foundation"
    }
  } else if (directionId === "controlled-escalation") {
    if (section.role === "intro") {
      generator = "signature"
      role = "transition-color"
    } else if (section.role === "outro") {
      generator = "decoration"
      role = "transition-color"
    } else if (sectionPlan.climaxPolicy === "approach") {
      generator = "accompaniment"
      role = "pulse-foundation"
    } else if (sectionPlan.targetEnergy >= 4 && project.sectionMelodyAssignments[section.id]) {
      generator = "counter"
      role = "counter-voice"
    } else if (sectionPlan.targetEnergy >= 2 && sectionPlan.additionBudget > 0) {
      generator = "accompaniment"
      role = "pulse-foundation"
    }
  } else {
    if (section.role === "intro") {
      generator = "signature"
      role = "transition-color"
    } else if (
      ["develop", "declare", "transform"].includes(sectionPlan.narrativeFunction) &&
      project.sectionMelodyAssignments[section.id]
    ) {
      generator = "counter"
      role = "counter-voice"
    } else if (sectionPlan.climaxPolicy === "approach" || section.role === "outro") {
      generator = "decoration"
      role = "transition-color"
    } else if (sectionPlan.additionBudget > 0) {
      generator = "accompaniment"
      role = "pulse-foundation"
    }
  }

  const part = partFor(role)
  const sparse = directionId === "preserve-space" || sectionPlan.targetEnergy <= 2
  const active = directionId === "controlled-escalation" && sectionPlan.targetEnergy >= 4
  const pattern: AiAccompanimentPatternId = directionId === "preserve-space"
    ? "broken-ninth"
    : directionId === "controlled-escalation"
      ? sectionPlan.targetEnergy >= 4 ? "syncopated" : "pulse-root-fifth"
      : "chord-entry"
  return action(project, directionId, {
    sectionId: section.id,
    sectionName: section.name,
    generator,
    role,
    family: part?.family ?? (role === "counter-voice" ? "strings" : role === "pulse-foundation" ? "analog-synth" : "atmospheric-pad"),
    purpose: generator === "none"
      ? "主旋律とコードだけで成立する時間を守る"
      : part?.purpose ?? sectionPlan.introduce[0] ?? "Sectionに一つだけ新しい意味を加える",
    entry: part?.entry ?? "主旋律のアタックを避けて入る",
    exit: part?.exit ?? sectionPlan.transitionIntent,
    density: sparse ? "sparse" : active ? "active" : "balanced",
    register: registerFor(part?.register ?? sectionPlan.registerFocus),
    drama: sectionPlan.climaxPolicy === "express" ? "open" : sectionPlan.climaxPolicy === "approach" ? "growing" : "restrained",
    motion: sectionPlan.climaxPolicy === "approach" ? "ascending" : sectionPlan.climaxPolicy === "recover" ? "descending" : "wave",
    rhythmCharacter: directionId === "preserve-space" ? "spacious" : directionId === "controlled-escalation" ? "pulsed" : "fragmented",
    silenceStrategy: sectionPlan.silenceStrategy,
    creativeRisk: directionId === "motif-relay" ? "bold" : "focused",
    lengthBars: clampLength(generator === "signature" ? Math.min(2, section.lengthBars) : section.lengthBars),
    accompanimentPatternId: generator === "accompaniment" ? pattern : "none",
  })
}

function recommendedDirection(brief: string): WholeSongDirectionId {
  if (/(余白|静|抑制|少な|残響|空間)/i.test(brief)) return "preserve-space"
  if (/(上昇|盛り上|推進|リズム|ダンス|クレッシェンド)/i.test(brief)) return "controlled-escalation"
  if (/(モチーフ|記憶|反復|顔|フック|独創|不穏)/i.test(brief)) return "motif-relay"
  return "controlled-escalation"
}

export function buildWholeSongDirectionProgram(
  project: ComposerProject,
  brief: string,
): WholeSongDirectionProgram {
  const director = buildArrangementDirectorBlueprint(project)
  const orchestration = buildOrchestrationBlueprint(project, director)
  const reviews = director.sections.map((section) =>
    reviewArrangementSection(project, director, section.sectionId),
  )
  const wholeReview = reviewWholeSongArrangement(project, director, reviews)
  const makeActions = (id: WholeSongDirectionId) => director.sections.map((section) =>
    actionForSection(
      project,
      id,
      section,
      orchestration.sections.find((candidate) => candidate.sectionId === section.sectionId),
    ),
  )
  const directions: WholeSongDirectionProgram["directions"] = [
    {
      id: "preserve-space",
      title: "余白を主役にする設計",
      subtitle: "近景と遠景の距離で世界を開く",
      summary: "低Energy Sectionでは追加を拒み、境界・残響・限定された一音だけで曲の奥行きを作ります。",
      protect: ["Active Melodyの呼吸", "低Energy Sectionの希少な発音", "Climax前の最大密度"],
      avoid: ["全Sectionへの伴奏追加", "コードごとの機械的な追従", "残響を埋めるCounter"],
      actions: makeActions("preserve-space"),
    },
    {
      id: "controlled-escalation",
      title: "段階的に開く設計",
      subtitle: "音量ではなく役割交代で頂点へ向かう",
      summary: "Pulse、Transition、CounterをSectionごとに交代させ、最高音と最大密度をClimaxまで温存します。",
      protect: ["Section間のEnergy差", "サビ前の期待", "Climaxの一回性"],
      avoid: ["最初から全パートを鳴らすこと", "全Sectionで同じPattern", "音量だけのクレッシェンド"],
      actions: makeActions("controlled-escalation"),
    },
    {
      id: "motif-relay",
      title: "Motifを受け渡す設計",
      subtitle: "短い記憶の核を別の役割へ変形する",
      summary: "IntroのSignatureを出発点に、CounterとTransitionへ視点を移しながら曲全体の同一性を作ります。",
      protect: ["主旋律とMotifの役割差", "反復の記憶性", "Sectionごとの異なる見せ方"],
      avoid: ["主旋律の単純な二重化", "同じ音域での反復", "全ての回帰を完全形にすること"],
      actions: makeActions("motif-relay"),
    },
  ]
  return {
    version: "1.0.0",
    brief: brief.trim(),
    diagnosis: {
      summary: wholeReview.summary,
      score: wholeReview.score,
      energyArc: director.arcSummary,
      confirmedSections: wholeReview.metrics.reviewedSectionCount,
      totalSections: director.sections.length,
      opportunityCount: directions.reduce(
        (maximum, direction) => Math.max(maximum, direction.actions.filter((item) => item.status === "available").length),
        0,
      ),
    },
    recommendedDirectionId: recommendedDirection(brief),
    directions,
  }
}

/** 既存Generation Bridgeへ渡すため、全曲ActionをSection単位のIntentへ変換する。 */
export function intentForWholeSongAction(
  actionValue: WholeSongArrangementAction,
): AiArrangementIntent {
  return {
    id: actionValue.id,
    title: `${actionValue.sectionName} · ${actionValue.generator}`,
    generator: actionValue.generator,
    emotionalFunction: actionValue.purpose,
    density: actionValue.density,
    register: actionValue.register,
    drama: actionValue.drama,
    motion: actionValue.motion,
    rhythmCharacter: actionValue.rhythmCharacter,
    silenceStrategy: actionValue.silenceStrategy,
    creativeRisk: actionValue.creativeRisk,
    lengthBars: actionValue.lengthBars,
    techniques: [actionValue.role, actionValue.family],
    soundPalette: `${actionValue.family}を${actionValue.role}として配置`,
    performanceDirection: `${actionValue.entry}。${actionValue.exit}。`,
    why: actionValue.purpose,
    generationBrief: `${actionValue.purpose}。登場: ${actionValue.entry}。退場: ${actionValue.exit}。`,
    soundSourceSuggestions: [],
    accompanimentPatternId: actionValue.accompanimentPatternId,
    rhythmPlan: {
      enabled: false,
      subdivision: "eighth",
      feel: "straight",
      kickPattern: "",
      snarePattern: "",
      hatPattern: "",
      percussionPattern: "",
      variation: "",
      bars: 1,
      events: [],
    },
  }
}
