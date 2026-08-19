import type { MelodyNote } from "./melody"

export interface PerformanceExecutionPlan {
  role:
    | "lead-focus"
    | "harmonic-space"
    | "pulse-foundation"
    | "counter-voice"
    | "transition-color"
    | "intentional-silence"
  velocityRange: readonly [number, number]
  articulation: "legato" | "sustained" | "pulsed" | "detached" | "swelling" | "decaying"
  timing: "strict" | "slightly-ahead" | "slightly-behind" | "floating"
}

export interface PerformanceExecutionContext {
  totalBeats: number
  beatsPerBar: number
  chordBoundaryBeats: number[]
  /** Counterの退場を主旋律の次アタックより前に制限するための参照。 */
  melodyNotes?: MelodyNote[]
}

export interface PerformanceExecutionDiagnostics {
  changedVelocityCount: number
  changedDurationCount: number
  changedOnsetCount: number
  protectedBoundaryCount: number
  collisionTrimCount: number
  pitchChangeCount: 0
}

export interface PerformanceExecutionResult {
  notes: MelodyNote[]
  diagnostics: PerformanceExecutionDiagnostics
}

export interface PerformanceCandidateReview {
  candidateId: string
  role: PerformanceExecutionPlan["role"]
  status: "strong" | "watch" | "revise"
  score: number
  summary: string
  diagnostics: PerformanceExecutionDiagnostics
  findings: string[]
}

const EPSILON = 0.000_1

function near(value: number, target: number, tolerance = 0.04): boolean {
  return Math.abs(value - target) <= tolerance
}

function isStructuralBoundary(
  beat: number,
  context: PerformanceExecutionContext,
): boolean {
  if (near(beat, 0)) return true
  const barPosition = beat / Math.max(0.25, context.beatsPerBar)
  if (near(barPosition, Math.round(barPosition), 0.01)) return true
  return context.chordBoundaryBeats.some((boundary) => near(beat, boundary))
}

function durationFactor(
  articulation: PerformanceExecutionPlan["articulation"],
): number {
  if (articulation === "detached") return 0.55
  if (articulation === "pulsed") return 0.72
  if (articulation === "decaying") return 0.82
  if (articulation === "swelling") return 0.9
  if (articulation === "legato") return 0.98
  return 1
}

function timingOffset(
  timing: PerformanceExecutionPlan["timing"],
): number {
  if (timing === "slightly-ahead") return -0.02
  if (timing === "slightly-behind") return 0.03
  return 0
}

function velocityFor(
  note: MelodyNote,
  minimumSource: number,
  maximumSource: number,
  plan: PerformanceExecutionPlan,
): number {
  const [low, high] = plan.velocityRange
  const sourceSpan = maximumSource - minimumSource
  const normalized = sourceSpan > 0
    ? (note.velocity - minimumSource) / sourceSpan
    : near(note.startBeat, Math.round(note.startBeat), 0.05) ? 0.68 : 0.48
  return Math.max(1, Math.min(127, Math.round(low + normalized * (high - low))))
}

function nextDistinctOnset(notes: MelodyNote[], index: number): number | null {
  const onset = notes[index].startBeat
  for (let nextIndex = index + 1; nextIndex < notes.length; nextIndex += 1) {
    if (notes[nextIndex].startBeat > onset + EPSILON) return notes[nextIndex].startBeat
  }
  return null
}

function nextMelodyAttack(
  melodyNotes: MelodyNote[],
  beat: number,
): number | null {
  return [...melodyNotes]
    .sort((left, right) => left.startBeat - right.startBeat)
    .find((note) => note.startBeat > beat + 0.04)?.startBeat ?? null
}

/**
 * 音程と音符IDを一切変更せず、Performance Planを実ノートへ反映する。
 * 小節頭・コード境界・Lock済み位置はmicrotimingの対象外にする。
 */
