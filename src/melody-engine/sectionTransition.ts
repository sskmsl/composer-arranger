import type { ComposerProject, ChordEvent } from "@/core/project"
import type {
  MelodyNote,
  MelodyTransitionPlan,
  MelodyVariant,
  SectionTransitionStrategy,
} from "@/core/melody"
import { parseTimeSignature, type SectionRole } from "@/core/section"
import { normalizeSectionTimeline, assignedVariantForSection } from "@/core/sectionTimeline"
import { layersOf } from "@/core/sectionLayers"
import { buildHarmonicMap } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"

export interface SectionTransitionContext {
  sourceSectionId: string
  sourceVariantId: string
  targetSectionId: string
  targetRole: SectionRole
  targetFirstChord: string
  contextFingerprint: string
  previousTailNotes: MelodyNote[]
  previousLastPitch: number
  previousDirection: -1 | 0 | 1
  previousRegisterCenter: number
  previousTension: number
  previousEndingStrategy?: string
  previousUnresolvedResolution?: MelodyNote["plannedResolution"]
  previousMotifIntervals: number[]
  targetEnergy: number
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function sortedNotes(variant: MelodyVariant): MelodyNote[] {
  return layersOf(variant)
    .filter((layer) => layer.partRole === "lead")
    .flatMap((layer) => layer.notes)
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

function directionOf(notes: MelodyNote[]): -1 | 0 | 1 {
  if (notes.length < 2) return 0
  const delta = notes[notes.length - 1].pitch - notes[Math.max(0, notes.length - 3)].pitch
  return delta === 0 ? 0 : delta > 0 ? 1 : -1
}

function motifIntervalsOf(notes: MelodyNote[]): number[] {
  return notes.slice(-4).slice(1).map((note, index) => note.pitch - notes.slice(-4)[index].pitch)
}

function energyForRole(role: SectionRole): number {
  if (role === "grand-chorus") return 1
  if (role === "chorus") return 0.88
  if (role === "pre-chorus" || role === "bridge" || role === "c-melody") return 0.68
  if (role === "outro" || role === "intro") return 0.35
  return 0.5
}

/** 現在の曲順と前セクションのActive Melodyから、生成時だけ使う接続コンテキストを作る。 */
export function buildSectionTransitionContext(
  project: ComposerProject,
  targetSectionId: string,
): SectionTransitionContext | undefined {
  const sections = normalizeSectionTimeline(project.sections)
  const targetIndex = sections.findIndex((section) => section.id === targetSectionId)
  if (targetIndex <= 0) return undefined
  const target = sections[targetIndex]
  const source = sections[targetIndex - 1]
  const sourceVariant = assignedVariantForSection(project, source.id)
  if (!sourceVariant) return undefined
  const notes = sortedNotes(sourceVariant)
  if (notes.length === 0) return undefined
  const sourceLengthBeats =
    source.lengthBars * parseTimeSignature(project.song.timeSignature).beatsPerBar
  const tail = notes.filter((note) => note.startBeat + note.durationBeats >= sourceLengthBeats - 8).slice(-12)
  const last = notes[notes.length - 1]
  const targetChord = project.chords
    .filter((chord) => chord.sectionId === target.id)
    .sort((a, b) => a.startBeat - b.startBeat)[0]
  const fingerprintPayload = {
    sourceSectionId: source.id,
    sourceVariantId: sourceVariant.id,
    sourceNotes: tail.map((note) => [
      Number(note.startBeat.toFixed(4)),
      Number(note.durationBeats.toFixed(4)),
      note.pitch,
      note.plannedToneRole,
      note.plannedResolution,
    ]),
    ending: sourceVariant.candidateMelodyDNA?.endingStrategy ?? sourceVariant.elegiacPlan?.endingStrategy,
    motif: sourceVariant.candidateMelodyDNA?.motifIdentity,
    targetSectionId: target.id,
    targetRole: target.role,
    targetChord: targetChord?.symbol ?? "",
  }
  return {
    sourceSectionId: source.id,
    sourceVariantId: sourceVariant.id,
    targetSectionId: target.id,
    targetRole: target.role,
    targetFirstChord: targetChord?.symbol ?? "",
    contextFingerprint: stableHash(fingerprintPayload),
    previousTailNotes: tail,
    previousLastPitch: last.pitch,
    previousDirection: directionOf(tail),
    previousRegisterCenter: tail.reduce((sum, note) => sum + note.pitch, 0) / tail.length,
    previousTension: last.plannedToneRole && last.plannedToneRole !== "chord-tone" ? 1 : 0,
    previousEndingStrategy: sourceVariant.candidateMelodyDNA?.endingStrategy ?? sourceVariant.elegiacPlan?.endingStrategy,
    previousUnresolvedResolution:
      last.plannedResolution &&
      (last.plannedResolution.targetBeat >= sourceLengthBeats ||
        last.plannedToneRole === "suspension" ||
        last.plannedToneRole === "tension-hold")
        ? last.plannedResolution
        : undefined,
    previousMotifIntervals:
      project.songMotifDNA?.intervalCells.length
        ? project.songMotifDNA.intervalCells.slice(0, 4)
        : motifIntervalsOf(tail),
    targetEnergy: energyForRole(target.role),
  }
}

export function isTransitionContextStale(project: ComposerProject, variant: MelodyVariant): boolean {
  if (!variant.transitionPlan) return false
  const current = buildSectionTransitionContext(project, variant.sectionId)
  return !current || current.contextFingerprint !== variant.transitionPlan.contextFingerprint
}

function strategyPool(role: SectionRole): SectionTransitionStrategy[] {
  if (role === "outro") return ["resolved", "open", "suspended", "motif-call-response"]
  if (role === "chorus" || role === "grand-chorus") {
    return ["pickup-to-next", "motif-call-response", "open", "suspended", "carry-over"]
  }
  if (role === "verse" || role === "c-melody") {
    return ["carry-over", "open", "motif-call-response", "suspended", "resolved"]
  }
  return ["suspended", "pickup-to-next", "motif-call-response", "carry-over", "open", "resolved"]
}

function clampPitch(pitch: number, range: RangeSetting): number {
  let next = pitch
  while (next < range.low) next += 12
  while (next > range.high) next -= 12
  return Math.max(range.low, Math.min(range.high, next))
}

function nearestPitchClass(reference: number, pitchClasses: number[], range: RangeSetting): number {
  let best = clampPitch(reference, range)
  let distance = Number.POSITIVE_INFINITY
  for (let pitch = range.low; pitch <= range.high; pitch++) {
    if (!pitchClasses.includes(((pitch % 12) + 12) % 12)) continue
    const candidateDistance = Math.abs(reference - pitch)
    if (candidateDistance < distance) {
      best = pitch
      distance = candidateDistance
    }
  }
  return best
}

function scoreTransition(
  notes: MelodyNote[],
  context: SectionTransitionContext,
  strategy: SectionTransitionStrategy,
  sustain: number,
): Omit<MelodyTransitionPlan, "sourceSectionId" | "sourceVariantId" | "contextFingerprint" | "pickup"> {
  const first = notes[0]
  const interval = first ? Math.abs(first.pitch - context.previousLastPitch) : 12
  const gap = first?.startBeat ?? 2
  const pitchContinuityScore =
    strategy === "open" ? Math.max(0, 100 - Math.abs(interval - 7) * 10) : Math.max(0, 100 - interval * 7)
  const rhythmContinuityScore =
    strategy === "carry-over" || strategy === "suspended"
      ? Math.max(0, 100 - Math.abs(gap - sustain) * 50)
      : strategy === "pickup-to-next"
        ? 100
        : Math.max(0, 100 - Math.abs(gap - 0.5) * 35)
  const tensionResolutionScore =
    strategy === "suspended"
      ? context.previousTension > 0 ? 100 : 72
      : strategy === "resolved"
        ? context.previousTension > 0 ? 84 : 92
        : 78
  const nextDirection =
    notes.length < 2 ? 0 : Math.sign(notes[Math.min(2, notes.length - 1)].pitch - notes[0].pitch)
  const motifRelationScore =
    strategy === "motif-call-response"
      ? nextDirection !== context.previousDirection ? 96 : 72
      : 76
  const registerTrajectoryScore = Math.max(
    0,
    100 - Math.max(0, Math.abs((first?.pitch ?? context.previousLastPitch) - context.previousRegisterCenter) - 5) * 7,
  )
  const transitionFitScore =
    pitchContinuityScore * 0.25 +
    rhythmContinuityScore * 0.2 +
    tensionResolutionScore * 0.25 +
    motifRelationScore * 0.15 +
    registerTrajectoryScore * 0.15
  return {
    strategy,
    transitionFitScore,
    pitchContinuityScore,
    rhythmContinuityScore,
    tensionResolutionScore,
    motifRelationScore,
    registerTrajectoryScore,
    sustainAcrossBoundaryBeats: sustain,
  }
}

function removeAccidentalOverlaps(notes: MelodyNote[]): void {
  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  for (let index = 1; index < notes.length; index++) {
    const previous = notes[index - 1]
    const current = notes[index]
    const previousEnd = previous.startBeat + previous.durationBeats
    if (previousEnd <= current.startBeat + 1e-9) continue
    if (current.startBeat > previous.startBeat + 0.0625) {
      previous.durationBeats = current.startBeat - previous.startBeat
    } else {
      current.startBeat = previousEnd
    }
  }
}

/**
 * 生成済みの全体像を壊さず、冒頭だけへ接続方針を実音化する。
 * 最近傍音へ一律スナップせず、オクターブ関係・休符・掛留・応答輪郭を優先する。
 */
export function applySectionTransition(
  inputNotes: MelodyNote[],
  context: SectionTransitionContext | undefined,
  candidatePoolIndex: number,
  range: RangeSetting,
  targetChords: ChordEvent[],
): { notes: MelodyNote[]; plan?: MelodyTransitionPlan } {
  if (!context || inputNotes.length === 0) return { notes: inputNotes }
  const strategies = strategyPool(context.targetRole)
  const strategy = strategies[candidatePoolIndex % strategies.length]
  const notes = inputNotes.map((note) => ({ ...note })).sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const firstChord = buildHarmonicMap(targetChords)[0]
  const chordPitchClasses = firstChord
    ? [...new Set([firstChord.parsed.rootPc, ...firstChord.parsed.tones.map((tone) => tone.pitchClass)])]
    : [((notes[0].pitch % 12) + 12) % 12]
  let sustain = 0
  let pickup: MelodyTransitionPlan["pickup"]

  // 大きすぎる偶発的なレジスター断絶だけを、同じpitch classのオクターブ移動で直す。
  if (Math.abs(notes[0].pitch - context.previousLastPitch) > 12) {
    const adjusted = clampPitch(notes[0].pitch + (notes[0].pitch > context.previousLastPitch ? -12 : 12), range)
    const delta = adjusted - notes[0].pitch
    for (const note of notes.filter((candidate) => candidate.startBeat < 2)) {
      note.pitch = clampPitch(note.pitch + delta, range)
    }
  }

  if (strategy === "carry-over" || strategy === "suspended") {
    sustain = strategy === "carry-over" ? 1 : 0.5
    const originalFirstBeat = notes[0].startBeat
    if (originalFirstBeat < sustain) {
      const delta = sustain - originalFirstBeat
      for (const note of notes.filter((candidate) => candidate.startBeat < 2)) note.startBeat += delta
    }
    if (strategy === "suspended") {
      notes[0].pitch = nearestPitchClass(context.previousLastPitch, chordPitchClasses, range)
      notes[0].plannedToneRole = "chord-tone"
    }
  } else if (strategy === "pickup-to-next") {
    const targetPitch = nearestPitchClass(notes[0].pitch, chordPitchClasses, range)
    const approach = clampPitch(targetPitch + (targetPitch >= context.previousLastPitch ? -1 : 1), range)
    pickup = { pitch: approach, durationBeats: 0.5, velocity: Math.max(48, notes[0].velocity - 10) }
  } else if (strategy === "motif-call-response" && notes.length >= 2) {
    const previousDirection = context.previousDirection || 1
    const responseStep = previousDirection > 0 ? -2 : 2
    notes[1].pitch = clampPitch(notes[0].pitch + responseStep, range)
  }

  removeAccidentalOverlaps(notes)
  const scores = scoreTransition(notes, context, strategy, sustain)
  return {
    notes,
    plan: {
      ...scores,
      sourceSectionId: context.sourceSectionId,
      sourceVariantId: context.sourceVariantId,
      contextFingerprint: context.contextFingerprint,
      pickup,
    },
  }
}
