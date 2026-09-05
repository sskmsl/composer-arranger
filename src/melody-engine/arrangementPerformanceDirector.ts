import type {
  ArrangementPerformanceArc,
  ArrangementPlan,
  ArrangementSectionPlan,
  ArrangementTrackId,
  GeneratedArrangementNote,
  GeneratedArrangementTrack,
} from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import {
  applyPerformanceExecution,
  type PerformanceExecutionPlan,
} from "@/core/performanceExecution"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function performanceRole(trackId: ArrangementTrackId): PerformanceExecutionPlan["role"] {
  if (trackId.startsWith("dr-") || trackId === "syn-pulse" || trackId === "syn-stabs") return "pulse-foundation"
  if (trackId === "syn-transition-phrase" || trackId === "syn-high-glass" || trackId === "syn-final-lift") return "transition-color"
  if (trackId === "str-violin-1" || trackId === "str-upper") return "counter-voice"
  return "harmonic-space"
}

function articulationFor(
  trackId: ArrangementTrackId,
  section: ArrangementSectionPlan,
): PerformanceExecutionPlan["articulation"] {
  if (trackId.includes("hat") || trackId === "syn-stabs") return "detached"
  if (trackId.startsWith("dr-") || trackId === "syn-pulse") return "pulsed"
  if (trackId === "syn-high-glass") return "decaying"
  if (trackId === "syn-transition-phrase" || trackId === "syn-final-lift") return "swelling"
  if (trackId === "syn-dark-pad") return section.semanticRole === "outro" ? "decaying" : "sustained"
  if (trackId === "syn-bass") return section.bassStrategy === "sustain" ? "sustained" : "pulsed"
  if (trackId.startsWith("str-")) return section.semanticRole === "final" ? "swelling" : "legato"
  return "sustained"
}

function timingFor(trackId: ArrangementTrackId): PerformanceExecutionPlan["timing"] {
  if (trackId === "dr-kick" || trackId === "syn-pulse") return "strict"
  if (trackId === "dr-snare" || trackId === "dr-field-drum" || trackId.includes("hat")) return "slightly-behind"
  if (trackId === "syn-transition-phrase" || trackId === "syn-final-lift") return "slightly-ahead"
  if (trackId === "syn-bass" || trackId === "syn-dark-pad") return "slightly-behind"
  return "floating"
}

function velocityRangeFor(trackId: ArrangementTrackId, energy: number): readonly [number, number] {
  const normalized = clamp(energy, 10, 100) / 100
  if (trackId === "dr-kick" || trackId === "dr-gran-cassa") return [Math.round(58 + normalized * 16), Math.round(78 + normalized * 35)]
  if (trackId === "dr-snare" || trackId.includes("tom") || trackId === "dr-field-drum") return [Math.round(48 + normalized * 15), Math.round(70 + normalized * 32)]
  if (trackId.includes("hat")) return [Math.round(36 + normalized * 12), Math.round(54 + normalized * 24)]
  if (trackId === "dr-crash") return [72, Math.round(88 + normalized * 24)]
  if (trackId === "syn-bass") return [Math.round(44 + normalized * 12), Math.round(64 + normalized * 25)]
  if (trackId === "syn-pulse" || trackId === "syn-stabs") return [Math.round(36 + normalized * 10), Math.round(55 + normalized * 22)]
  if (trackId === "syn-dark-pad") return [Math.round(27 + normalized * 7), Math.round(42 + normalized * 16)]
  if (trackId === "syn-high-glass") return [38, Math.round(52 + normalized * 18)]
  if (trackId === "syn-transition-phrase" || trackId === "syn-final-lift") return [Math.round(42 + normalized * 9), Math.round(66 + normalized * 27)]
  if (trackId.startsWith("str-")) return [Math.round(36 + normalized * 11), Math.round(58 + normalized * 29)]
  return [48, 80]
}

function arcFor(section: ArrangementSectionPlan): ArrangementPerformanceArc {
  if (section.semanticRole === "pre" || section.semanticRole === "build") return "build"
  if (section.semanticRole === "chorus" || section.semanticRole === "final") return "release"
  if (section.semanticRole === "breakdown" || section.semanticRole === "outro" || section.semanticRole === "reprise") return "withdraw"
  if (section.semanticRole === "intro") return section.energy >= 45 ? "build" : "restrained"
  return section.energy <= 42 ? "breathe" : "restrained"
}

export function buildArrangementPerformancePlan(
  trackId: ArrangementTrackId,
  section: ArrangementSectionPlan,
): PerformanceExecutionPlan & { arc: ArrangementPerformanceArc } {
  return {
    role: performanceRole(trackId),
    velocityRange: velocityRangeFor(trackId, section.energy),
    articulation: articulationFor(trackId, section),
    timing: timingFor(trackId),
    arc: arcFor(section),
  }
}

function arcAmount(arc: ArrangementPerformanceArc, progress: number): number {
  if (arc === "build") return -0.12 + progress * 0.28
  if (arc === "release") return 0.12 - Math.abs(progress - 0.62) * 0.16
  if (arc === "withdraw") return 0.1 - progress * 0.24
  if (arc === "breathe") return Math.sin(progress * Math.PI * 2) * 0.07
  return Math.sin(progress * Math.PI) * 0.05 - 0.03
}