export function applyPerformanceExecution(
  sourceNotes: MelodyNote[],
  plan: PerformanceExecutionPlan,
  context: PerformanceExecutionContext,
): PerformanceExecutionResult {
  const notes = [...sourceNotes].sort(
    (left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch,
  )
  if (notes.length === 0 || plan.role === "intentional-silence") {
    return {
      notes: notes.map((note) => ({ ...note })),
      diagnostics: {
        changedVelocityCount: 0,
        changedDurationCount: 0,
        changedOnsetCount: 0,
        protectedBoundaryCount: 0,
        collisionTrimCount: 0,
        pitchChangeCount: 0,
      },
    }
  }

  const minimumSource = Math.min(...notes.map((note) => note.velocity))
  const maximumSource = Math.max(...notes.map((note) => note.velocity))
  const factor = durationFactor(plan.articulation)
  const requestedOffset = timingOffset(plan.timing)
  const diagnostics: PerformanceExecutionDiagnostics = {
    changedVelocityCount: 0,
    changedDurationCount: 0,
    changedOnsetCount: 0,
    protectedBoundaryCount: 0,
    collisionTrimCount: 0,
    pitchChangeCount: 0,
  }

  const transformed = notes.map((note, index) => {
    const velocity = velocityFor(note, minimumSource, maximumSource, plan)
    if (velocity !== note.velocity) diagnostics.changedVelocityCount += 1

    const startLocked = note.locks.includes("startPosition") || note.locks.includes("rhythm")
    const boundary = isStructuralBoundary(note.startBeat, context)
    let startBeat = note.startBeat
    if (requestedOffset !== 0 && !startLocked && !boundary) {
      startBeat = Math.max(0, Math.min(context.totalBeats - 0.0625, note.startBeat + requestedOffset))
      if (!near(startBeat, note.startBeat, EPSILON)) diagnostics.changedOnsetCount += 1
    } else if (requestedOffset !== 0 && boundary) {
      diagnostics.protectedBoundaryCount += 1
    }

    const durationLocked = note.locks.includes("rhythm")
    let durationBeats = durationLocked
      ? note.durationBeats
      : Math.max(0.0625, note.durationBeats * factor)
    const nextOnset = nextDistinctOnset(notes, index)
    if (nextOnset !== null && startBeat + durationBeats > nextOnset - 0.015) {
      durationBeats = Math.max(0.0625, nextOnset - startBeat - 0.015)
      diagnostics.collisionTrimCount += 1
    }
    if (plan.role === "counter-voice" && context.melodyNotes) {
      const attack = nextMelodyAttack(context.melodyNotes, startBeat)
      if (attack !== null && startBeat + durationBeats > attack - 0.04) {
        durationBeats = Math.max(0.0625, attack - startBeat - 0.04)
        diagnostics.collisionTrimCount += 1
      }
    }
    durationBeats = Math.min(durationBeats, Math.max(0.0625, context.totalBeats - startBeat))
    if (!near(durationBeats, note.durationBeats, EPSILON)) {
      diagnostics.changedDurationCount += 1
    }

    return {
      ...note,
      startBeat: Math.round(startBeat * 10_000) / 10_000,
      durationBeats: Math.round(durationBeats * 10_000) / 10_000,
      velocity,
    }
  })

  return { notes: transformed, diagnostics }
}

/**
 * Performance処理後の候補を安全性・計画適合の観点で再監査する。
 * 音楽的な最終採否は決めず、試聴前に確認すべき候補だけを明示する。
 */
export function reviewPerformanceExecution(
  candidateId: string,
  sourceNotes: MelodyNote[],
  result: PerformanceExecutionResult,
  plan: PerformanceExecutionPlan,
  context: PerformanceExecutionContext,
  options: { hasBlockingCollision?: boolean } = {},
): PerformanceCandidateReview {
  const sourceById = new Map(sourceNotes.map((note) => [note.id, note]))
  const [velocityLow, velocityHigh] = plan.velocityRange
  const findings: string[] = []
  let score = 100

  const pitchOrIdentityChanged = result.notes.some((note) => {
    const source = sourceById.get(note.id)
    return !source || source.pitch !== note.pitch
  }) || result.notes.length !== sourceNotes.length
  if (pitchOrIdentityChanged) {
    score -= 100
    findings.push("PitchまたはノートIDが演奏処理で変化しています。")
  }

  const outsideSection = result.notes.some(
    (note) =>
      note.startBeat < -EPSILON ||
      note.durationBeats <= 0 ||
      note.startBeat + note.durationBeats > context.totalBeats + EPSILON,
  )
  if (outsideSection) {
    score -= 60
    findings.push("セクション範囲外または不正音価のノートがあります。")
  }

  const velocityOutliers = result.notes.filter(
    (note) => note.velocity < velocityLow || note.velocity > velocityHigh,
  ).length
  if (velocityOutliers > 0) {
    score -= Math.min(30, 5 + velocityOutliers * 2)
    findings.push(`${velocityOutliers}音が計画Velocity範囲外です。`)
  }

  const shiftedStructuralBoundary = result.notes.some((note) => {
    const source = sourceById.get(note.id)
    return Boolean(
      source &&
      isStructuralBoundary(source.startBeat, context) &&
      !near(source.startBeat, note.startBeat, EPSILON),
    )
  })
  if (shiftedStructuralBoundary) {
    score -= 45
    findings.push("小節頭またはコード境界のオンセットが移動しています。")
  }

  if (options.hasBlockingCollision) {
    score -= 45
    findings.push("主旋律との同音・短2度・保護区間衝突が残っています。")
  }

  if (
    result.notes.length >= 3 &&
    velocityHigh - velocityLow >= 8 &&
    new Set(result.notes.map((note) => note.velocity)).size === 1
  ) {
    score -= 8
    findings.push("強弱計画に対して全音が同じVelocityへ収束しています。")
  }

  if (
    result.notes.length > 0 &&
    result.diagnostics.changedVelocityCount === 0 &&
    result.diagnostics.changedDurationCount === 0 &&
    result.diagnostics.changedOnsetCount === 0
  ) {
    score -= 5
    findings.push("演奏計画による実音上の変化がありません。")
  }

  score = Math.max(0, Math.round(score))
  const status = score >= 90 ? "strong" : score >= 75 ? "watch" : "revise"
  return {
    candidateId,
    role: plan.role,
    status,
    score,
    summary:
      status === "strong"
        ? "演奏計画と安全条件を満たしています。試聴で最終判断できます。"
        : status === "watch"
          ? "採用可能ですが、試聴で演奏差と余白を重点確認してください。"
          : "主旋律保護または構造安全性を確認してから採用してください。",
    diagnostics: result.diagnostics,
    findings,
  }
}
