import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { ChordEvent, SongProfileId } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import type { SectionRole } from "@/core/section"
import type {
  CounterGeneratorStyle,
  ReactiveLayerCandidate,
  ReactiveLayerRole,
} from "@/core/reactiveLayer"
import { keyScalePitchClasses } from "@/core/scale"
import {
  analyzeMelodyActivity,
  evaluateReactiveLayerQuality,
  type MelodyActivityAnalysis,
  type MelodyGap,
} from "./reactiveLayerAnalysis"

export interface GenerateCounterInput {
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  key: string
  chords: ChordEvent[]
  melody: MelodyVariant
  totalBeats: number
  seed: number
  poolSize?: number
  finalCount?: number
}

interface StylePlan {
  style: CounterGeneratorStyle
  role: ReactiveLayerRole
  noteCount: readonly [number, number]
  durations: readonly number[]
  velocity: readonly [number, number]
  preferredSide: "analysis" | "below" | "above"
  gapCount: readonly [number, number]
}

const STYLE_PLANS: readonly StylePlan[] = [
  {
    style: "bell-response",
    role: "answer-phrase",
    noteCount: [3, 5],
    durations: [0.5, 0.75],
    velocity: [54, 68],
    preferredSide: "above",
    gapCount: [1, 1],
  },
  {
    style: "piano-echo",
    role: "motif-echo",
    noteCount: [3, 5],
    durations: [0.5, 1, 1.5],
    velocity: [45, 61],
    preferredSide: "below",
    gapCount: [1, 1],
  },
  {
    style: "string-answer",
    role: "counterline",
    noteCount: [4, 6],
    durations: [0.75, 1, 1.5],
    velocity: [42, 58],
    preferredSide: "analysis",
    gapCount: [1, 1],
  },
  {
    style: "guitar-fill",
    role: "gap-fill",
    noteCount: [4, 7],
    durations: [0.25, 0.5, 0.75],
    velocity: [52, 68],
    preferredSide: "below",
    gapCount: [1, 1],
  },
  {
    style: "synth-whisper",
    role: "suspension-layer",
    noteCount: [3, 4],
    durations: [1, 1.5, 2],
    velocity: [36, 50],
    preferredSide: "above",
    gapCount: [1, 1],
  },
] as const

const STYLE_LABELS: Record<CounterGeneratorStyle, string> = {
  "bell-response": "Bell Response",
  "piano-echo": "Piano Echo",
  "string-answer": "String Answer",
  "guitar-fill": "Guitar Fill",
  "synth-whisper": "Synth Whisper",
}

function clampMidi(value: number): number {
  return Math.max(24, Math.min(108, value))
}

function chordForBeat(chords: ChordEvent[], beat: number): ChordEvent | undefined {
  return (
    chords.find(
      (chord) =>
        beat >= chord.startBeat && beat < chord.startBeat + chord.durationBeats,
    ) ?? chords[chords.length - 1]
  )
}

function pitchInRegister(
  pitchClass: number,
  low: number,
  high: number,
  target: number,
): number {
  const candidates: number[] = []
  for (let pitch = low; pitch <= high; pitch++) {
    if (((pitch % 12) + 12) % 12 === pitchClass) candidates.push(pitch)
  }
  if (candidates.length === 0) {
    const octave = Math.round((target - pitchClass) / 12)
    return clampMidi(pitchClass + octave * 12)
  }
  return candidates.reduce((best, pitch) =>
    Math.abs(pitch - target) < Math.abs(best - target) ? pitch : best,
  )
}

function scaleLadder(key: string, low: number, high: number): number[] {
  const pitchClasses = new Set(keyScalePitchClasses(key))
  return Array.from({ length: high - low + 1 }, (_, index) => low + index).filter(
    (pitch) => pitchClasses.has(((pitch % 12) + 12) % 12),
  )
}

function nearestLadderIndex(ladder: number[], target: number): number {
  let bestIndex = 0
  for (let index = 1; index < ladder.length; index++) {
    if (
      Math.abs(ladder[index] - target) <
      Math.abs(ladder[bestIndex] - target)
    ) {
      bestIndex = index
    }
  }
  return bestIndex
}

