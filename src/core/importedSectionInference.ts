import type { MelodyNote, MelodyVariant } from "./melody"
import type { ChordEvent, ComposerProject, ImportedArrangementNote } from "./project"
import { parseTimeSignature, type SectionRole } from "./section"
import { DEFAULT_SECTION_CONTENT } from "./sectionContent"

interface BarFeature {
  onsetCount: number
  occupiedTrackCount: number
  activeRoles: Set<string>
  pitchClasses: number[]
}

interface InferredWindow {
  startBar: number
  endBar: number
  density: number
  role: SectionRole
  name: string
}

export interface ImportedSectionInferenceResult {
  project: ComposerProject
  changed: boolean
  confidence: number
  boundaries: number[]
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
    tracks.forEach((track, trackIndex) => {
      track.notes.forEach((note) => {
        if (!overlaps(note, start, end)) return
        activeTracks.add(trackIndex)
        activeRoles.add(track.role)
        if (note[0] >= start && note[0] < end) onsetCount += 1
        if (track.role !== "drums") pitchClasses[((note[2] % 12) + 12) % 12] += Math.min(note[1], beatsPerBar)
      })
    })
    return { onsetCount, occupiedTrackCount: activeTracks.size, activeRoles, pitchClasses }
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
      role: "instrumental" as SectionRole,
      name: "",
    }
  })
  const densities = raw.map((window) => window.density).sort((left, right) => left - right)
  const highDensity = densities[Math.max(0, Math.floor(densities.length * 0.7))] ?? 0
  raw.forEach((window, index) => {
    if (index === 0) window.role = "intro"
    else if (index === raw.length - 1) window.role = "outro"
    else if (window.density >= highDensity) window.role = "chorus"
    else window.role = "verse"
  })
  raw.forEach((window, index) => {
    if (window.role === "chorus" && index > 1 && raw[index - 1].role === "verse") raw[index - 1].role = "pre-chorus"
  })
  const counts = new Map<SectionRole, number>()
  const labels: Partial<Record<SectionRole, string>> = {
    intro: "推定イントロ",
    verse: "推定Aメロ",
    "pre-chorus": "推定Bメロ",
    chorus: "推定サビ",
    outro: "推定アウトロ",
    instrumental: "推定Section",
  }
  raw.forEach((window) => {
    const count = (counts.get(window.role) ?? 0) + 1
    counts.set(window.role, count)
    window.name = `${labels[window.role] ?? "推定Section"}${count > 1 ? ` ${count}` : ""}`
  })
  return raw
}

function clippedNote(note: MelodyNote, startBeat: number, endBeat: number, id: string): MelodyNote | null {
  const start = Math.max(startBeat, note.startBeat)
  const end = Math.min(endBeat, note.startBeat + note.durationBeats)
  if (end <= start) return null
  return { ...note, id, startBeat: start - startBeat, durationBeats: end - start }
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
  if (!canInfer(project)) return { project, changed: false, confidence: 0, boundaries: [] }
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const totalBars = Math.max(1, Math.ceil(project.importedArrangement!.totalBeats / beatsPerBar))
  if (totalBars < 12) return { project, changed: false, confidence: 0, boundaries: [] }
  const features = barFeatures(project, totalBars, beatsPerBar)
  const inferred = inferBoundaries(features, totalBars)
  if (inferred.boundaries.length < 2) return { project, changed: false, confidence: inferred.confidence, boundaries: [] }
  const windows = nameWindows(features, inferred.boundaries, totalBars)
  const originalSectionId = project.sections[0].id
  const sourceVariants = project.melodyVariants.filter((variant) => variant.sectionId === originalSectionId)
  const sections = windows.map((window, index) => ({
    id: `inferred:${project.projectId}:${index + 1}`,
    name: window.name,
    role: window.role,
    startBar: window.startBar,
    lengthBars: window.endBar - window.startBar + 1,
    content: { ...DEFAULT_SECTION_CONTENT },
  }))
  const chords: ChordEvent[] = windows.flatMap((window, windowIndex) => {
    const startBeat = (window.startBar - 1) * beatsPerBar
    const endBeat = window.endBar * beatsPerBar
    return project.chords.filter((chord) => chord.sectionId === originalSectionId).flatMap((chord, chordIndex) => {
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
        const clipped = clippedNote(note, startBeat, endBeat, `inferred-note:${windowIndex}:${variantIndex}:${noteIndex}`)
        return clipped ? [clipped] : []
      })
      if (notes.length === 0) return
      const next: MelodyVariant = {
        ...variant,
        id: `inferred-variant:${project.projectId}:${windowIndex + 1}:${variantIndex + 1}`,
        name: `${sections[windowIndex].name} · ${project.sourceImport!.melodyTrackName}`,
        sectionId: sections[windowIndex].id,
        notes,
        layers: undefined,
        phrasePlans: [],
        batchId: `inferred-import:${project.projectId}`,
      }
      melodyVariants.push(next)
      sectionMelodyAssignments[next.sectionId] ??= next.id
    })
  })
  const warning = `Section境界を小節ごとの密度・発音トラック・休止・反復変化から${sections.length}区間へ自動推定しました（信頼度${Math.round(inferred.confidence * 100)}%）。`
  const warnings = project.sourceImport!.warnings.filter((item) => !item.includes("1セクション"))
  return {
    changed: true,
    confidence: inferred.confidence,
    boundaries: inferred.boundaries.map((bar) => bar + 1),
    project: {
      ...project,
      sections,
      chords,
      melodyVariants,
      sectionMelodyAssignments,
      activeMelodyId: melodyVariants[0]?.id ?? null,
      sourceImport: {
        ...project.sourceImport!,
        sectionsInferred: true,
        sectionInferenceConfidence: inferred.confidence,
        warnings: [...warnings, warning],
      },
    },
  }
}
