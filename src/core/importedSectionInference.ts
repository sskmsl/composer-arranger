import type { MelodyNote, MelodyVariant } from "./melody"
import type { ChordEvent, ComposerProject, ImportedArrangementNote } from "./project"
import { parseTimeSignature, type SectionRole } from "./section"
import { DEFAULT_SECTION_CONTENT } from "./sectionContent"

interface BarFeature {
  onsetCount: number
  melodyOnsetCount: number
  occupiedTrackCount: number
  activeRoles: Set<string>
  pitchClasses: number[]
}

interface InferredWindow {
  startBar: number
  endBar: number
  density: number
  melodyDensity: number
  role: SectionRole
  name: string
}

export interface ImportedSectionInferenceResult {
  project: ComposerProject
  changed: boolean
  confidence: number
  boundaries: number[]
}

function normalizedTrackName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

function repairLegacySplitMelody(project: ComposerProject): { project: ComposerProject; changed: boolean } {
  if (project.sourceImport?.type !== "midi" || project.sourceImport.melodyTracksMerged) {
    return { project, changed: false }
  }
  const arrangement = project.importedArrangement
  const sourceName = normalizedTrackName(project.sourceImport.melodyTrackName)
  const melodyTracks = arrangement?.tracks.filter((track) =>
    track.notes.length > 0
    && (track.role === "melody" || (sourceName.length > 0 && normalizedTrackName(track.name) === sourceName)),
  ) ?? []
  if (melodyTracks.length === 0) {
    return {
      changed: true,
      project: {
        ...project,
        sourceImport: { ...project.sourceImport, melodyTracksMerged: true },
      },
    }
  }

  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const seen = new Set<string>()
  const sourceNotes = melodyTracks.flatMap((track) => track.notes).filter((note) => {
    const key = note.join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((left, right) => left[0] - right[0] || left[2] - right[2])
  const template = project.melodyVariants.find((variant) => variant.sourceMode === "import-midi")
  if (!template) {
    return {
      changed: true,
      project: {
        ...project,
        importedArrangement: arrangement ? {
          ...arrangement,
          tracks: arrangement.tracks.map((track) => melodyTracks.includes(track) ? { ...track, role: "melody" } : track),
        } : arrangement,
        sourceImport: { ...project.sourceImport, melodyTracksMerged: true },
      },
    }
  }

  const importedVariants: MelodyVariant[] = []
  const assignments = { ...project.sectionMelodyAssignments }
  project.sections.forEach((section, sectionIndex) => {
    const sectionStart = (section.startBar - 1) * beatsPerBar
    const sectionEnd = sectionStart + section.lengthBars * beatsPerBar
    const notes: MelodyNote[] = sourceNotes.flatMap((note, noteIndex) => {
      if (note[0] < sectionStart || note[0] >= sectionEnd) return []
      return [{
        id: `merged-import-note:${project.projectId}:${sectionIndex + 1}:${noteIndex + 1}`,
        startBeat: note[0] - sectionStart,
        durationBeats: note[1],
        pitch: note[2],
        velocity: note[3],
        locks: [],
      }]
    })
    if (notes.length === 0) {
      delete assignments[section.id]
      return
    }
    const variant: MelodyVariant = {
      ...template,
      id: `merged-import-variant:${project.projectId}:${sectionIndex + 1}`,
      name: `${section.name} · ${project.sourceImport!.melodyTrackName}`,
      sectionId: section.id,
      notes,
      layers: undefined,
      phrasePlans: [],
      batchId: `merged-import:${project.projectId}`,
      parentMelodyId: null,
    }
    importedVariants.push(variant)
    assignments[section.id] = variant.id
  })
  const generatedVariants = project.melodyVariants.filter((variant) => variant.sourceMode !== "import-midi")
  const warning = `旧Importを修復し、同名の分割Melodyトラック${melodyTracks.length}本を原曲の1本として復元しました。`
  return {
    changed: true,
    project: {
      ...project,
      melodyVariants: [...generatedVariants, ...importedVariants],
      sectionMelodyAssignments: assignments,
      activeMelodyId: importedVariants[0]?.id ?? project.activeMelodyId,
      importedArrangement: arrangement ? {
        ...arrangement,
        tracks: arrangement.tracks.map((track) => melodyTracks.includes(track) ? { ...track, role: "melody" } : track),
      } : arrangement,
      sourceImport: {
        ...project.sourceImport,
        melodyTracksMerged: true,
        warnings: [...project.sourceImport.warnings.filter((item) => !item.includes("旧Importを修復")), warning],
      },
    },
  }
}

function overlaps(note: ImportedArrangementNote, startBeat: number, endBeat: number): boolean {
  return note[0] < endBeat && note[0] + note[1] > startBeat
}

function cosineDistance(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0)
  const leftLength = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0))
  const rightLength = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0))
  if (leftLength === 0 && rightLength === 0) return 0
  if (leftLength === 0 || rightLength === 0) return 1
  return 1 - dot / leftLength / rightLength
}

