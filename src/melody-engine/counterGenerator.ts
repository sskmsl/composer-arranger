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
    noteCount: [2, 3],
    durations: [0.5, 0.75],
    velocity: [54, 68],
    preferredSide: "above",
    gapCount: [1, 2],
  },
  {
    style: "piano-echo",
    role: "motif-echo",
    noteCount: [2, 4],
    durations: [0.5, 1, 1.5],
    velocity: [45, 61],
    preferredSide: "below",
    gapCount: [1, 2],
  },
  {
    style: "string-answer",
    role: "counterline",
    noteCount: [2, 4],
    durations: [0.75, 1, 1.5],
    velocity: [42, 58],
    preferredSide: "analysis",
    gapCount: [1, 2],
  },
  {
    style: "guitar-fill",
    role: "gap-fill",
    noteCount: [3, 5],
    durations: [0.25, 0.5, 0.75],
    velocity: [52, 68],
    preferredSide: "below",
    gapCount: [1, 2],
  },
  {
    style: "synth-whisper",
    role: "suspension-layer",
    noteCount: [1, 2],
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
  let beat = gap.startBeat + pickupOffset
  const endBeat = Math.min(gap.endBeat, gap.startBeat + 4)
  const inverseDirection = -melodyDirectionBefore(input.melody.notes, gap.startBeat)
  let previousPitch: number | null = null
  const notes: MelodyNote[] = []

  for (let index = 0; index < count && beat < endBeat - 0.1; index++) {
    const chord = chordForBeat(input.chords, beat)
    const parsed = chord
      ? parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      : null
    const palette = parsed
      ? [...parsed.tones, ...parsed.tensions.slice(0, 1)].map((tone) => tone.pitchClass)
      : [0, 4, 7]
    const direction =
      plan.style === "piano-echo" ? inverseDirection : index % 3 === 2 ? -inverseDirection : inverseDirection
    const center =
      previousPitch === null
        ? (register.low + register.high) / 2
        : previousPitch + direction * rng.pick([1, 2, 3, 4])
    const pitchClass = rng.pick(palette)
    let pitch = pitchInRegister(pitchClass, register.low, register.high, center)
    if (previousPitch !== null && Math.abs(pitch - previousPitch) > 7) {
      const octaveAdjusted = pitch + (pitch > previousPitch ? -12 : 12)
      if (octaveAdjusted >= register.low && octaveAdjusted <= register.high) pitch = octaveAdjusted
    }

    const desiredDuration = rng.pick(plan.durations)
    const remaining = endBeat - beat
    const durationBeats = Math.max(0.25, Math.min(desiredDuration, remaining))
    notes.push({
      id: `counter:${input.seed}:${phraseIndex}:${index}`,
      startBeat: beat,
      durationBeats,
      pitch,
      velocity: rng.intBetween(plan.velocity[0], plan.velocity[1]),
      locks: [],
      plannedToneRole: parsed?.tones.some((tone) => tone.pitchClass === pitchClass)
        ? "chord-tone"
        : "tension-hold",
    })
    previousPitch = pitch
    const rest =
      plan.style === "piano-echo" || plan.style === "synth-whisper"
        ? rng.pick([0.25, 0.5])
        : rng.pick([0, 0.25])
    beat += durationBeats + rest
  }
  return notes
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
  const eligible = pool
    .filter(
      (candidate) =>
        candidate.quality.overallQuality >= 55 &&
        !candidate.collisions.hasBlockingCollision &&
        candidate.notes.length > 0,
    )
    .sort((a, b) => b.quality.overallQuality - a.quality.overallQuality)
  const source = eligible.length >= finalCount ? eligible : pool.filter((candidate) => candidate.notes.length > 0)
  const selected: ReactiveLayerCandidate[] = []
  while (selected.length < finalCount && selected.length < source.length) {
    if (selected.length === 0) {
      selected.push({ ...source[0], selectionReason: "highest-quality" })
      continue
    }
    const remaining = source.filter(
      (candidate) => !selected.some((item) => item.id === candidate.id),
    )
    const next = remaining
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

function buildPoolCandidate(
  input: GenerateCounterInput,
  plan: StylePlan,
  poolIndex: number,
  analysis: MelodyActivityAnalysis,
): ReactiveLayerCandidate {
  const candidateSeed = (input.seed + (poolIndex + 1) * 104_729) >>> 0
  const rng = new SeededRandom(candidateSeed)
  const gaps = availableGaps(analysis, plan.style === "synth-whisper" ? 0.75 : 0.5)
  const gapCount = Math.min(gaps.length, rng.intBetween(plan.gapCount[0], plan.gapCount[1]))
  const selectedGaps = gaps
    .map((gap) => ({
      gap,
      score:
        gap.endBeat / Math.max(1, input.totalBeats) + rng.next() * 0.25,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, gapCount)
    .map(({ gap }) => gap)
    .sort((a, b) => a.startBeat - b.startBeat)
  const notes = selectedGaps.flatMap((gap, index) =>
    generatePhraseInGap(plan, gap, index, { ...input, seed: candidateSeed }, analysis, rng),
  )
  const evaluated = evaluateReactiveLayerQuality(input.melody.notes, notes, analysis, {
    harmonicFit: harmonicFit(notes, input.chords),
    motifRelationship: motifRelationship(input.melody.notes, notes),
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

/** #70 MVP: 9案を独立生成し、品質下限と候補間差を両立する3案を返す。 */
export function generateCounterCandidates(
  input: GenerateCounterInput,
): ReactiveLayerCandidate[] {
  const analysis = analyzeMelodyActivity(input.melody.notes, input.totalBeats)
  const poolSize = Math.max(input.finalCount ?? 3, input.poolSize ?? 9)
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
    poolSize: 9,
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