function roleAccent(trackId: ArrangementTrackId, note: GeneratedArrangementNote, beatsPerBar: number): number {
  const position = ((note.startBeat % beatsPerBar) + beatsPerBar) % beatsPerBar
  if (trackId === "dr-kick") return position < 0.05 ? 7 : position >= beatsPerBar / 2 - 0.05 && position <= beatsPerBar / 2 + 0.05 ? 3 : -2
  if (trackId === "dr-snare") return 5
  if (trackId.includes("hat")) return Math.abs(position - Math.round(position)) < 0.05 ? 2 : -4
  if (trackId === "syn-pulse") return Math.abs(position - Math.round(position)) < 0.05 ? 3 : -3
  if (trackId === "syn-bass") return position < 0.05 ? 4 : 0
  return 0
}

function applyArc(
  notes: GeneratedArrangementNote[],
  trackId: ArrangementTrackId,
  sectionStart: number,
  sectionLength: number,
  arc: ArrangementPerformanceArc,
  velocityRange: readonly [number, number],
  beatsPerBar: number,
): GeneratedArrangementNote[] {
  const [minimum, maximum] = velocityRange
  const span = maximum - minimum
  return notes.map((note) => {
    const progress = clamp((note.startBeat - sectionStart) / Math.max(0.25, sectionLength), 0, 1)
    const phrasePosition = ((note.startBeat - sectionStart) % (beatsPerBar * 4)) / (beatsPerBar * 4)
    const phraseBreath = phrasePosition >= 0.9 ? -0.07 : phrasePosition < 0.08 ? 0.04 : 0
    const shapedVelocity = note.velocity + (arcAmount(arc, progress) + phraseBreath) * span + roleAccent(trackId, note, beatsPerBar)
    return { ...note, velocity: Math.round(clamp(shapedVelocity, minimum, maximum)) }
  })
}

/**
 * Arrangement Generatorが決めたPitchと役割を変更せず、Sectionの起伏に沿う演奏表情を適用する。
 * 結果ノート自体を更新するため、PreviewとMIDI Exportの双方へ同じ表情が届く。
 */
export function applyArrangementPerformanceDirector(
  project: ComposerProject,
  plan: ArrangementPlan,
  sourceTracks: GeneratedArrangementTrack[],
): GeneratedArrangementTrack[] {
  const { beatsPerBar } = parseTimeSignature(project.song.timeSignature)
  const material = buildSongPlaybackMaterial(project)
  const totalBeats = Math.max(material.totalBeats, plan.sections.reduce((maximum, sectionPlan) => {
    const section = project.sections.find((candidate) => candidate.id === sectionPlan.sectionId)
    return section ? Math.max(maximum, (section.startBar - 1 + section.lengthBars) * beatsPerBar) : maximum
  }, 0))
  const chordBoundaryBeats = project.chords.flatMap((chord) => {
    const section = project.sections.find((candidate) => candidate.id === chord.sectionId)
    if (!section) return []
    return [(section.startBar - 1) * beatsPerBar + chord.startBeat]
  })

  return sourceTracks.map((track) => {
    const untouched = track.notes.filter((note) => !plan.sections.some((section) => section.sectionId === note.sectionId))
    const performed: GeneratedArrangementNote[] = []
    const sectionPlans: NonNullable<GeneratedArrangementTrack["performance"]>["sectionPlans"] = []
    for (const sectionPlan of plan.sections) {
      const sourceSectionNotes = track.notes.filter((note) => note.sectionId === sectionPlan.sectionId)
      if (sourceSectionNotes.length === 0) continue
      const sourceSection = project.sections.find((section) => section.id === sectionPlan.sectionId)
      if (!sourceSection) {
        performed.push(...sourceSectionNotes)
        continue
      }
      const performancePlan = buildArrangementPerformancePlan(track.id, sectionPlan)
      const execution = applyPerformanceExecution(sourceSectionNotes, performancePlan, {
        totalBeats,
        beatsPerBar,
        chordBoundaryBeats,
        melodyNotes: material.lead,
      })
      const sourceById = new Map(sourceSectionNotes.map((note) => [note.id, note]))
      const enriched = execution.notes.map((note) => ({ ...sourceById.get(note.id)!, ...note }))
      const sectionStart = (sourceSection.startBar - 1) * beatsPerBar
      const shaped = applyArc(
        enriched,
        track.id,
        sectionStart,
        sourceSection.lengthBars * beatsPerBar,
        performancePlan.arc,
        performancePlan.velocityRange,
        beatsPerBar,
      )
      performed.push(...shaped)
      const diagnostics = {
        ...execution.diagnostics,
        changedVelocityCount: shaped.filter((note) => note.velocity !== sourceById.get(note.id)?.velocity).length,
        changedDurationCount: shaped.filter((note) => note.durationBeats !== sourceById.get(note.id)?.durationBeats).length,
        changedOnsetCount: shaped.filter((note) => note.startBeat !== sourceById.get(note.id)?.startBeat).length,
      }
      sectionPlans.push({
        sectionId: sectionPlan.sectionId,
        ...performancePlan,
        diagnostics,
      })
    }
    const changedVelocityCount = sectionPlans.reduce((sum, section) => sum + section.diagnostics.changedVelocityCount, 0)
    const changedDurationCount = sectionPlans.reduce((sum, section) => sum + section.diagnostics.changedDurationCount, 0)
    const changedOnsetCount = sectionPlans.reduce((sum, section) => sum + section.diagnostics.changedOnsetCount, 0)
    return {
      ...track,
      notes: [...untouched, ...performed].sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch),
      performance: {
        version: "1.0.0",
        applied: sectionPlans.length > 0,
        changedVelocityCount,
        changedDurationCount,
        changedOnsetCount,
        sectionPlans,
      },
    }
  })
}