function melodicSourceBefore(
  melody: MelodyNote[],
  beat: number,
): MelodyNote[] {
  return melody
    .filter((note) => note.startBeat + note.durationBeats <= beat + 0.001)
    .sort((a, b) => a.startBeat - b.startBeat)
    .slice(-4)
}

function contourSteps(
  plan: StylePlan,
  source: MelodyNote[],
  count: number,
  inverseDirection: number,
): number[] {
  if (
    plan.style === "bell-response" ||
    plan.style === "string-answer" ||
    plan.style === "synth-whisper"
  ) {
    return Array.from({ length: count }, (_, index) =>
      index === 0 ? 0 : inverseDirection,
    )
  }
  const sourceIntervals = source
    .slice(1)
    .map((note, index) => note.pitch - source[index].pitch)
  if (sourceIntervals.length === 0) {
    return Array.from({ length: count }, (_, index) =>
      index === 0 ? 0 : inverseDirection,
    )
  }
  const transformed =
    plan.style === "piano-echo"
      ? [...sourceIntervals].reverse()
      : sourceIntervals.map((interval, index) =>
          index % 2 === 0 ? -interval : interval,
        )
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 0
    const interval = transformed[(index - 1) % transformed.length]
    return Math.sign(interval) || inverseDirection
  })
}

function registerForPlan(
  plan: StylePlan,
  analysis: MelodyActivityAnalysis,
): { low: number; high: number } {
  if (plan.preferredSide === "below") {
    return {
      low: Math.max(36, analysis.registerBudget.melodyLow - 17),
      high: Math.max(40, analysis.registerBudget.melodyLow - 4),
    }
  }
  if (plan.preferredSide === "above") {
    return {
      low: Math.min(92, analysis.registerBudget.melodyHigh + 4),
      high: Math.min(96, analysis.registerBudget.melodyHigh + 16),
    }
  }
  return {
    low: analysis.registerBudget.low,
    high: analysis.registerBudget.high,
  }
}

function melodyDirectionBefore(melody: MelodyNote[], beat: number): number {
  const prior = melody
    .filter((note) => note.startBeat + note.durationBeats <= beat + 0.001)
    .sort((a, b) => a.startBeat - b.startBeat)
    .slice(-2)
  if (prior.length < 2) return 1
  return Math.sign(prior[1].pitch - prior[0].pitch) || 1
}

function availableGaps(
  analysis: MelodyActivityAnalysis,
  minimumDuration: number,
): MelodyGap[] {
  return analysis.gaps.filter((gap) => gap.durationBeats >= minimumDuration)
}

function counterOpportunityWindows(
  input: GenerateCounterInput,
  analysis: MelodyActivityAnalysis,
  minimumDuration: number,
): MelodyGap[] {
  const criticalStarts = analysis.protectedMoments
    .filter((moment) =>
      moment.reasons.some(
        (reason) =>
          reason === "highest-note" ||
          reason === "non-chord-resolution",
      ),
    )
    .map((moment) => moment.startBeat)
    .sort((a, b) => a - b)
  const fromRests = availableGaps(analysis, minimumDuration).map((gap) => {
    const desiredEnd = Math.min(
      input.totalBeats,
      gap.startBeat + Math.max(2, Math.min(4, gap.durationBeats + 1.5)),
    )
    const nextCritical = criticalStarts.find(
      (beat) => beat >= gap.endBeat - 0.001 && beat > gap.startBeat + 0.5,
    )
    const endBeat = Math.max(
      gap.endBeat,
      Math.min(desiredEnd, nextCritical ?? desiredEnd),
    )
    return {
      startBeat: gap.startBeat,
      endBeat,
      durationBeats: endBeat - gap.startBeat,
    }
  })

  const highestPitch = Math.max(...input.melody.notes.map((note) => note.pitch))
  const sustainTails = input.melody.notes
    .filter(
      (note) =>
        note.durationBeats >= 2 &&
        note.pitch < highestPitch &&
        !note.plannedResolution,
    )
    .map((note) => {
      const startBeat = note.startBeat + Math.min(0.75, note.durationBeats * 0.4)
      const endBeat = Math.min(
        input.totalBeats,
        note.startBeat + note.durationBeats - 0.25,
      )
      return {
        startBeat,
        endBeat,
        durationBeats: endBeat - startBeat,
      }
    })
    .filter((window) => window.durationBeats >= minimumDuration)

  return [...fromRests, ...sustainTails]
    .filter((window) => window.durationBeats >= minimumDuration)
    .sort((a, b) => a.startBeat - b.startBeat)
    .filter(
      (window, index, windows) =>
        index === 0 ||
        Math.abs(window.startBeat - windows[index - 1].startBeat) > 0.125 ||
        Math.abs(window.endBeat - windows[index - 1].endBeat) > 0.125,
    )
}

