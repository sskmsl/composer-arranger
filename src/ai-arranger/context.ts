import { resolvePublicComposerRules } from "@/composer-intelligence"
import type { ComposerGeneratorTarget } from "@/composer-intelligence"
import { computeMelodyFeatures } from "@/melody-engine/features"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { effectiveSongProfile, type ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import type { AiArrangementContext } from "./types"
import { reviewAudibleLayerCollisions } from "./audibleLayerReview"
import { arrangementConstitutionContext } from "./arrangementConstitution"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import { reviewArrangementSection } from "./arrangementReview"
import { buildOrchestrationBlueprint } from "./orchestrationIntelligence"
import { reviewOrchestrationMasking } from "./orchestrationReview"
import { reviewWholeSongArrangement } from "./wholeSongArrangementReview"
import { analyzeImportedArrangementSection } from "./importedArrangementAnalysis"
import {
  identifyArrangementSurpriseOpportunities,
} from "@/core/arrangementSurprise"

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
  consultationScope: AiArrangementContext["consultationScope"] = "section",
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

  const arrangementDirector = buildArrangementDirectorBlueprint(project)
  const orchestration = buildOrchestrationBlueprint(project, arrangementDirector)
  const arrangementReviews = arrangementDirector.sections.map((plan) =>
    reviewArrangementSection(project, arrangementDirector, plan.sectionId),
  )
  const arrangementReview = arrangementReviews.find(
    (review) => review.sectionId === sectionId,
  ) ?? reviewArrangementSection(project, arrangementDirector, sectionId)
  const currentOrchestrationPlan = orchestration.sections.find(
    (plan) => plan.sectionId === sectionId,
  )
  const importedArrangement = analyzeImportedArrangementSection(project, sectionId)
  const existingSupportNoteCount = [reactiveAssignment, decorationAssignment]
    .filter((id): id is string => Boolean(id))
    .reduce(
      (sum, id) =>
        sum +
        (project.reactiveLayerCandidates?.find((candidate) => candidate.id === id)
          ?.notes.length ?? 0),
      0,
    )
  const nextSection = timeline[sectionIndex + 1]
  const nextSectionFirstChord = nextSection
    ? project.chords
        .filter((chord) => chord.sectionId === nextSection.id)
        .sort((left, right) => left.startBeat - right.startBeat)[0]?.symbol
    : undefined

  const songSections: AiArrangementContext["songSections"] = timeline.map(
    (songSection, order) => {
      const melodyId = project.sectionMelodyAssignments[songSection.id]
      const melody = project.melodyVariants.find(
        (candidate) => candidate.id === melodyId && candidate.sectionId === songSection.id,
      )
      const sectionNotes = melody?.notes ?? []
      const sectionPlan = arrangementDirector.sections.find(
        (candidate) => candidate.sectionId === songSection.id,
      )
      const activeLayers = [
        melodyId ? "melody" : null,
        project.sectionAccompanimentPatternAssignments[songSection.id]
          ? "accompaniment"
          : null,
        project.sectionReactiveLayerAssignments?.[songSection.id]
          ? "counter"
          : null,
        project.sectionDecorationLayerAssignments?.[songSection.id]
          ? "decoration"
          : null,
      ].filter((value): value is string => Boolean(value))
      return {
        id: songSection.id,
        name: songSection.name,
        role: songSection.role,
        order,
        lengthBars: songSection.lengthBars,
        chords: project.chords
          .filter((chord) => chord.sectionId === songSection.id)
          .sort((left, right) => left.startBeat - right.startBeat)
          .map((chord) => chord.symbol),
        activeMelody: {
          present: sectionNotes.length > 0,
          noteCount: sectionNotes.length,
          lowestPitch:
            sectionNotes.length > 0
              ? Math.min(...sectionNotes.map((note) => note.pitch))
              : null,
          highestPitch:
            sectionNotes.length > 0
              ? Math.max(...sectionNotes.map((note) => note.pitch))
              : null,
          onsetDensity:
            sectionNotes.length /
            Math.max(
              1,
              songSection.lengthBars * parseTimeSignature(project.song.timeSignature).beatsPerBar,
            ),
        },
        activeLayers,
        targetEnergy: sectionPlan?.targetEnergy ?? 1,
        climaxPolicy: sectionPlan?.climaxPolicy ?? "reserve",
        transitionIntent: sectionPlan?.transitionIntent ?? "次Sectionへ余白を残す",
      }
    },
  )

  return {
    consultationScope,
    arrangementConstitution: arrangementConstitutionContext(),
    arrangementDirector,
    arrangementReview,
    wholeSongArrangementReview: reviewWholeSongArrangement(
      project,
      arrangementDirector,
      arrangementReviews,
    ),
    orchestration,
    orchestrationReview: reviewOrchestrationMasking(currentOrchestrationPlan),
    audibleLayerReview: reviewAudibleLayerCollisions(project, sectionId),
    surpriseOpportunities: identifyArrangementSurpriseOpportunities({
      chords,
      melodyNotes: notes,
      totalBeats,
      sectionRole: section.role,
      nextSectionRole: nextSection?.role,
      nextSectionFirstChord,
      existingSupportNoteCount,
    }),
    project: {
      title: project.title,
      key: project.song.key,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      songProfile: effectiveSongProfile(project, sectionId),
      ...(project.arrangementDirectorWorkspace?.brief
        ? {
            arrangementIntent: {
              brief: project.arrangementDirectorWorkspace.brief,
              selectedDirectionId: project.arrangementDirectorWorkspace.selectedDirectionId,
            },
          }
        : {}),
      ...(project.sourceImport
        ? {
            sourceImport: {
              type: project.sourceImport.type,
              sourceKind: project.sourceImport.sourceKind ?? "external-song",
              fileName: project.sourceImport.fileName,
              melodyTrackName: project.sourceImport.melodyTrackName,
              melodyTrackConfidence: project.sourceImport.melodyTrackConfidence,
              chordInferenceConfidence: project.sourceImport.chordInferenceConfidence,
              ...(project.sourceImport.keyInferenceConfidence !== undefined
                ? { keyInferenceConfidence: project.sourceImport.keyInferenceConfidence }
                : {}),
              ...(project.sourceImport.keyInferenceSource
                ? { keyInferenceSource: project.sourceImport.keyInferenceSource }
                : {}),
              ...(project.sourceImport.keyAlternatives?.length
                ? { keyAlternatives: [...project.sourceImport.keyAlternatives] }
                : {}),
              sectionsFromMarkers: project.sourceImport.sectionsFromMarkers,
              reviewConfirmed: project.sourceImport.reviewConfirmed ?? false,
              warnings: [...project.sourceImport.warnings],
            },
          }
        : {}),
    },
    section: {
      id: section.id,
      name: section.name,
      role: section.role,
      lengthBars: section.lengthBars,
      previousRole: timeline[sectionIndex - 1]?.role ?? null,
      nextRole: timeline[sectionIndex + 1]?.role ?? null,
    },
    songSections,
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
      assignedAccompanimentPatternId:
        project.sectionAccompanimentPatternAssignments[sectionId] ?? null,
      availableAccompanimentPatterns: project.accompanimentPatterns.map(
        (pattern) => ({
          id: pattern.id,
          name: pattern.name,
          lengthBeats: pattern.lengthBeats,
          onsetBeats: [...new Set(pattern.events.map((event) => event.offsetBeats))],
          degreeSequence: pattern.events.map((event) => event.degree),
        }),
      ),
      counterAssigned: Boolean(reactiveAssignment),
      decorationAssigned: Boolean(decorationAssignment),
    },
    ...(importedArrangement
      ? {
          importedArrangement: {
            sourceKind: importedArrangement.sourceKind,
            totalNotes: importedArrangement.totalNotes,
            activeRoles: importedArrangement.activeRoles,
            textureDensity: importedArrangement.textureDensity,
            silenceRatio: importedArrangement.silenceRatio,
            maximumSimultaneousAttacks: importedArrangement.maximumSimultaneousAttacks,
            melodyCollisionCount: importedArrangement.melodyCollisionCount,
            roles: importedArrangement.roles.map((role) => ({
              role: role.role,
              trackNames: role.trackNames,
              noteCount: role.noteCount,
              pitchRange: role.pitchRange,
              averageVelocity: role.averageVelocity,
              notesPerBar: role.notesPerBar,
              activeBeatRatio: role.activeBeatRatio,
            })),
            observations: importedArrangement.observations,
          },
        }
      : {}),
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
