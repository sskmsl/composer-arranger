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
  | "rhythmic-propulsion"
  | "motif-relay"
  | "balanced-architecture"

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
  character: "minimal" | "cinematic" | "rhythmic" | "dark-experimental" | "balanced"
  protect: string[]
  avoid: string[]
  actions: WholeSongArrangementAction[]
}

export interface WholeSongDirectionProgram {
  version: "2.0.0"
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
  recommendationReason: string
  directions: [
    WholeSongArrangementDirection,
    WholeSongArrangementDirection,
    WholeSongArrangementDirection,
    WholeSongArrangementDirection,
    WholeSongArrangementDirection,
  ]
}

/**
 * AI相談の抽象Directionを、既存の全曲Directorが実行できる5系統へ接続する。
 * AIが実音を直接決めず、曲全体のSection別Generator選択は決定論的Directorへ委ねる。
 */
export function wholeSongDirectionForAiIntent(
  project: ComposerProject,
  intent: AiArrangementIntent,
): {
  program: WholeSongDirectionProgram
  direction: WholeSongArrangementDirection
} {
  const generatorHint =
    intent.generator === "rhythm" || intent.generator === "accompaniment"
      ? "リズム グルーヴ 推進"
      : intent.generator === "signature" || intent.generator === "phrase"
        ? "モチーフ 記憶 フック"
        : intent.generator === "counter"
          ? "主旋律 全体 バランス"
          : intent.generator === "decoration"
            ? "ドラマ 上昇 セクション境界"
            : "全体 バランス"
  const brief = [
    intent.title,
    intent.emotionalFunction,
    intent.generationBrief,
    intent.why,
    intent.techniques.join(" "),
    generatorHint,
  ].join(" ")
  const program = buildWholeSongDirectionProgram(project, brief)
  const direction = program.directions.find(
    (candidate) => candidate.id === program.recommendedDirectionId,
  ) ?? program.directions[4]
  return { program, direction }
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

export function resolveWholeSongActionStatus(
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
    ...resolveWholeSongActionStatus(project, value.sectionId, value.generator, value.role),
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
  } else if (directionId === "rhythmic-propulsion") {
    if (section.role === "intro" && sectionPlan.additionBudget > 0) {
      generator = "signature"
      role = "transition-color"
    } else if (section.role === "outro" || sectionPlan.climaxPolicy === "recover") {
      generator = "decoration"
      role = "transition-color"
    } else if (sectionPlan.additionBudget > 0) {
      generator = "accompaniment"
      role = "pulse-foundation"
    }
  } else if (directionId === "motif-relay") {
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
  } else if (section.role === "intro" && sectionPlan.additionBudget > 0) {
    generator = "signature"
    role = "transition-color"
  } else if (sectionPlan.climaxPolicy === "approach") {
    generator = "decoration"
    role = "transition-color"
  } else if (
    sectionPlan.targetEnergy >= 3 &&
    sectionPlan.targetEnergy <= 4 &&
    project.sectionMelodyAssignments[section.id]
  ) {
    generator = "counter"
    role = "counter-voice"
  } else if (sectionPlan.additionBudget > 0 && section.role !== "outro") {
    generator = "accompaniment"
    role = "pulse-foundation"
  }

  const part = partFor(role)
  const sparse = directionId === "preserve-space" || sectionPlan.targetEnergy <= 2
  const active = ["controlled-escalation", "rhythmic-propulsion"].includes(directionId) && sectionPlan.targetEnergy >= 4
  const pattern: AiAccompanimentPatternId = directionId === "preserve-space"
    ? "broken-ninth"
    : directionId === "controlled-escalation"
      ? sectionPlan.targetEnergy >= 4 ? "syncopated" : "pulse-root-fifth"
      : directionId === "rhythmic-propulsion"
        ? sectionPlan.targetEnergy >= 3 ? "syncopated" : "pulse-root-fifth"
        : directionId === "balanced-architecture"
          ? "arpeggio-five"
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
    rhythmCharacter: directionId === "preserve-space"
      ? "spacious"
      : ["controlled-escalation", "rhythmic-propulsion"].includes(directionId)
        ? "pulsed"
        : directionId === "motif-relay"
          ? "fragmented"
          : "flowing",
    silenceStrategy: sectionPlan.silenceStrategy,
    creativeRisk: directionId === "motif-relay" ? "bold" : "focused",
    lengthBars: clampLength(generator === "signature" ? Math.min(2, section.lengthBars) : section.lengthBars),
    accompanimentPatternId: generator === "accompaniment" ? pattern : "none",
  })
}