function generatePhraseInGap(
  plan: StylePlan,
  gap: MelodyGap,
  phraseIndex: number,
  input: GenerateCounterInput,
  analysis: MelodyActivityAnalysis,
  rng: SeededRandom,
): MelodyNote[] {
  const register = registerForPlan(plan, analysis)
  const requestedCount = rng.intBetween(plan.noteCount[0], plan.noteCount[1])
  const count = Math.max(1, Math.min(requestedCount, Math.floor(gap.durationBeats / 0.25)))
  const pickupOffset =
    plan.style === "guitar-fill" && gap.durationBeats >= 1 ? 0.25 : 0
  const phraseStart = gap.startBeat + pickupOffset
  const endBeat = Math.min(gap.endBeat, gap.startBeat + 4)
  const slotBeats = Math.max(0.25, (endBeat - phraseStart) / count)
  const inverseDirection = -melodyDirectionBefore(input.melody.notes, gap.startBeat)
  const source = melodicSourceBefore(input.melody.notes, gap.startBeat)
  const ladder = scaleLadder(input.key, register.low, register.high)
  if (ladder.length === 0) return []
  let ladderIndex = nearestLadderIndex(
    ladder,
    (register.low + register.high) / 2,
  )
  const steps = contourSteps(plan, source, count, inverseDirection)
  const usesStepwiseContour =
    plan.style === "bell-response" ||
    plan.style === "string-answer" ||
    plan.style === "synth-whisper"
  if (usesStepwiseContour) {
    const finalBeat = phraseStart + (count - 1) * slotBeats
    const finalChord = chordForBeat(input.chords, finalBeat)
    const finalParsed = finalChord
      ? parseChordSymbol(finalChord.symbol, finalChord.bass ?? undefined)
      : null
    const chordIndices = finalParsed?.tones
      .map((tone) =>
        ladder.findIndex(
          (pitch) =>
            ((pitch % 12) + 12) % 12 === tone.pitchClass,
        ),
      )
      .filter((index) => index >= 0)
    const alignedTarget = chordIndices
      ?.map((targetIndex) => ({
        targetIndex,
        startIndex: targetIndex - inverseDirection * (count - 1),
      }))
      .filter(
        ({ startIndex }) =>
          startIndex >= 0 && startIndex < ladder.length,
      )
      .sort(
        (left, right) =>
          Math.abs(
            ladder[left.startIndex] -
              (register.low + register.high) / 2,
          ) -
          Math.abs(
            ladder[right.startIndex] -
              (register.low + register.high) / 2,
          ),
      )[0]
    if (alignedTarget) ladderIndex = alignedTarget.startIndex
  }
  const notes: MelodyNote[] = []

  for (let index = 0; index < count; index++) {
    const beat = phraseStart + index * slotBeats
    if (beat >= endBeat - 0.1) break
    const chord = chordForBeat(input.chords, beat)
    const parsed = chord
      ? parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      : null
    if (index > 0) {
      ladderIndex = Math.max(
        0,
        Math.min(ladder.length - 1, ladderIndex + steps[index]),
      )
    }
    let pitch = ladder[ladderIndex]
    let pitchClass = ((pitch % 12) + 12) % 12
    const isLast = index === count - 1
    if (isLast && parsed) {
      const chordPitchClasses = parsed.tones.map((tone) => tone.pitchClass)
      const nearestChordPitchClass = chordPitchClasses.reduce((best, current) => {
        const bestPitch = pitchInRegister(best, register.low, register.high, pitch)
        const currentPitch = pitchInRegister(
          current,
          register.low,
          register.high,
          pitch,
        )
        return Math.abs(currentPitch - pitch) < Math.abs(bestPitch - pitch)
          ? current
          : best
      })
      const resolvedPitch = pitchInRegister(
        nearestChordPitchClass,
        register.low,
        register.high,
        pitch,
      )
      const previous = notes.at(-1)?.pitch
      if (
        previous === undefined ||
        (Math.abs(resolvedPitch - previous) >= 1 &&
          Math.abs(resolvedPitch - previous) <= 3)
      ) {
        pitchClass = nearestChordPitchClass
        pitch = resolvedPitch
      }
    }

    const echoedDuration =
      plan.style === "piano-echo"
        ? source[index % Math.max(1, source.length)]?.durationBeats
        : undefined
    const desiredDuration =
      echoedDuration && plan.durations.includes(echoedDuration)
        ? echoedDuration
        : rng.pick(plan.durations)
    const remaining = endBeat - beat
    const articulatedSlot =
      plan.style === "synth-whisper"
        ? slotBeats
        : plan.style === "piano-echo"
          ? slotBeats * 0.72
          : slotBeats * 0.82
    const durationBeats = Math.max(
      0.25,
      Math.min(desiredDuration, articulatedSlot, remaining),
    )
    notes.push({
      id: `counter:${input.seed}:${phraseIndex}:${index}`,
      startBeat: beat,
      durationBeats,
      pitch,
      velocity: rng.intBetween(plan.velocity[0], plan.velocity[1]),
      locks: [],
      plannedToneRole: parsed?.tones.some((tone) => tone.pitchClass === pitchClass)
        ? "chord-tone"
        : plan.style === "synth-whisper"
          ? "tension-hold"
          : "passing-tone",
    })
  }
  return notes.map((note, index) => {
    if (note.plannedToneRole !== "passing-tone") return note
    const target = notes[index + 1]
    if (!target) return { ...note, plannedToneRole: "tension-hold" }
    return {
      ...note,
      plannedResolution: {
        targetPitchClass: ((target.pitch % 12) + 12) % 12,
        targetBeat: target.startBeat,
        maximumDelayBeats: Math.max(0.25, target.startBeat - note.startBeat),
      },
    }
  })
}

