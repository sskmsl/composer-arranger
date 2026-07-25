import { parseChordSymbol, type ParsedChord } from "./chord"
import type { MelodyNote } from "./melody"
import type { ChordEvent, ComposerProject } from "./project"
import { parseTimeSignature } from "./section"
import { notesByPartRole } from "./sectionLayers"

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

export interface AccompanimentPatternContext {
  /** セクション相対拍のリード旋律。伴奏の音域・密度・強弱をこの旋律へ追従させる。 */
  melodyNotes?: MelodyNote[]
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

interface ResolvedPatternEvent {
  chord: ParsedChord
  startBeat: number
  durationBeats: number
  degree: AccompanimentDegree
  octaveOffset: number
  velocity: number
  cycleIndex: number
  eventIndex: number
  isLastPatternEvent: boolean
  chordIndex: number
}

interface PreviousVoicing {
  basePitch: number
  pitch: number
  startBeat: number
  chordRootPc: number
}

const ACCOMPANIMENT_LOW = 36
const ACCOMPANIMENT_HIGH = 67

function overlap(aStart: number, aDuration: number, b: MelodyNote): boolean {
  return aStart < b.startBeat + b.durationBeats && b.startBeat < aStart + aDuration
}

function melodyAt(event: Pick<ResolvedPatternEvent, "startBeat" | "durationBeats">, melody: MelodyNote[]): MelodyNote[] {
  return melody.filter((note) => overlap(event.startBeat, event.durationBeats, note))
}

function hasMelodyAttack(startBeat: number, melody: MelodyNote[]): boolean {
  return melody.some((note) => Math.abs(note.startBeat - startBeat) <= 0.08)
}

function pitchClassDistance(a: number, b: number): number {
  const distance = Math.abs((((a - b) % 12) + 12) % 12)
  return Math.min(distance, 12 - distance)
}

function alternativeDegrees(chord: ParsedChord, planned: AccompanimentDegree): AccompanimentDegree[] {
  const degrees: AccompanimentDegree[] = [planned, 1, 3, 5]
  if (chord.tones.some((tone) => tone.role === "seventh")) degrees.push(7)
  if (chord.tensions.some((tone) => tone.interval >= 13 && tone.interval <= 15)) degrees.push(9)
  if (chord.tensions.some((tone) => tone.interval >= 16 && tone.interval <= 18)) degrees.push(11)
  if (
    chord.tensions.some((tone) => tone.interval >= 20 && tone.interval <= 22) ||
    (!chord.isMinor && !chord.isDiminished && !chord.isSus)
  ) degrees.push(13)
  return [...new Set(degrees)]
}

function plannedDegreePenalty(chord: ParsedChord, degree: AccompanimentDegree): number {
  if (
    degree === 11 &&
    !chord.isMinor &&
    !chord.isSus &&
    !chord.isDominant &&
    !chord.tensions.some((tone) => tone.interval >= 16 && tone.interval <= 18)
  ) return 45
  if (
    degree === 7 &&
    !chord.isMinor &&
    !chord.isDominant &&
    !chord.tones.some((tone) => tone.role === "seventh")
  ) return 12
  if (degree === 13 && chord.isDiminished) return 40
  return 0
}

function chooseAccompanimentPitch(
  event: ResolvedPatternEvent,
  activeMelody: MelodyNote[],
  previous: PreviousVoicing | null,
): { pitch: number; basePitch: number } {
  // 2回目の提示では末尾を低く返し、同じ上昇形の機械的な反復を避ける。
  // 4回目はshouldCreateBreath()が末尾を休符化するため、4周期で「提示→応答→展開→呼吸」になる。
  const turnaroundOctave = event.isLastPatternEvent && event.cycleIndex % 2 === 1 ? -1 : 0
  const resolvedOctave = event.octaveOffset + turnaroundOctave
  const plannedBase = resolveAccompanimentDegree(event.chord, event.degree, resolvedOctave)
  let best = { pitch: plannedBase, basePitch: plannedBase, score: Number.POSITIVE_INFINITY }

  for (const degree of alternativeDegrees(event.chord, event.degree)) {
    const degreeBase = resolveAccompanimentDegree(event.chord, degree, resolvedOctave)
    for (const shift of [-24, -12, 0, 12]) {
      const pitch = degreeBase + shift
      if (pitch < ACCOMPANIMENT_LOW || pitch > ACCOMPANIMENT_HIGH) continue

      let score =
        degree === event.degree
          ? plannedDegreePenalty(event.chord, degree)
          : event.degree >= 9 && degree >= 9
            ? 12
            : 22
      score += Math.abs(pitch - plannedBase) * 0.2
      if (pitch > 60) score += (pitch - 60) * 1.6

      for (const melodyNote of activeMelody) {
        const distance = Math.abs(pitch - melodyNote.pitch)
        const pcDistance = pitchClassDistance(pitch, melodyNote.pitch)
        if (distance === 0) score += 240
        else if (distance <= 2) score += 150 - distance * 20
        if (pcDistance === 1) score += 110
        else if (pcDistance === 0 && distance <= 12) score += 18
        const desiredCeiling = melodyNote.pitch - 5
        if (pitch > desiredCeiling) score += 35 + (pitch - desiredCeiling) * 4
      }

      if (previous && previous.startBeat === event.startBeat) {
        const voiceSpacing = pitch - previous.pitch
        if (voiceSpacing <= 0) score += 180 + Math.abs(voiceSpacing) * 8
        else if (voiceSpacing < 3) score += 55
        else if (voiceSpacing > 12) score += (voiceSpacing - 12) * 3
      } else if (previous && previous.chordRootPc !== event.chord.rootPc) {
        const actualMotion = pitch - previous.pitch
        score += Math.abs(actualMotion) * 1.3
        score += Math.max(0, Math.abs(actualMotion) - 7) * 1.8
      } else if (previous) {
        const plannedMotion = plannedBase - previous.basePitch
        const actualMotion = pitch - previous.pitch
        score += Math.abs(actualMotion - plannedMotion) * 1.2
        score += Math.max(0, Math.abs(actualMotion) - 7) * 1.3
      }

      if (score < best.score) best = { pitch, basePitch: plannedBase, score }
    }
  }
  return { pitch: best.pitch, basePitch: best.basePitch }
}

function shouldCreateBreath(
  event: ResolvedPatternEvent,
  eventCount: number,
  melody: MelodyNote[],
): boolean {
  const phraseBreath = event.cycleIndex % 4 === 3 && event.eventIndex === eventCount - 1
  const melodyOwnsAttack =
    event.degree >= 7 &&
    event.velocity <= 72 &&
    hasMelodyAttack(event.startBeat, melody)
  return phraseBreath || melodyOwnsAttack
}

function expressiveVelocity(event: ResolvedPatternEvent, activeMelody: MelodyNote[]): number {
  const phraseShape = [0, -4, 2, -7][event.cycleIndex % 4]
  const melodyDuck = activeMelody.length > 0 ? -10 : 2
  return Math.max(38, Math.min(82, Math.round(event.velocity + phraseShape + melodyDuck)))
}

function expressiveDuration(event: ResolvedPatternEvent, activeMelody: MelodyNote[]): number {
  const phraseShape = [1, 0.92, 1.04, 0.84][event.cycleIndex % 4]
  const melodySpace = activeMelody.length > 0 && hasMelodyAttack(event.startBeat, activeMelody) ? 0.82 : 1
  return Math.max(0.1, event.durationBeats * phraseShape * melodySpace)
}

/**
 * 度数＋リズムのテンプレートを現在のコード列へ解決する。
 * 実音は保存せず毎回導出するため、コード編集後の再生・MIDIへ即時反映される。
 */
export function applyAccompanimentPattern(
  pattern: AccompanimentPatternTemplate,
  chords: ChordEvent[],
  totalBeats: number,
  context: AccompanimentPatternContext = {},
): MelodyNote[] {
  if (!(pattern.lengthBeats > 0) || totalBeats <= 0) return []
  const parsedChords = chords
    .map((chord) => ({ chord, parsed: parseChordSymbol(chord.symbol, chord.bass ?? undefined) }))
    .filter((entry): entry is { chord: ChordEvent; parsed: ParsedChord } => entry.parsed !== null)
    .sort((a, b) => a.chord.startBeat - b.chord.startBeat)
  const melody = [...(context.melodyNotes ?? [])].sort((a, b) => a.startBeat - b.startBeat)
  const resolvedEvents: ResolvedPatternEvent[] = []
  const notes: MelodyNote[] = []

  for (let cycleStart = 0; cycleStart < totalBeats; cycleStart += pattern.lengthBeats) {
    const cycleIndex = Math.floor(cycleStart / pattern.lengthBeats)
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
        resolvedEvents.push({
          chord: entry.parsed,
          startBeat,
          durationBeats: endBeat - startBeat,
          degree: event.degree,
          octaveOffset: event.octaveOffset,
          velocity: event.velocity,
          cycleIndex,
          eventIndex,
          isLastPatternEvent: eventIndex === pattern.events.length - 1,
          chordIndex,
        })
      }
    }
  }

  resolvedEvents.sort((a, b) => a.startBeat - b.startBeat || a.eventIndex - b.eventIndex)
  let previous: PreviousVoicing | null = null
  for (const event of resolvedEvents) {
    if (shouldCreateBreath(event, pattern.events.length, melody)) continue
    const activeMelody = melodyAt(event, melody)
    const { pitch, basePitch } = chooseAccompanimentPitch(event, activeMelody, previous)
    const durationBeats = Math.min(
      totalBeats - event.startBeat,
      event.durationBeats,
      expressiveDuration(event, activeMelody),
    )
    notes.push({
      id: `accompaniment:${pattern.id}:${event.cycleIndex}:${event.eventIndex}:${event.chordIndex}`,
      startBeat: event.startBeat,
      durationBeats,
      pitch,
      velocity: expressiveVelocity(event, activeMelody),
      locks: [],
    })
    previous = {
      pitch,
      basePitch,
      startBeat: event.startBeat,
      chordRootPc: event.chord.rootPc,
    }
  }

  return notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

export function accompanimentPatternNotesForSection(
  project: ComposerProject,
  sectionId: string,
  melodyNotes?: MelodyNote[],
): MelodyNote[] {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  const patternId = project.sectionAccompanimentPatternAssignments?.[sectionId]
  const pattern = patternId
    ? project.accompanimentPatterns?.find((candidate) => candidate.id === patternId)
    : undefined
  if (!section || !pattern) return []
  const assignedVariantId = project.sectionMelodyAssignments?.[sectionId]
  const assignedVariant = assignedVariantId
    ? project.melodyVariants.find(
        (variant) => variant.id === assignedVariantId && variant.sectionId === sectionId,
      )
    : undefined
  const resolvedMelodyNotes =
    melodyNotes ??
    (assignedVariant ? notesByPartRole(assignedVariant, "lead") : [])
  return applyAccompanimentPattern(
    pattern,
    project.chords.filter((chord) => chord.sectionId === sectionId),
    section.lengthBars * parseTimeSignature(project.song.timeSignature).beatsPerBar,
    { melodyNotes: resolvedMelodyNotes },
  )
}
