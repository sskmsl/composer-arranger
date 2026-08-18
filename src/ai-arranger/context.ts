import { resolvePublicComposerRules } from "@/composer-intelligence"
import type { ComposerGeneratorTarget } from "@/composer-intelligence"
import { computeMelodyFeatures } from "@/melody-engine/features"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { effectiveSongProfile, type ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import type { AiArrangementContext } from "./types"

const MAX_MELODY_NOTES = 160

function techniquePreferences(
  project: ComposerProject,
  sectionId: string,
): Record<string, string[]> {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return {}
  const targets: ComposerGeneratorTarget[] = [
    "melody",
    "phrase",
    "counter",
    "decoration",
  ]
  const result: Record<string, string[]> = {}
  for (const target of targets) {
    const resolved = resolvePublicComposerRules({
      generatorTarget: target,
      sectionRole: section.role,
    })
    const values = Object.values(resolved.preferences)
      .flatMap((preference) =>
        (preference?.values ?? []).slice(0, 2).map((value) => value.value),
      )
    result[target] = [...new Set(values)].slice(0, 8)
  }
  return result
}

export function buildAiArrangementContext(
  project: ComposerProject,
  sectionId: string,
): AiArrangementContext | null {
  const timeline = normalizeSectionTimeline(project.sections)
  const sectionIndex = timeline.findIndex((candidate) => candidate.id === sectionId)
  const section = timeline[sectionIndex]
  if (!section) return null

  const activeMelodyId = project.sectionMelodyAssignments[sectionId]
  const activeMelody = project.melodyVariants.find(
    (candidate) =>
      candidate.id === activeMelodyId && candidate.sectionId === sectionId,
  )
  const notes = [...(activeMelody?.notes ?? [])]
    .sort((left, right) => left.startBeat - right.startBeat)
    .slice(0, MAX_MELODY_NOTES)
  const reactiveAssignment = project.sectionReactiveLayerAssignments?.[sectionId]
  const decorationAssignment = project.sectionDecorationLayerAssignments?.[sectionId]
  const chords = project.chords
    .filter((chord) => chord.sectionId === sectionId)
    .sort((left, right) => left.startBeat - right.startBeat)
  const totalBeats =
    section.lengthBars * parseTimeSignature(project.song.timeSignature).beatsPerBar

  return {
    project: {
      title: project.title,
      key: project.song.key,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      songProfile: effectiveSongProfile(project, sectionId),
    },
    section: {
      id: section.id,
      name: section.name,
      role: section.role,
      lengthBars: section.lengthBars,
      previousRole: timeline[sectionIndex - 1]?.role ?? null,
      nextRole: timeline[sectionIndex + 1]?.role ?? null,
    },
    chords: chords.map((chord) => ({
        startBeat: chord.startBeat,
        durationBeats: chord.durationBeats,
        symbol: chord.symbol,
        bass: chord.bass,
      })),
    activeMelody: {
      present: notes.length > 0,
      noteCount: activeMelody?.notes.length ?? 0,
      notes: notes.map((note) => ({
        startBeat: note.startBeat,
        durationBeats: note.durationBeats,
        pitch: note.pitch,
        velocity: note.velocity,
      })),
      features:
        notes.length > 0
          ? computeMelodyFeatures(notes, buildHarmonicMap(chords), 0, totalBeats)
          : null,
    },
    arrangement: {
      settings: { ...project.arrangementSettings },
      accompanimentPatternAssigned: Boolean(
        project.sectionAccompanimentPatternAssignments[sectionId],
      ),
      counterAssigned: Boolean(reactiveAssignment),
      decorationAssigned: Boolean(decorationAssignment),
    },
    techniquePreferences: techniquePreferences(project, sectionId),
  }
}

export function aiContextFingerprint(
  prompt: string,
  context: AiArrangementContext,
): string {
  const source = JSON.stringify({ prompt: prompt.trim(), context })
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