function harmonicFit(notes: MelodyNote[], chords: ChordEvent[]): number {
  if (notes.length === 0) return 0
  const fitted = notes.filter((note) => {
    const chord = chordForBeat(chords, note.startBeat)
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    if (!parsed) return false
    const pc = ((note.pitch % 12) + 12) % 12
    return [...parsed.tones, ...parsed.tensions].some((tone) => tone.pitchClass === pc)
  }).length
  return (fitted / notes.length) * 100
}

function sectionFit(role: SectionRole, noteCount: number): number {
  const sparse = role === "verse" || role === "intro" || role === "breakdown-chorus"
  const dense = role === "grand-chorus" || role === "instrumental"
  if (sparse) return Math.max(55, 100 - Math.max(0, noteCount - 5) * 10)
  if (dense) return Math.min(100, 65 + noteCount * 4)
  return Math.max(65, 95 - Math.abs(noteCount - 5) * 5)
}

function motifRelationship(melody: MelodyNote[], notes: MelodyNote[]): number {
  if (melody.length < 2 || notes.length < 2) return 62
  const melodyIntervals = melody
    .slice(0, 8)
    .slice(1)
    .map((note, index) => Math.abs(note.pitch - melody[index].pitch))
  const counterIntervals = notes
    .slice(1)
    .map((note, index) => Math.abs(note.pitch - notes[index].pitch))
  const related = counterIntervals.filter((interval) =>
    melodyIntervals.some((melodyInterval) => Math.abs(melodyInterval - interval) <= 1),
  ).length
  return 55 + (related / Math.max(1, counterIntervals.length)) * 35
}

