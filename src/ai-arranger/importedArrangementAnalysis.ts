import type {
  ComposerProject,
  ImportedArrangementNote,
  ImportedArrangementTrackRole,
} from "@/core/project"
import { parseTimeSignature } from "@/core/section"

export interface ImportedRoleAnalysis {
  role: Exclude<ImportedArrangementTrackRole, "ignore">
  trackNames: string[]
  trackCount: number
  noteCount: number
  pitchRange: { lowest: number; highest: number } | null
  averagePitch: number | null
  averageVelocity: number
  notesPerBar: number
  activeBeatRatio: number
}

export interface ImportedArrangementSectionAnalysis {
  sourceKind: "logic-project" | "external-song"
  sectionId: string
  sectionName: string
  totalBars: number
  totalNotes: number
  activeRoles: Array<Exclude<ImportedArrangementTrackRole, "ignore">>
  textureDensity: "sparse" | "balanced" | "dense"
  silenceRatio: number
  maximumSimultaneousAttacks: number
  melodyCollisionCount: number
  roles: ImportedRoleAnalysis[]
  observations: string[]
}

interface WindowedNote {
  startBeat: number
  durationBeats: number
  pitch: number
  velocity: number
  channel: number
  role: Exclude<ImportedArrangementTrackRole, "ignore">
  trackName: string
}

function overlaps(note: ImportedArrangementNote, startBeat: number, endBeat: number): boolean {
  return note[0] < endBeat && note[0] + note[1] > startBeat
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

function roleAnalysis(
  role: Exclude<ImportedArrangementTrackRole, "ignore">,
  notes: WindowedNote[],
  totalBars: number,
  totalBeats: number,
): ImportedRoleAnalysis {
  const roleNotes = notes.filter((note) => note.role === role)
  const pitched = role === "drums" ? [] : roleNotes
  const activeBins = new Set(roleNotes.flatMap((note) => {
    const start = Math.max(0, Math.floor(note.startBeat * 2))
    const end = Math.max(start + 1, Math.ceil((note.startBeat + note.durationBeats) * 2))
    return Array.from({ length: Math.min(512, end - start) }, (_, index) => start + index)
  }))
  return {
    role,
    trackNames: [...new Set(roleNotes.map((note) => note.trackName))],
    trackCount: new Set(roleNotes.map((note) => note.trackName)).size,
    noteCount: roleNotes.length,
    pitchRange: pitched.length > 0
      ? {
          lowest: Math.min(...pitched.map((note) => note.pitch)),
          highest: Math.max(...pitched.map((note) => note.pitch)),
        }
      : null,
    averagePitch: pitched.length > 0
      ? round(pitched.reduce((sum, note) => sum + note.pitch, 0) / pitched.length, 1)
      : null,
    averageVelocity: roleNotes.length > 0
      ? round(roleNotes.reduce((sum, note) => sum + note.velocity, 0) / roleNotes.length, 1)
      : 0,
    notesPerBar: round(roleNotes.length / Math.max(1, totalBars)),
    activeBeatRatio: round(Math.min(1, activeBins.size / Math.max(1, totalBeats * 2))),
  }
}

function melodyCollisions(notes: WindowedNote[]): number {
  const melody = notes.filter((note) => note.role === "melody")
  const supporting = notes.filter((note) => note.role !== "melody" && note.role !== "drums")
  let count = 0
  for (const lead of melody) {
    for (const support of supporting) {
      const overlap = Math.min(
        lead.startBeat + lead.durationBeats,
        support.startBeat + support.durationBeats,
      ) - Math.max(lead.startBeat, support.startBeat)
      if (overlap > 0.08 && Math.abs(lead.pitch - support.pitch) <= 1) count += 1
    }
  }
  return count
}

export function analyzeImportedArrangementSection(
  project: ComposerProject,
  sectionId: string,
): ImportedArrangementSectionAnalysis | null {
  const material = project.importedArrangement
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  if (!material || !section) return null
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const startBeat = (section.startBar - 1) * beatsPerBar
  const totalBeats = section.lengthBars * beatsPerBar
  const endBeat = startBeat + totalBeats
  const notes: WindowedNote[] = material.tracks.flatMap((track) =>
    track.notes.filter((note) => overlaps(note, startBeat, endBeat)).map((note) => ({
      startBeat: Math.max(0, note[0] - startBeat),
      durationBeats: Math.min(endBeat, note[0] + note[1]) - Math.max(startBeat, note[0]),
      pitch: note[2],
      velocity: note[3],
      channel: note[4],
      role: track.role,
      trackName: track.name,
    })),
  )
  const activeRoles = [...new Set(notes.map((note) => note.role))]
  const roles = activeRoles.map((role) => roleAnalysis(
    role,
    notes,
    section.lengthBars,
    totalBeats,
  ))
  const notesPerBeat = notes.length / Math.max(1, totalBeats)
  const textureDensity = notesPerBeat < 0.8 ? "sparse" : notesPerBeat < 2.4 ? "balanced" : "dense"
  const occupiedBins = new Set(notes.flatMap((note) => {
    const start = Math.max(0, Math.floor(note.startBeat * 4))
    const end = Math.max(start + 1, Math.ceil((note.startBeat + note.durationBeats) * 4))
    return Array.from({ length: Math.min(1024, end - start) }, (_, index) => start + index)
  }))
  const onsetCounts = new Map<number, number>()
  for (const note of notes) {
    const key = Math.round(note.startBeat * 16)
    onsetCounts.set(key, (onsetCounts.get(key) ?? 0) + 1)
  }
  const collisions = melodyCollisions(notes)
  const silenceRatio = round(Math.max(0, 1 - occupiedBins.size / Math.max(1, totalBeats * 4)))
  const observations: string[] = []
  if (!activeRoles.includes("melody")) observations.push("主旋律トラックが未指定です。コードと各パートの配置を中心に解析します。")
  if (textureDensity === "dense") observations.push("ノート密度が高く、パート追加より役割整理と休止の設計が優先です。")
  if (silenceRatio >= 0.35) observations.push("明確な余白があり、残響・応答・登退場を設計できる空間があります。")
  if (collisions > 0) observations.push(`主旋律と補助パートに半音以内の重なりが${collisions}件あります。`)
  if (activeRoles.includes("bass") && activeRoles.includes("drums")) observations.push("BassとDrumsの独立した役割を解析できます。")
  return {
    sourceKind: material.sourceKind,
    sectionId,
    sectionName: section.name,
    totalBars: section.lengthBars,
    totalNotes: notes.length,
    activeRoles,
    textureDensity,
    silenceRatio,
    maximumSimultaneousAttacks: Math.max(0, ...onsetCounts.values()),
    melodyCollisionCount: collisions,
    roles,
    observations,
  }
}

export function importedRolesInSection(
  project: ComposerProject,
  sectionId: string,
): Set<Exclude<ImportedArrangementTrackRole, "ignore">> {
  return new Set(analyzeImportedArrangementSection(project, sectionId)?.activeRoles ?? [])
}
