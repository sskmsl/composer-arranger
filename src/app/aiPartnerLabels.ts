import type { AiArrangementIntent, ArrangementReviewStatus, OrchestrationPartPlan } from "@/ai-arranger/types"
import type { ComposerProject } from "@/core/project"

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}

export function accompanimentPatternName(
  project: ComposerProject,
  patternId: string,
): string {
  return project.accompanimentPatterns.find((pattern) => pattern.id === patternId)?.name
    ?? patternId
}

export function rhythmSubdivisionLabel(value: AiArrangementIntent["rhythmPlan"]["subdivision"]): string {
  return {
    eighth: "8分音符中心",
    sixteenth: "16分音符中心",
    triplet: "3連符中心",
    mixed: "複数の細かさを組み合わせる",
  }[value]
}

export function rhythmFeelLabel(value: AiArrangementIntent["rhythmPlan"]["feel"]): string {
  return {
    straight: "まっすぐな拍",
    swing: "少し跳ねる拍",
    "laid-back": "わずかに後ろへためる",
    driving: "前へ押し出す",
    broken: "途切れを活かす",
  }[value]
}

export function energyLabel(value: number): string {
  if (value >= 5) return "最も強い"
  if (value === 4) return "強い"
  if (value === 3) return "中間"
  if (value === 2) return "控えめ"
  return "静か"
}

export function reviewStatusLabel(status: ArrangementReviewStatus): string {
  return {
    pending: "レビュー待ち",
    strong: "設計と整合",
    watch: "要確認",
    revise: "修正推奨",
  }[status]
}

export function reviewStatusClass(status: ArrangementReviewStatus): string {
  if (status === "strong") return "bg-emerald-400/10 text-emerald-200"
  if (status === "revise") return "bg-red-400/10 text-red-200"
  if (status === "watch") return "bg-amber-300/10 text-amber-100"
  return "bg-white/8 text-body-muted"
}

export function orchestrationRoleLabel(role: OrchestrationPartPlan["role"]): string {
  return {
    "lead-focus": "主役",
    "harmonic-space": "和声空間",
    "pulse-foundation": "周期と推進",
    "counter-voice": "第二の声",
    "transition-color": "場面転換",
    "intentional-silence": "意図的な無音",
  }[role]
}

export function orchestrationFamilyLabel(family: OrchestrationPartPlan["family"]): string {
  return {
    "lead-voice": "主役の音",
    "piano-keys": "ピアノ／鍵盤",
    strings: "弦楽器",
    "analog-synth": "アナログシンセ",
    "atmospheric-pad": "広がる持続音",
    "mallet-bell": "ベル／打楽器系の音",
    percussion: "打楽器",
    silence: "無音",
  }[family]
}

export function orchestrationDistanceLabel(
  distance: OrchestrationPartPlan["distance"],
): string {
  return {
    intimate: "最前景",
    near: "前景",
    middle: "中景",
    distant: "遠景",
  }[distance]
}

export function registerLabel(register: OrchestrationPartPlan["register"]): string {
  return {
    low: "低い音域",
    "low-middle": "低めから中間の音域",
    middle: "中間の音域",
    "middle-high": "中間から高めの音域",
    full: "広い音域",
  }[register]
}

export function articulationLabel(value: OrchestrationPartPlan["articulation"]): string {
  return {
    legato: "滑らかにつなぐ",
    sustained: "長く保つ",
    pulsed: "短く繰り返す",
    detached: "一音ずつ切る",
    swelling: "次第に大きくする",
    decaying: "次第に消える",
  }[value]
}

export function dynamicLabel(value: OrchestrationPartPlan["dynamic"]): string {
  return { pp: "とても弱く", p: "弱く", mp: "やや弱く", mf: "やや強く", f: "強く" }[value]
}

export function timingLabel(value: OrchestrationPartPlan["timing"]): string {
  return {
    strict: "拍どおり",
    "slightly-ahead": "少し前",
    "slightly-behind": "少し後ろ",
    floating: "拍へ厳密に合わせない",
  }[value]
}