function overlappingMelodyNote(
  melody: MelodyNote[],
  beat: number,
): MelodyNote | undefined {
  return melody.find(
    (note) =>
      beat >= note.startBeat &&
      beat < note.startBeat + note.durationBeats,
  )
}

/** 強拍協和・反行/斜行・終止協調をまとめたCounter固有評価。 */
export function evaluateCounterpointFit(
  melody: MelodyNote[],
  counter: MelodyNote[],
  chords: ChordEvent[],
): number {
  if (counter.length < 2) return 40
  const consonantClasses = new Set([0, 3, 4, 5, 7, 8, 9])
  let structuralAttacks = 0
  let consonantAttacks = 0
  for (const note of counter) {
    if (Math.abs(note.startBeat - Math.round(note.startBeat)) > 0.08) {
      continue
    }
    const melodyNote = overlappingMelodyNote(melody, note.startBeat)
    if (!melodyNote) continue
    structuralAttacks++
    const intervalClass =
      Math.abs(note.pitch - melodyNote.pitch) % 12
    if (consonantClasses.has(intervalClass)) consonantAttacks++
  }

  let independentMotion = 0
  let comparableMotion = 0
  const sortedMelody = [...melody].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const sortedCounter = [...counter].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  for (let index = 1; index < sortedCounter.length; index++) {
    const previousCounter = sortedCounter[index - 1]
    const currentCounter = sortedCounter[index]
    const previousMelody =
      overlappingMelodyNote(
        sortedMelody,
        previousCounter.startBeat,
      ) ??
      sortedMelody
        .filter(
          (note) => note.startBeat <= previousCounter.startBeat,
        )
        .at(-1)
    const currentMelody =
      overlappingMelodyNote(sortedMelody, currentCounter.startBeat) ??
      sortedMelody
        .filter(
          (note) => note.startBeat <= currentCounter.startBeat,
        )
        .at(-1)
    if (!previousMelody || !currentMelody) continue
    const melodyMotion = Math.sign(
      currentMelody.pitch - previousMelody.pitch,
    )
    const counterMotion = Math.sign(
      currentCounter.pitch - previousCounter.pitch,
    )
    comparableMotion++
    if (
      melodyMotion === 0 ||
      counterMotion === 0 ||
      melodyMotion !== counterMotion
    ) {
      independentMotion++
    }
  }

  const last = sortedCounter.at(-1)!
  const lastChord = chordForBeat(chords, last.startBeat)
  const parsedLast = lastChord
    ? parseChordSymbol(lastChord.symbol, lastChord.bass ?? undefined)
    : null
  const lastPitchClass = ((last.pitch % 12) + 12) % 12
  const cadenceFit = parsedLast?.tones.some(
    (tone) => tone.pitchClass === lastPitchClass,
  )
    ? 100
    : 68
  const consonance =
    structuralAttacks === 0
      ? 82
      : (consonantAttacks / structuralAttacks) * 100
  const motion =
    comparableMotion === 0
      ? 78
      : (independentMotion / comparableMotion) * 100
  return Math.max(
    0,
    Math.min(
      100,
      consonance * 0.42 + motion * 0.38 + cadenceFit * 0.2,
    ),
  )
}