function recommendation(
  project: ComposerProject,
  brief: string,
): Pick<WholeSongDirectionProgram, "recommendedDirectionId" | "recommendationReason"> {
  const scores: Record<WholeSongDirectionId, number> = {
    "preserve-space": 0,
    "controlled-escalation": 0,
    "rhythmic-propulsion": 0,
    "motif-relay": 0,
    "balanced-architecture": 2,
  }
  const reasons: Partial<Record<WholeSongDirectionId, string>> = {}
  const add = (id: WholeSongDirectionId, score: number, reason: string) => {
    scores[id] += score
    reasons[id] = reason
  }
  if (/(余白|静|抑制|少な|残響|空間|呼吸)/i.test(brief)) add("preserve-space", 8, "制作意図が余白・抑制・距離感を明示しています。")
  if (/(映画|ドラマ|弦|ストリングス|壮大|クライマックス|上昇|盛り上|クレッシェンド)/i.test(brief)) add("controlled-escalation", 8, "Sectionの役割交代でドラマと頂点を作る意図に最も合います。")
  if (/(推進|リズム|グルーヴ|ダンス|ビート|パルス|躍動)/i.test(brief)) add("rhythmic-propulsion", 9, "リズムと周期を中心に曲を前へ進める意図が明確です。")
  if (/(モチーフ|記憶|反復|顔|フック|独創|不穏|暗|意外|実験)/i.test(brief)) add("motif-relay", 8, "記憶の核と不穏な変形をSection間で受け渡す余地があります。")
  if (/(自然|バランス|歌|主旋律|王道|過不足|全体)/i.test(brief)) add("balanced-architecture", 6, "主旋律を中心に各役割を過不足なく配分する意図に合います。")

  const activeMelodySections = project.sections.filter(
    (section) => project.sectionMelodyAssignments[section.id],
  ).length
  const offBeatNotes = project.melodyVariants.flatMap((variant) => variant.notes)
    .filter((note) => Math.abs(note.startBeat - Math.round(note.startBeat)) > 0.05).length
  const noteCount = project.melodyVariants.reduce((sum, variant) => sum + variant.notes.length, 0)
  const chromaticChords = project.chords.filter((chord) => /dim|aug|[#b]|sus|add9|maj7/i.test(chord.symbol)).length
  if (noteCount > 0 && offBeatNotes / noteCount >= 0.3) {
    add("rhythmic-propulsion", 3, "既存旋律に裏拍の動きがあり、リズムの個性を発展できます。")
  }
  if (project.chords.length > 0 && chromaticChords / project.chords.length >= 0.35) {
    add("motif-relay", 3, "和声に未解決感と色彩があり、意外性を無理なく拡張できます。")
  }
  if (project.sections.length >= 4) {
    add("controlled-escalation", 2, "複数Sectionの高低差を利用して、頂点まで段階的に展開できます。")
  }
  if (activeMelodySections < Math.max(1, project.sections.length / 2)) {
    add("preserve-space", 1, "主旋律未確定のSectionを埋めず、余白として保護できます。")
  }

  const recommendedDirectionId = (Object.entries(scores) as Array<[WholeSongDirectionId, number]>)
    .sort((left, right) => right[1] - left[1])[0][0]
  return {
    recommendedDirectionId,
    recommendationReason: reasons[recommendedDirectionId]
      ?? "現在のMelody・コード・Section構成を最も自然に活かし、後から個別調整しやすい案です。",
  }
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
  const recommended = recommendation(project, brief)
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
      title: "Minimal",
      subtitle: "近景と遠景の距離で世界を開く",
      summary: "低Energy Sectionでは追加を拒み、境界・残響・限定された一音だけで曲の奥行きを作ります。",
      character: "minimal",
      protect: ["Active Melodyの呼吸", "低Energy Sectionの希少な発音", "Climax前の最大密度"],
      avoid: ["全Sectionへの伴奏追加", "コードごとの機械的な追従", "残響を埋めるCounter"],
      actions: makeActions("preserve-space"),
    },
    {
      id: "controlled-escalation",
      title: "Cinematic",
      subtitle: "ストリングスと役割交代で頂点へ向かう",
      summary: "Pulse、Transition、CounterをSectionごとに交代させ、最高音と最大密度をClimaxまで温存します。",
      character: "cinematic",
      protect: ["Section間のEnergy差", "サビ前の期待", "Climaxの一回性"],
      avoid: ["最初から全パートを鳴らすこと", "全Sectionで同じPattern", "音量だけのクレッシェンド"],
      actions: makeActions("controlled-escalation"),
    },
    {
      id: "rhythmic-propulsion",
      title: "Rhythmic",
      subtitle: "周期・アクセント・休符で推進力を作る",
      summary: "コードを細かく説明せず、Sectionごとに異なるPulseと抜き差しを設計して身体的な前進を作ります。",
      character: "rhythmic",
      protect: ["Active Melodyのアクセント", "低域の見通し", "Sectionごとの異なる歩幅"],
      avoid: ["全拍を埋める伴奏", "Kickとの完全な同期", "全Sectionで同じシンコペーション"],
      actions: makeActions("rhythmic-propulsion"),
    },
    {
      id: "motif-relay",
      title: "Dark / Experimental",
      subtitle: "不穏な記憶の核を異なる役割へ変形する",
      summary: "IntroのSignatureを出発点に、断片化したCounterと境界のColorへ視点を移し、意外性を因果のある形で作ります。",
      character: "dark-experimental",
      protect: ["主旋律とMotifの役割差", "反復の記憶性", "Sectionごとの異なる見せ方"],
      avoid: ["主旋律の単純な二重化", "同じ音域での反復", "全ての回帰を完全形にすること"],
      actions: makeActions("motif-relay"),
    },
    {
      id: "balanced-architecture",
      title: "Balanced",
      subtitle: "主旋律を中心に役割を過不足なく配分する",
      summary: "Melodyを唯一の前景として守り、Pulse・Counter・Transitionを必要なSectionだけへ配置します。",
      character: "balanced",
      protect: ["Active Melodyの感情点", "コードの色彩", "Section間の密度差"],
      avoid: ["安全な全乗せ", "同じ役割の重複", "すべてを均等に鳴らすこと"],
      actions: makeActions("balanced-architecture"),
    },
  ]
  return {
    version: "2.0.0",
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
    ...recommended,
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