function barFeatures(project: ComposerProject, totalBars: number, beatsPerBar: number): BarFeature[] {
  const tracks = project.importedArrangement?.tracks ?? []
  return Array.from({ length: totalBars }, (_, bar) => {
    const start = bar * beatsPerBar
    const end = start + beatsPerBar
    const activeTracks = new Set<number>()
    const activeRoles = new Set<string>()
    const pitchClasses = Array.from({ length: 12 }, () => 0)
    let onsetCount = 0
    let melodyOnsetCount = 0
    tracks.forEach((track, trackIndex) => {
      track.notes.forEach((note) => {
        if (!overlaps(note, start, end)) return
        activeTracks.add(trackIndex)
        activeRoles.add(track.role)
        if (note[0] >= start && note[0] < end) {
          onsetCount += 1
          if (track.role === "melody") melodyOnsetCount += 1
        }
        if (track.role !== "drums") pitchClasses[((note[2] % 12) + 12) % 12] += Math.min(note[1], beatsPerBar)
      })
    })
    return { onsetCount, melodyOnsetCount, occupiedTrackCount: activeTracks.size, activeRoles, pitchClasses }
  })
}

function boundaryScore(features: BarFeature[], bar: number): number {
  const previous = features[bar - 1]
  const current = features[bar]
  if (!previous || !current) return 0
  const roleUnion = new Set([...previous.activeRoles, ...current.activeRoles])
  const sharedRoles = [...previous.activeRoles].filter((role) => current.activeRoles.has(role)).length
  const roleChange = roleUnion.size > 0 ? 1 - sharedRoles / roleUnion.size : 0
  const densityScale = Math.max(1, previous.onsetCount, current.onsetCount)
  const onsetChange = Math.abs(current.onsetCount - previous.onsetCount) / densityScale
  const trackScale = Math.max(1, previous.occupiedTrackCount, current.occupiedTrackCount)
  const trackChange = Math.abs(current.occupiedTrackCount - previous.occupiedTrackCount) / trackScale
  const harmonicChange = cosineDistance(previous.pitchClasses, current.pitchClasses)
  const silenceChange = previous.onsetCount === 0 || current.onsetCount === 0 ? 0.18 : 0
  const metricPrior = bar % 8 === 0 ? 0.22 : bar % 4 === 0 ? 0.12 : 0
  return roleChange * 0.2 + onsetChange * 0.23 + trackChange * 0.2 + harmonicChange * 0.17 + silenceChange + metricPrior
}

function inferBoundaries(features: BarFeature[], totalBars: number): { boundaries: number[]; confidence: number } {
  const boundaries = [0]
  const selectedScores: number[] = []
  let start = 0
  while (totalBars - start > 12) {
    const minimum = start + 4
    const maximum = Math.min(totalBars - 4, start + 12)
    if (minimum > maximum) break
    let bestBar = Math.min(start + 8, maximum)
    let bestScore = -Infinity
    for (let bar = minimum; bar <= maximum; bar += 1) {
      const distanceFromEight = Math.abs(bar - (start + 8))
      const score = boundaryScore(features, bar) - distanceFromEight * 0.025
      if (score > bestScore) {
        bestScore = score
        bestBar = bar
      }
    }
    boundaries.push(bestBar)
    selectedScores.push(Math.max(0, bestScore))
    start = bestBar
  }
  const lastLength = totalBars - boundaries[boundaries.length - 1]
  if (lastLength > 16) boundaries.push(totalBars - 8)
  const averageScore = selectedScores.length > 0
    ? selectedScores.reduce((sum, score) => sum + score, 0) / selectedScores.length
    : 0
  return {
    boundaries: [...new Set(boundaries)].sort((left, right) => left - right),
    confidence: Number(Math.max(0.5, Math.min(0.88, 0.5 + averageScore * 0.32)).toFixed(2)),
  }
}