function candidateSimilarity(
  left: Pick<ReactiveLayerCandidate, "notes" | "generatorStyle" | "role">,
  right: Pick<ReactiveLayerCandidate, "notes" | "generatorStyle" | "role">,
): number {
  const startsLeft = new Set(left.notes.map((note) => Math.round(note.startBeat * 4)))
  const startsRight = new Set(right.notes.map((note) => Math.round(note.startBeat * 4)))
  const intersection = [...startsLeft].filter((start) => startsRight.has(start)).length
  const onsetSimilarity =
    intersection / Math.max(1, Math.max(startsLeft.size, startsRight.size))
  const pitchLeft = left.notes.map((note) => note.pitch)
  const pitchRight = right.notes.map((note) => note.pitch)
  const contourLength = Math.min(pitchLeft.length, pitchRight.length) - 1
  let contourMatches = 0
  for (let index = 0; index < contourLength; index++) {
    const a = Math.sign(pitchLeft[index + 1] - pitchLeft[index])
    const b = Math.sign(pitchRight[index + 1] - pitchRight[index])
    if (a === b) contourMatches++
  }
  const contourSimilarity = contourLength > 0 ? contourMatches / contourLength : 0
  const styleSimilarity = left.generatorStyle === right.generatorStyle ? 1 : 0
  const roleSimilarity = left.role === right.role ? 1 : 0
  return onsetSimilarity * 0.4 + contourSimilarity * 0.3 + styleSimilarity * 0.2 + roleSimilarity * 0.1
}

function selectDiverseCandidates(
  pool: ReactiveLayerCandidate[],
  finalCount: number,
): ReactiveLayerCandidate[] {
  const eligibleWithDuplicates = pool
    .filter(
      (candidate) =>
        candidate.quality.overallQuality >= 68 &&
        candidate.quality.melodyRespect >= 80 &&
        candidate.quality.harmonicFit >= 60 &&
        candidate.quality.motifRelationship >= 55 &&
        !candidate.collisions.hasBlockingCollision &&
        candidate.notes.length >= 3,
    )
    .sort((a, b) => b.quality.overallQuality - a.quality.overallQuality)
  const eligible = eligibleWithDuplicates.filter(
    (candidate, index, candidates) =>
      candidates.findIndex(
        (other) =>
          other.notes
            .map(
              (note) =>
                `${note.startBeat.toFixed(3)}:${note.durationBeats.toFixed(3)}:${note.pitch}`,
            )
            .join("|") ===
          candidate.notes
            .map(
              (note) =>
                `${note.startBeat.toFixed(3)}:${note.durationBeats.toFixed(3)}:${note.pitch}`,
            )
            .join("|"),
      ) === index,
  )
  const source = eligible
  const selected: ReactiveLayerCandidate[] = []
  while (selected.length < finalCount && selected.length < source.length) {
    if (selected.length === 0) {
      selected.push({ ...source[0], selectionReason: "highest-quality" })
      continue
    }
    const remaining = source.filter(
      (candidate) => !selected.some((item) => item.id === candidate.id),
    )
    const needsStepwise =
      !selected.some((candidate) => isStepwiseCandidate(candidate)) &&
      remaining.some((candidate) => isStepwiseCandidate(candidate))
    const selectionPool = needsStepwise
      ? remaining.filter((candidate) => isStepwiseCandidate(candidate))
      : remaining
    const next = selectionPool
      .map((candidate) => {
        const maximumSimilarity = Math.max(
          ...selected.map((item) => candidateSimilarity(candidate, item)),
        )
        return {
          candidate,
          score: candidate.quality.overallQuality * 0.65 + (1 - maximumSimilarity) * 100 * 0.35,
        }
      })
      .sort((a, b) => b.score - a.score)[0]?.candidate
    if (!next) break
    selected.push({ ...next, selectionReason: "quality-diversity-balance" })
  }
  return selected
}

function isStepwiseCandidate(candidate: ReactiveLayerCandidate): boolean {
  if (candidate.notes.length < 2) return false
  return candidate.notes.slice(1).every((note, index) => {
    const interval = Math.abs(note.pitch - candidate.notes[index].pitch)
    return interval > 0 && interval <= 3
  })
}

