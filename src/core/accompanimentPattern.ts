import { parseChordSymbol, type ParsedChord } from "./chord"
import type { MelodyNote } from "./melody"
import type { ChordEvent, ComposerProject } from "./project"
import { parseTimeSignature } from "./section"

export type AccompanimentDegree = 1 | 3 | 5 | 7 | 9 | 11 | 13

export interface AccompanimentPatternEvent {
  offsetBeats: number
  durationBeats: number
  degree: AccompanimentDegree
  /** コードルートをC2付近へ置いた位置からのオクターブ移動量。 */
  octaveOffset: number
  velocity: number
}

export interface AccompanimentPatternTemplate {
  id: string
  name: string
  lengthBeats: number
  events: AccompanimentPatternEvent[]
}

export const DEFAULT_ACCOMPANIMENT_PATTERNS: AccompanimentPatternTemplate[] = [
  {
    id: "pulse-root-fifth",
    name: "Pulse (1+5)",
    lengthBeats: 2,
    events: [
      { offsetBeats: 0, durationBeats: 0.75, degree: 1, octaveOffset: 1, velocity: 78 },
      { offsetBeats: 0, durationBeats: 0.75, degree: 5, octaveOffset: 1, velocity: 70 },
      { offsetBeats: 1, durationBeats: 0.75, degree: 1, octaveOffset: 1, velocity: 74 },
      { offsetBeats: 1, durationBeats: 0.75, degree: 5, octaveOffset: 1, velocity: 68 },
    ],
  },
  {
    id: "arpeggio-up",
    name: "Arpeggio Up (1-3-5-7)",
    lengthBeats: 4,
    events: [
      { offsetBeats: 0, durationBeats: 0.9, degree: 1, octaveOffset: 1, velocity: 76 },
      { offsetBeats: 1, durationBeats: 0.9, degree: 3, octaveOffset: 1, velocity: 70 },
      { offsetBeats: 2, durationBeats: 0.9, degree: 5, octaveOffset: 1, velocity: 73 },
      { offsetBeats: 3, durationBeats: 0.9, degree: 7, octaveOffset: 1, velocity: 68 },
    ],
  },
  {
    id: "chord-entry",
    name: "Chord Entry (1+3+5 → 7-9-5)",
    lengthBeats: 4,
    events: [
      { offsetBeats: 0, durationBeats: 1.5, degree: 1, octaveOffset: 1, velocity: 80 },
      { offsetBeats: 0, durationBeats: 1.5, degree: 3, octaveOffset: 1, velocity: 74 },
      { offsetBeats: 0, durationBeats: 1.5, degree: 5, octaveOffset: 1, velocity: 70 },
      { offsetBeats: 2, durationBeats: 0.75, degree: 7, octaveOffset: 1, velocity: 70 },
      { offsetBeats: 2.75, durationBeats: 0.75, degree: 9, octaveOffset: 1, velocity: 68 },
      { offsetBeats: 3.5, durationBeats: 0.5, degree: 5, octaveOffset: 1, velocity: 66 },
    ],
  },
  {
    id: "arpeggio-five",
    name: "5-Note Arpeggio (1-3-5-7-9)",
    lengthBeats: 4,
    events: [
      { offsetBeats: 0, durationBeats: 0.7, degree: 1, octaveOffset: 1, velocity: 78 },
      { offsetBeats: 0.8, durationBeats: 0.7, degree: 3, octaveOffset: 1, velocity: 71 },
      { offsetBeats: 1.6, durationBeats: 0.7, degree: 5, octaveOffset: 1, velocity: 74 },
      { offsetBeats: 2.4, durationBeats: 0.7, degree: 7, octaveOffset: 1, velocity: 69 },
      { offsetBeats: 3.2, durationBeats: 0.7, degree: 9, octaveOffset: 1, velocity: 72 },
    ],
  },
  {
    id: "arpeggio-six",
    name: "6-Note Arpeggio (1-3-5-7-9-11)",
    lengthBeats: 4,
    events: [
      { offsetBeats: 0, durationBeats: 0.58, degree: 1, octaveOffset: 1, velocity: 78 },
      { offsetBeats: 2 / 3, durationBeats: 0.58, degree: 3, octaveOffset: 1, velocity: 71 },
      { offsetBeats: 4 / 3, durationBeats: 0.58, degree: 5, octaveOffset: 1, velocity: 74 },
      { offsetBeats: 2, durationBeats: 0.58, degree: 7, octaveOffset: 1, velocity: 69 },
      { offsetBeats: 8 / 3, durationBeats: 0.58, degree: 9, octaveOffset: 1, velocity: 72 },
      { offsetBeats: 10 / 3, durationBeats: 0.58, degree: 11, octaveOffset: 1, velocity: 67 },
    ],
  },
  {
    id: "broken-ninth",
    name: "Broken Ninth (1-5-9-3)",
    lengthBeats: 4,
    events: [
      { offsetBeats: 0, durationBeats: 0.45, degree: 1, octaveOffset: 1, velocity: 76 },
      { offsetBeats: 0.5, durationBeats: 0.45, degree: 5, octaveOffset: 1, velocity: 68 },
      { offsetBeats: 1, durationBeats: 0.45, degree: 9, octaveOffset: 1, velocity: 72 },
      { offsetBeats: 1.5, durationBeats: 0.45, degree: 3, octaveOffset: 2, velocity: 66 },
      { offsetBeats: 2, durationBeats: 0.45, degree: 5, octaveOffset: 1, velocity: 72 },
      { offsetBeats: 2.5, durationBeats: 0.45, degree: 9, octaveOffset: 1, velocity: 68 },
      { offsetBeats: 3, durationBeats: 0.45, degree: 7, octaveOffset: 1, velocity: 70 },
      { offsetBeats: 3.5, durationBeats: 0.45, degree: 5, octaveOffset: 1, velocity: 66 },
    ],
  },
  {
    id: "syncopated",
    name: "Syncopated (1-5-3-7)",
    lengthBeats: 4,
    events: [
      { offsetBeats: 0.5, durationBeats: 0.75, degree: 1, octaveOffset: 1, velocity: 78 },
      { offsetBeats: 1.5, durationBeats: 0.5, degree: 5, octaveOffset: 1, velocity: 70 },
      { offsetBeats: 2.25, durationBeats: 0.75, degree: 3, octaveOffset: 1, velocity: 74 },
      { offsetBeats: 3.5, durationBeats: 0.5, degree: 7, octaveOffset: 1, velocity: 68 },
    ],
  },
]