function nameWindows(features: BarFeature[], boundaries: number[], totalBars: number): InferredWindow[] {
  const raw = boundaries.map((start, index) => {
    const end = boundaries[index + 1] ?? totalBars
    const bars = features.slice(start, end)
    return {
      startBar: start + 1,
      endBar: end,
      density: bars.reduce((sum, bar) => sum + bar.onsetCount, 0) / Math.max(1, end - start),
      melodyDensity: bars.reduce((sum, bar) => sum + bar.melodyOnsetCount, 0) / Math.max(1, end - start),
      role: "instrumental" as SectionRole,
      name: "",
    }
  })
  const melodicWindows = raw.filter((window) => window.melodyDensity > 0)
  const densities = melodicWindows.map((window) => window.melodyDensity).sort((left, right) => left - right)
  const highDensity = densities[Math.max(0, Math.floor(densities.length * 0.7))] ?? 0
  const firstVerseIndex = (() => {
    const afterMelodyRest = raw.findIndex((window, index) =>
      index > 0 &&
      index < raw.length - 1 &&
      window.melodyDensity > 0 &&
      raw.slice(1, index).some((previous) => previous.melodyDensity === 0),
    )
    if (afterMelodyRest >= 0) return afterMelodyRest
    const firstAfterIntro = raw.findIndex((window, index) => index > 0 && window.melodyDensity > 0)
    return firstAfterIntro >= 0 ? firstAfterIntro : 1
  })()
  raw.forEach((window, index) => {
    if (index === 0) window.role = "intro"
    else if (index === raw.length - 1) window.role = "outro"
    else if (window.melodyDensity === 0) window.role = "instrumental"
    else if (index < firstVerseIndex) window.role = "intro"
    else if (index === firstVerseIndex) window.role = "verse"
    else if (window.melodyDensity >= highDensity) window.role = "chorus"
    else window.role = "verse"
  })
  raw.forEach((window, index) => {
    if (
      window.role === "chorus" &&
      index > firstVerseIndex + 1 &&
      raw[index - 1].role === "verse" &&
      raw[index - 2].role === "verse"
    ) raw[index - 1].role = "pre-chorus"
  })
  const counts = new Map<SectionRole, number>()
  const labels: Partial<Record<SectionRole, string>> = {
    intro: "推定イントロ",
    verse: "推定Aメロ",
    "pre-chorus": "推定Bメロ",
    chorus: "推定サビ",
    outro: "推定アウトロ",
    instrumental: "推定間奏",
  }
  raw.forEach((window) => {
    const count = (counts.get(window.role) ?? 0) + 1
    counts.set(window.role, count)
    window.name = `${labels[window.role] ?? "推定Section"}${count > 1 ? ` ${count}` : ""}`
  })
  return raw
}

function repairLegacyInferredRoles(project: ComposerProject): { project: ComposerProject; changed: boolean } {
  if (
    project.sourceImport?.type !== "midi" ||
    !project.sourceImport.sectionsInferred ||
    (project.sourceImport.sectionInferenceVersion ?? 0) >= 2 ||
    !project.importedArrangement
  ) return { project, changed: false }
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const totalBars = Math.max(1, Math.ceil(project.importedArrangement.totalBeats / beatsPerBar))
  const sorted = [...project.sections].sort((left, right) => left.startBar - right.startBar)
  const windows = nameWindows(
    barFeatures(project, totalBars, beatsPerBar),
    sorted.map((section) => Math.max(0, section.startBar - 1)),
    totalBars,
  )
  const replacement = new Map(sorted.map((section, index) => [section.id, windows[index]]))
  return {
    changed: true,
    project: {
      ...project,
      sections: project.sections.map((section) => {
        const inferred = replacement.get(section.id)
        if (!inferred || !section.name.startsWith("推定")) return section
        return { ...section, name: inferred.name, role: inferred.role }
      }),
      sourceImport: { ...project.sourceImport, sectionInferenceVersion: 2 },
    },
  }
}

function canInfer(project: ComposerProject): boolean {
  if (project.sourceImport?.type !== "midi" || project.sourceImport.sectionsFromMarkers) return false
  if (project.sourceImport.sectionsInferred || project.sections.length !== 1) return false
  if (!project.importedArrangement || project.importedArrangement.totalBeats <= 0) return false
  if (project.melodyVariants.some((variant) => variant.sourceMode !== "import-midi")) return false
  if (project.phraseCandidates.length > 0 || project.signaturePhraseCandidates.length > 0) return false
  if ((project.reactiveLayerCandidates?.length ?? 0) > 0) return false
  if (Object.keys(project.sectionAccompanimentPatternAssignments).length > 0) return false
  return true
}