function buildPoolCandidate(
  input: GenerateCounterInput,
  plan: StylePlan,
  poolIndex: number,
  analysis: MelodyActivityAnalysis,
): ReactiveLayerCandidate {
  const candidateSeed = (input.seed + (poolIndex + 1) * 104_729) >>> 0
  const rng = new SeededRandom(candidateSeed)
  const gaps = counterOpportunityWindows(
    input,
    analysis,
    plan.style === "synth-whisper" ? 0.75 : 0.5,
  )
  const gapCount = Math.min(gaps.length, rng.intBetween(plan.gapCount[0], plan.gapCount[1]))
  const selectedGaps = gaps
    .map((gap) => ({
      gap,
      score: (() => {
        const preceding = melodicSourceBefore(
          input.melody.notes,
          gap.startBeat,
        ).at(-1)
        const phraseRelease = preceding
          ? Math.min(1.5, preceding.durationBeats) * 0.35
          : 0
        const usableSpace = Math.min(2, gap.durationBeats) * 0.35
        const sectionalVariety =
          ((poolIndex + Math.round(gap.startBeat)) % 5) * 0.06
        return phraseRelease + usableSpace + sectionalVariety + rng.next() * 0.2
      })(),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, gapCount)
    .map(({ gap }) => gap)
    .sort((a, b) => a.startBeat - b.startBeat)
  const notes = selectedGaps.flatMap((gap, index) =>
    generatePhraseInGap(plan, gap, index, { ...input, seed: candidateSeed }, analysis, rng),
  )
  const opportunityAnalysis = { ...analysis, gaps }
  const relationship = motifRelationship(input.melody.notes, notes)
  const counterpointFit = evaluateCounterpointFit(
    input.melody.notes,
    notes,
    input.chords,
  )
  const evaluated = evaluateReactiveLayerQuality(input.melody.notes, notes, opportunityAnalysis, {
    harmonicFit: harmonicFit(notes, input.chords),
    motifRelationship: relationship * 0.55 + counterpointFit * 0.45,
    sectionFit: sectionFit(input.sectionRole, notes.length),
    transitionValue: input.sectionRole === "pre-chorus" || input.sectionRole === "bridge" ? 78 : 65,
  })
  return {
    id: `counter-${candidateSeed}-${poolIndex}`,
    batchId: `counter-batch-${input.seed}`,
    sectionId: input.sectionId,
    targetMelodyVariantId: input.melody.id,
    kind: "counter",
    role: plan.role,
    generatorStyle: plan.style,
    name: STYLE_LABELS[plan.style],
    notes,
    seed: candidateSeed,
    quality: evaluated.quality,
    collisions: evaluated.collisions,
    reviewState: null,
    createdAt: new Date(0).toISOString(),
  }
}

/** 拡張候補プールを独立生成し、品質下限と候補間差を両立する3案を返す。 */
export function generateCounterCandidates(
  input: GenerateCounterInput,
): ReactiveLayerCandidate[] {
  const analysis = analyzeMelodyActivity(input.melody.notes, input.totalBeats)
  const poolSize = Math.max(input.finalCount ?? 3, input.poolSize ?? 40)
  const pool = Array.from({ length: poolSize }, (_, index) =>
    buildPoolCandidate(
      input,
      STYLE_PLANS[(index + (input.seed % STYLE_PLANS.length)) % STYLE_PLANS.length],
      index,
      analysis,
    ),
  )
  return selectDiverseCandidates(pool, input.finalCount ?? 3)
}

export function regenerateCounterCandidate(
  input: GenerateCounterInput,
  current: ReactiveLayerCandidate,
  siblings: ReactiveLayerCandidate[],
): ReactiveLayerCandidate | null {
  const generated = generateCounterCandidates({
    ...input,
    seed: (current.seed + 1_000_003) >>> 0,
    poolSize: 40,
    finalCount: 3,
  })
  const alternatives = generated
    .filter((candidate) => candidate.generatorStyle !== current.generatorStyle)
    .map((candidate) => ({
      candidate,
      similarity: Math.max(
        0,
        ...siblings.map((sibling) => candidateSimilarity(candidate, sibling)),
      ),
    }))
    .sort(
      (a, b) =>
        a.similarity - b.similarity ||
        b.candidate.quality.overallQuality - a.candidate.quality.overallQuality,
    )
  const selected = alternatives[0]?.candidate ?? generated[0]
  return selected ? { ...selected, selectionReason: "regenerated" } : null
}