export function createDefaultAccompanimentPatterns(): AccompanimentPatternTemplate[] {
  return DEFAULT_ACCOMPANIMENT_PATTERNS.map((pattern) => ({
    ...pattern,
    events: pattern.events.map((event) => ({ ...event })),
  }))
}

function degreeInterval(chord: ParsedChord, degree: AccompanimentDegree): number {
  if (degree === 1) return 0
  if (degree === 3) return chord.tones.find((tone) => tone.role === "third")?.interval ?? (chord.isMinor ? 3 : 4)
  if (degree === 5) return chord.tones.find((tone) => tone.role === "fifth")?.interval ?? 7
  if (degree === 7) {
    const explicit = chord.tones.find((tone) => tone.role === "seventh")
    if (explicit) return explicit.interval
    if (chord.isDiminished) return 9
    return chord.isMinor || chord.isDominant ? 10 : 11
  }

  const preferred = chord.tensions.find((tone) => {
    if (degree === 9) return tone.interval >= 13 && tone.interval <= 15
    if (degree === 11) return tone.interval >= 16 && tone.interval <= 18
    return tone.interval >= 20 && tone.interval <= 22
  })
  if (preferred) return preferred.interval
  if (degree === 9) return 14
  if (degree === 11) return 17
  return chord.isMinor ? 20 : 21
}

export function resolveAccompanimentDegree(
  chord: ParsedChord,
  degree: AccompanimentDegree,
  octaveOffset: number,
): number {
  let pitch = 36 + chord.rootPc + degreeInterval(chord, degree) + Math.round(octaveOffset) * 12
  while (pitch < 36) pitch += 12
  while (pitch > 84) pitch -= 12
  return Math.max(0, Math.min(127, pitch))
}

/**
 * 度数＋リズムのテンプレートを現在のコード列へ解決する。
 * 実音は保存せず毎回導出するため、コード編集後の再生・MIDIへ即時反映される。
 */
export function applyAccompanimentPattern(
  pattern: AccompanimentPatternTemplate,
  chords: ChordEvent[],
  totalBeats: number,
): MelodyNote[] {
  if (!(pattern.lengthBeats > 0) || totalBeats <= 0) return []
  const parsedChords = chords
    .map((chord) => ({ chord, parsed: parseChordSymbol(chord.symbol, chord.bass ?? undefined) }))
    .filter((entry): entry is { chord: ChordEvent; parsed: ParsedChord } => entry.parsed !== null)
    .sort((a, b) => a.chord.startBeat - b.chord.startBeat)
  const notes: MelodyNote[] = []

  for (let cycleStart = 0; cycleStart < totalBeats; cycleStart += pattern.lengthBeats) {
    for (const [eventIndex, event] of pattern.events.entries()) {
      if (event.durationBeats <= 0) continue
      const eventStart = cycleStart + event.offsetBeats
      const eventEnd = Math.min(totalBeats, eventStart + event.durationBeats)
      if (eventStart >= totalBeats || eventEnd <= eventStart) continue

      for (const [chordIndex, entry] of parsedChords.entries()) {
        const chordStart = entry.chord.startBeat
        const chordEnd = chordStart + entry.chord.durationBeats
        const startBeat = Math.max(eventStart, chordStart)
        const endBeat = Math.min(eventEnd, chordEnd)
        if (endBeat <= startBeat) continue
        notes.push({
          id: `accompaniment:${pattern.id}:${cycleStart}:${eventIndex}:${chordIndex}`,
          startBeat,
          durationBeats: endBeat - startBeat,
          pitch: resolveAccompanimentDegree(entry.parsed, event.degree, event.octaveOffset),
          velocity: Math.max(1, Math.min(127, Math.round(event.velocity))),
          locks: [],
        })
      }
    }
  }

  return notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

export function accompanimentPatternNotesForSection(
  project: ComposerProject,
  sectionId: string,
): MelodyNote[] {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  const patternId = project.sectionAccompanimentPatternAssignments?.[sectionId]
  const pattern = patternId
    ? project.accompanimentPatterns?.find((candidate) => candidate.id === patternId)
    : undefined
  if (!section || !pattern) return []
  return applyAccompanimentPattern(
    pattern,
    project.chords.filter((chord) => chord.sectionId === sectionId),
    section.lengthBars * parseTimeSignature(project.song.timeSignature).beatsPerBar,
  )
}