/** マーカーなしの既存・新規MIDI Projectを、推定したSectionへ非破壊的に再配置する。 */
export function inferMarkerlessImportedSections(project: ComposerProject): ImportedSectionInferenceResult {
  const repaired = repairLegacySplitMelody(project)
  const roleRepair = repairLegacyInferredRoles(repaired.project)
  const workingProject = roleRepair.project
  const repairedExisting = repaired.changed || roleRepair.changed
  if (!canInfer(workingProject)) return { project: workingProject, changed: repairedExisting, confidence: 0, boundaries: [] }
  const beatsPerBar = parseTimeSignature(workingProject.song.timeSignature).beatsPerBar
  const totalBars = Math.max(1, Math.ceil(workingProject.importedArrangement!.totalBeats / beatsPerBar))
  if (totalBars < 12) return { project: workingProject, changed: repairedExisting, confidence: 0, boundaries: [] }
  const features = barFeatures(workingProject, totalBars, beatsPerBar)
  const inferred = inferBoundaries(features, totalBars)
  if (inferred.boundaries.length < 2) {
    return {
      project: workingProject,
      changed: repairedExisting,
      confidence: inferred.confidence,
      boundaries: [],
    }
  }
  const windows = nameWindows(features, inferred.boundaries, totalBars)
  const originalSectionId = workingProject.sections[0].id
  const sourceVariants = workingProject.melodyVariants.filter((variant) => variant.sectionId === originalSectionId)
  const sections = windows.map((window, index) => ({
    id: `inferred:${workingProject.projectId}:${index + 1}`,
    name: window.name,
    role: window.role,
    startBar: window.startBar,
    lengthBars: window.endBar - window.startBar + 1,
    content: { ...DEFAULT_SECTION_CONTENT },
  }))
  const chords: ChordEvent[] = windows.flatMap((window, windowIndex) => {
    const startBeat = (window.startBar - 1) * beatsPerBar
    const endBeat = window.endBar * beatsPerBar
    return workingProject.chords.filter((chord) => chord.sectionId === originalSectionId).flatMap((chord, chordIndex) => {
      const start = Math.max(startBeat, chord.startBeat)
      const end = Math.min(endBeat, chord.startBeat + chord.durationBeats)
      if (end <= start) return []
      return [{ ...chord, id: `inferred-chord:${windowIndex}:${chordIndex}`, sectionId: sections[windowIndex].id, startBeat: start - startBeat, durationBeats: end - start }]
    })
  })
  const melodyVariants: MelodyVariant[] = []
  const sectionMelodyAssignments: Record<string, string> = {}
  windows.forEach((window, windowIndex) => {
    const startBeat = (window.startBar - 1) * beatsPerBar
    const endBeat = window.endBar * beatsPerBar
    sourceVariants.forEach((variant, variantIndex) => {
      const notes = variant.notes.flatMap((note, noteIndex) => {
        if (note.startBeat < startBeat || note.startBeat >= endBeat) return []
        return [{
          ...note,
          id: `inferred-note:${windowIndex}:${variantIndex}:${noteIndex}`,
          startBeat: note.startBeat - startBeat,
        }]
      })
      if (notes.length === 0) return
      const next: MelodyVariant = {
        ...variant,
        id: `inferred-variant:${workingProject.projectId}:${windowIndex + 1}:${variantIndex + 1}`,
        name: `${sections[windowIndex].name} · ${workingProject.sourceImport!.melodyTrackName}`,
        sectionId: sections[windowIndex].id,
        notes,
        layers: undefined,
        phrasePlans: [],
        batchId: `inferred-import:${workingProject.projectId}`,
      }
      melodyVariants.push(next)
      sectionMelodyAssignments[next.sectionId] ??= next.id
    })
  })
  const warning = `Section境界を小節ごとの密度・発音トラック・休止・反復変化から${sections.length}区間へ自動推定しました（信頼度${Math.round(inferred.confidence * 100)}%）。`
  const warnings = workingProject.sourceImport!.warnings.filter((item) => !item.includes("1セクション"))
  return {
    changed: true,
    confidence: inferred.confidence,
    boundaries: inferred.boundaries.map((bar) => bar + 1),
    project: {
      ...workingProject,
      sections,
      chords,
      melodyVariants,
      sectionMelodyAssignments,
      activeMelodyId: melodyVariants[0]?.id ?? null,
      sourceImport: {
        ...workingProject.sourceImport!,
        sectionsInferred: true,
        sectionInferenceConfidence: inferred.confidence,
        sectionInferenceVersion: 2,
        warnings: [...warnings, warning],
      },
    },
  }
}
