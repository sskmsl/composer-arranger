import { allUsablePitchClasses, chordTonePitchClasses, isChordTone, isTensionTone } from "@/core/chord"
import type { MelodyNote, MelodySimilarityBreakdown, PhrasePlan } from "@/core/melody"
import type {
  PhraseCadence,
  PhraseCandidate,
  PhraseHarmonicApproach,
  PhraseIntent,
} from "@/core/phrase"
import type { ChordEvent, SongProfileId } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import { keyScalePitchClasses } from "@/core/scale"
import type { SectionRole } from "@/core/section"
import { pitchClass } from "@/core/note"
import { buildHarmonicMap, chordAtBeat, type HarmonicMapEntry } from "@/melody-engine/harmonicMap"
import { melodySimilarity } from "@/melody-engine/melodySimilarity"
import { nearestAllowedPitch } from "@/melody-engine/pitchUtils"
import type { Density, Drama, RangeSetting } from "@/melody-engine/generationParams"

export interface GeneratePhrasesInput {
  chords: ChordEvent[]
  sectionId: string
  sectionRole: SectionRole
  songProfile: SongProfileId
  density: Density
  drama: Drama
  range: RangeSetting
  key: string
  beatsPerBar: number
  totalBeats: number
  seed: number
  lengthBars?: 2 | 3 | 4
  candidateCount?: number
}

interface BuiltPhrase {
  notes: MelodyNote[]
  intent: PhraseIntent
  phraseLengthBeats: number
  seed: number
  qualityScore: number
}

const FINAL_CANDIDATE_COUNT = 3
const DEFAULT_POOL_SIZE = 12
const QUALITY_FLOOR = 55

const RESOLVING_ROLES = new Set<SectionRole>(["chorus", "grand-chorus", "outro"])
const TENSION_ROLES = new Set<SectionRole>(["verse", "pre-chorus", "c-melody", "bridge", "intro"])

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function rotatePick<T>(rng: SeededRandom, values: readonly T[], poolIndex: number): T {
  const start = Math.floor(rng.next() * values.length)
  return values[(start + poolIndex) % values.length]
}

function availableLengths(input: GeneratePhrasesInput): (2 | 3 | 4)[] {
  const sectionBars = Math.max(1, Math.floor(input.totalBeats / input.beatsPerBar))
  const supported = ([2, 3, 4] as const).filter((bars) => bars <= sectionBars)
  return supported.length > 0 ? [...supported] : [2]
}

function planCadence(rng: SeededRandom, role: SectionRole, poolIndex: number): PhraseCadence {
  void poolIndex
  const options: PhraseCadence[] = ["resolved", "open", "suspended", "carry-forward"]
  const weights = RESOLVING_ROLES.has(role)
    ? [0.56, 0.22, 0.14, 0.08]
    : TENSION_ROLES.has(role)
      ? [0.12, 0.3, 0.32, 0.26]
      : [0.25, 0.3, 0.2, 0.25]
  return rng.weightedPick(options, weights)
}

function planHarmonicApproach(
  rng: SeededRandom,
  map: HarmonicMapEntry[],
  poolIndex: number,
): PhraseHarmonicApproach {
  const hasColor = map.some((entry) => entry.parsed.tensions.length > 0 || entry.parsed.isDominant || entry.parsed.isDiminished)
  const hasCommonTones = map.some((entry) => entry.commonTonesWithNext > 0)
  const options: PhraseHarmonicApproach[] = [
    "chord-anchored",
    ...(hasCommonTones ? (["common-tone"] as const) : []),
    ...(hasColor ? (["tension-release", "anticipatory"] as const) : (["anticipatory"] as const)),
  ]
  return rotatePick(rng, options, poolIndex)
}

function motifFor(
  rng: SeededRandom,
  contour: PhraseIntent["contour"],
  leapAmount: number,
): { intervals: number[]; durations: number[] } {
  const length = rng.intBetween(3, 5)
  const intervals = [0]
  let lastWasLeap: boolean = false
  for (let index = 1; index < length; index++) {
    let direction =
      contour === "ascending"
        ? 1
        : contour === "descending"
          ? -1
          : contour === "arch"
            ? index < length / 2
              ? 1
              : -1
            : contour === "inverted-arch"
              ? index < length / 2
                ? -1
                : 1
              : rng.chance(0.5)
                ? 1
                : -1
    if (lastWasLeap) direction *= -1
    const useLeap: boolean = !lastWasLeap && rng.chance(leapAmount * 0.55)
    const width = useLeap ? rng.pick([3, 4, 5, 7]) : rng.pick([1, 2])
    intervals.push(direction * width)
    lastWasLeap = useLeap
  }

  const durationPalettes = [
    [0.5, 0.5, 1, 0.75, 0.25],
    [0.75, 0.25, 0.5, 1, 0.5],
    [1, 0.5, 0.5, 1.5, 0.5],
  ]
  return { intervals, durations: rng.pick(durationPalettes).slice(0, length) }
}

export function planPhraseIntent(input: GeneratePhrasesInput, seed: number, poolIndex: number): PhraseIntent {
  const rng = new SeededRandom(seed)
  const map = buildHarmonicMap(input.chords)
  const lengths = availableLengths(input)
  const lengthBars = input.lengthBars ?? rotatePick(rng, lengths, poolIndex)
  const contour = rotatePick(
    rng,
    input.sectionRole === "pre-chorus" || input.sectionRole === "grand-chorus"
      ? (["ascending", "arch", "wave", "descending"] as const)
      : (["ascending", "descending", "arch", "inverted-arch", "wave"] as const),
    poolIndex,
  )
  const rhythmCharacter = rotatePick(
    rng,
    input.songProfile === "minimal-tension"
      ? (["breathing", "sustained", "flowing", "syncopated"] as const)
      : (["flowing", "syncopated", "breathing", "sustained"] as const),
    poolIndex * 3,
  )
  const harmonicApproach = planHarmonicApproach(rng, map, poolIndex * 5)
  const cadence = planCadence(rng, input.sectionRole, poolIndex * 7)
  const densityBase = input.density === "sparse" ? 0.35 : input.density === "active" ? 0.78 : 0.56
  const density = clamp01(densityBase + (rng.next() - 0.5) * 0.22)
  const restRatio =
    rhythmCharacter === "breathing"
      ? 0.3 + rng.next() * 0.15
      : rhythmCharacter === "sustained"
        ? 0.18 + rng.next() * 0.12
        : 0.08 + rng.next() * 0.16
  const leapBase = input.drama === "restrained" ? 0.18 : input.drama === "open" ? 0.58 : 0.38
  const leapAmount = clamp01(leapBase + (rng.next() - 0.5) * 0.25)
  const climaxPosition =
    input.sectionRole === "chorus" || input.sectionRole === "grand-chorus"
      ? 0.58 + rng.next() * 0.28
      : 0.28 + rng.next() * 0.48
  const pickupBeats =
    rhythmCharacter === "syncopated"
      ? rng.pick([0.5, 0.75])
      : rhythmCharacter === "breathing" && rng.chance(0.45)
        ? rng.pick([0.5, 1])
        : 0
  const motif = motifFor(rng, contour, leapAmount)

  return {
    lengthBars,
    contour,
    rhythmCharacter,
    harmonicApproach,
    cadence,
    density,
    restRatio,
    leapAmount,
    climaxPosition,
    pickupBeats,
    motifIntervals: motif.intervals,
    motifDurations: motif.durations,
  }
}

function phraseChords(input: GeneratePhrasesInput, phraseLengthBeats: number): ChordEvent[] {
  return input.chords
    .filter((chord) => chord.startBeat < phraseLengthBeats && chord.startBeat + chord.durationBeats > 0)
    .map((chord) => ({
      ...chord,
      startBeat: Math.max(0, chord.startBeat),
      durationBeats: Math.min(phraseLengthBeats, chord.startBeat + chord.durationBeats) - Math.max(0, chord.startBeat),
    }))
}

function nearestPitchForClasses(
  desiredPitch: number,
  pitchClasses: readonly number[],
  range: RangeSetting,
): number {
  return nearestAllowedPitch(desiredPitch, pitchClasses, range)
}

function nearestDistinctPitchForClasses(
  desiredPitch: number,
  pitchClasses: readonly number[],
  range: RangeSetting,
  previousPitch: number,
  preferredDirection: number,
): number {
  const candidates: number[] = []
  for (let pitch = range.low; pitch <= range.high; pitch++) {
    if (pitch !== previousPitch && pitchClasses.includes(pitchClass(pitch))) candidates.push(pitch)
  }
  if (candidates.length === 0) return previousPitch
  return candidates.sort((a, b) => {
    const directionPenaltyA = preferredDirection !== 0 && Math.sign(a - previousPitch) !== preferredDirection ? 2.5 : 0
    const directionPenaltyB = preferredDirection !== 0 && Math.sign(b - previousPitch) !== preferredDirection ? 2.5 : 0
    return Math.abs(a - desiredPitch) + directionPenaltyA - (Math.abs(b - desiredPitch) + directionPenaltyB)
  })[0]
}

function commonPitchClasses(entry: HarmonicMapEntry, next?: HarmonicMapEntry): number[] {
  if (!next) return chordTonePitchClasses(entry.parsed)
  const nextSet = new Set(chordTonePitchClasses(next.parsed))
  return chordTonePitchClasses(entry.parsed).filter((pc) => nextSet.has(pc))
}

function nextMapEntry(map: HarmonicMapEntry[], entry: HarmonicMapEntry): HarmonicMapEntry | undefined {
  const index = map.indexOf(entry)
  return index >= 0 ? map[index + 1] : undefined
}

function roleForPitch(entry: HarmonicMapEntry, pitch: number): MelodyNote["plannedToneRole"] {
  const pc = pitchClass(pitch)
  if (isChordTone(entry.parsed, pc)) return "chord-tone"
  if (isTensionTone(entry.parsed, pc)) return "tension-hold"
  return "passing-tone"
}

function chooseOpeningPitch(
  intent: PhraseIntent,
  entry: HarmonicMapEntry,
  range: RangeSetting,
  keyScale: number[],
  rng: SeededRandom,
): number {
  const center = Math.round(range.low + (range.high - range.low) * (intent.contour === "descending" ? 0.65 : 0.42))
  const chordTones = chordTonePitchClasses(entry.parsed)
  const colorTones = allUsablePitchClasses(entry.parsed).filter((pc) => !chordTones.includes(pc))
  const pool =
    intent.harmonicApproach === "tension-release" && colorTones.length > 0
      ? colorTones
      : intent.harmonicApproach === "anticipatory" && keyScale.length > 0
        ? [...new Set([...chordTones, ...keyScale])]
        : chordTones
  return nearestPitchForClasses(center + rng.pick([-3, 0, 2, 4]), pool, range)
}

function desiredPitchClasses(
  intent: PhraseIntent,
  entry: HarmonicMapEntry,
  nextEntry: HarmonicMapEntry | undefined,
  beat: number,
  strongBeat: boolean,
  keyScale: number[],
): number[] {
  const chordTones = chordTonePitchClasses(entry.parsed)
  const usable = allUsablePitchClasses(entry.parsed)
  const chordEnd = entry.chord.startBeat + entry.chord.durationBeats
  if (intent.harmonicApproach === "common-tone") {
    const common = commonPitchClasses(entry, nextEntry)
    if (common.length > 0 && beat >= chordEnd - 1) return common
  }
  if (intent.harmonicApproach === "anticipatory" && nextEntry && beat >= chordEnd - 0.75) {
    return chordTonePitchClasses(nextEntry.parsed)
  }
  if (intent.harmonicApproach === "tension-release" && !strongBeat) {
    const tensions = usable.filter((pc) => !chordTones.includes(pc))
    if (tensions.length > 0) return tensions
  }
  if (strongBeat || intent.harmonicApproach === "chord-anchored") return chordTones
  // 弱拍ではKey内の経過音・刺繍音も許し、コードごとの最近傍コードトーン列への収束を避ける。
  return keyScale.length > 0 ? [...new Set([...usable, ...keyScale])] : usable
}

function rhythmEvents(intent: PhraseIntent, phraseLengthBeats: number, seed: number): { start: number; duration: number }[] {
  const rng = new SeededRandom(seed ^ 0x52dce729)
  const events: { start: number; duration: number }[] = []
  const endingSpace = intent.cadence === "carry-forward" ? 0 : intent.rhythmCharacter === "breathing" ? 0.75 : 0.25
  const end = Math.max(1, phraseLengthBeats - endingSpace)
  let cursor = intent.pickupBeats
  let motifIndex = 0
  while (cursor < end - 0.1) {
    const cycle = Math.floor(motifIndex / intent.motifDurations.length)
    let duration = intent.motifDurations[motifIndex % intent.motifDurations.length]
    if (intent.rhythmCharacter === "sustained" && cycle % 2 === 1) duration *= 1.5
    if (intent.rhythmCharacter === "syncopated" && motifIndex % 3 === 1) duration = rng.pick([0.25, 0.5, 0.75])
    duration = Math.max(0.25, Math.round(duration * 4) / 4)
    duration = Math.min(duration, end - cursor)
    events.push({ start: cursor, duration })
    cursor += duration
    motifIndex++

    const motifBoundary = motifIndex % intent.motifDurations.length === 0
    const densityGap = (1 - intent.density) * (rng.chance(0.45) ? 0.5 : 0.25)
    const breathGap = motifBoundary && intent.rhythmCharacter === "breathing" ? rng.pick([0.5, 0.75, 1]) : 0
    const syncopatedGap = intent.rhythmCharacter === "syncopated" && rng.chance(0.22) ? 0.25 : 0
    const rest = Math.max(densityGap, breathGap, syncopatedGap)
    if (rng.chance(intent.restRatio + (motifBoundary ? 0.15 : 0))) cursor += rest
  }
  return events
}

function endingPitch(
  intent: PhraseIntent,
  currentPitch: number,
  lastEntry: HarmonicMapEntry,
  followingEntry: HarmonicMapEntry | undefined,
  range: RangeSetting,
): { pitch: number; role: MelodyNote["plannedToneRole"] } {
  const chordTones = chordTonePitchClasses(lastEntry.parsed)
  if (intent.cadence === "resolved") {
    const stable = [lastEntry.parsed.rootPc, ...lastEntry.parsed.tones.filter((tone) => tone.role === "third").map((tone) => tone.pitchClass)]
    return { pitch: nearestPitchForClasses(currentPitch, stable, range), role: "chord-tone" }
  }
  if (intent.cadence === "carry-forward" && followingEntry) {
    return {
      pitch: nearestPitchForClasses(currentPitch, chordTonePitchClasses(followingEntry.parsed), range),
      role: "anticipation",
    }
  }
  const color = allUsablePitchClasses(lastEntry.parsed).filter((pc) => !chordTones.includes(pc))
  if (intent.cadence === "suspended" && color.length > 0) {
    return { pitch: nearestPitchForClasses(currentPitch, color, range), role: "suspension" }
  }
  const openPool = [
    ...lastEntry.parsed.tones.filter((tone) => tone.role === "fifth").map((tone) => tone.pitchClass),
    ...color,
  ]
  const pitch = nearestPitchForClasses(currentPitch, openPool.length > 0 ? openPool : chordTones, range)
  return { pitch, role: color.includes(pitchClass(pitch)) ? "tension-hold" : "chord-tone" }
}

function buildPhrase(input: GeneratePhrasesInput, seed: number, poolIndex: number): BuiltPhrase {
  const intent = planPhraseIntent(input, seed, poolIndex)
  const phraseLengthBeats = Math.min(input.totalBeats, intent.lengthBars * input.beatsPerBar)
  const chords = phraseChords(input, phraseLengthBeats)
  const map = buildHarmonicMap(chords)
  const rng = new SeededRandom(seed ^ 0x9e3779b9)
  const keyScale = keyScalePitchClasses(input.key)
  const events = rhythmEvents(intent, phraseLengthBeats, seed)
  if (map.length === 0 || events.length === 0) {
    return { notes: [], intent, phraseLengthBeats, seed, qualityScore: 0 }
  }

  const firstEntry = chordAtBeat(map, events[0].start) ?? map[0]
  let previousPitch = chooseOpeningPitch(intent, firstEntry, input.range, keyScale, rng)
  let previousInterval = 0
  const notes: MelodyNote[] = []

  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    const entry = chordAtBeat(map, event.start) ?? map[map.length - 1]
    const nextEntry = nextMapEntry(map, entry)
    const motifInterval = intent.motifIntervals[index % intent.motifIntervals.length]
    const developmentCycle = Math.floor(index / intent.motifIntervals.length)
    const transformedInterval =
      developmentCycle % 3 === 1
        ? Math.sign(motifInterval) * Math.max(1, Math.abs(motifInterval) - 1)
        : developmentCycle % 3 === 2
          ? -motifInterval
          : motifInterval
    let desired = index === 0 ? previousPitch : previousPitch + transformedInterval
    if (Math.abs(previousInterval) >= 5) desired = previousPitch - Math.sign(previousInterval) * rng.pick([1, 2])

    const progress = event.start / Math.max(1, phraseLengthBeats)
    const contourDrift =
      intent.contour === "ascending"
        ? 2
        : intent.contour === "descending"
          ? -2
          : intent.contour === "arch"
            ? progress < intent.climaxPosition
              ? 2
              : -2
            : intent.contour === "inverted-arch"
              ? progress < intent.climaxPosition
                ? -2
                : 2
              : 0
    desired += developmentCycle > 0 ? contourDrift : 0

    const beatInBar = ((event.start % input.beatsPerBar) + input.beatsPerBar) % input.beatsPerBar
    const strongBeat =
      Math.abs(beatInBar) < 0.06 ||
      Math.abs(beatInBar - input.beatsPerBar / 2) < 0.06
    const allowed = desiredPitchClasses(intent, entry, nextEntry, event.start, strongBeat, keyScale)
    let placed = nearestPitchForClasses(desired, allowed, input.range)
    const repeatedRun =
      index > 1 && placed === previousPitch && notes[index - 1]?.pitch === notes[index - 2]?.pitch
    if (repeatedRun) {
      placed = nearestDistinctPitchForClasses(
        desired + Math.sign(transformedInterval || contourDrift || 1),
        allowed,
        input.range,
        previousPitch,
        Math.sign(transformedInterval || contourDrift),
      )
    }
    const role =
      intent.harmonicApproach === "anticipatory" &&
      nextEntry &&
      event.start >= entry.chord.startBeat + entry.chord.durationBeats - 0.75 &&
      isChordTone(nextEntry.parsed, pitchClass(placed))
        ? "anticipation"
        : roleForPitch(entry, placed)
    const nextResolutionBeat = Math.min(phraseLengthBeats, event.start + event.duration + 0.5)
    notes.push({
      id: `phrase-${seed}-${index}`,
      startBeat: event.start,
      durationBeats: event.duration,
      pitch: placed,
      velocity: Math.round(72 + (1 - Math.abs(progress - intent.climaxPosition)) * 18 + rng.intBetween(-5, 5)),
      locks: [],
      plannedToneRole: role,
      plannedResolution:
        role === "tension-hold" || role === "passing-tone"
          ? {
              targetPitchClass: nextEntry?.parsed.rootPc ?? entry.parsed.rootPc,
              targetBeat: nextResolutionBeat,
              maximumDelayBeats: 1,
            }
          : undefined,
    })
    previousInterval = placed - previousPitch
    previousPitch = placed
  }

  const articulatedNotes =
    intent.rhythmCharacter === "syncopated"
      ? notes
      : notes.reduce<MelodyNote[]>((result, note) => {
          const previous = result.at(-1)
          if (
            previous &&
            previous.pitch === note.pitch &&
            note.startBeat <= previous.startBeat + previous.durationBeats + 0.05
          ) {
            previous.durationBeats =
              Math.max(previous.startBeat + previous.durationBeats, note.startBeat + note.durationBeats) -
              previous.startBeat
            return result
          }
          result.push(note)
          return result
        }, [])

  if (articulatedNotes.length > 0) {
    const last = articulatedNotes[articulatedNotes.length - 1]
    const lastEntry = chordAtBeat(map, last.startBeat) ?? map[map.length - 1]
    const followingEntry = input.chords.find((chord) => chord.startBeat >= phraseLengthBeats)
    const followingMap = followingEntry ? buildHarmonicMap([followingEntry])[0] : undefined
    const ending = endingPitch(intent, last.pitch, lastEntry, followingMap, input.range)
    last.pitch = ending.pitch
    last.plannedToneRole = ending.role
    last.plannedResolution = undefined
    if (intent.cadence === "carry-forward") {
      last.durationBeats = Math.max(last.durationBeats, Math.min(1.5, phraseLengthBeats - last.startBeat))
    } else if (intent.cadence === "resolved") {
      last.durationBeats = Math.max(last.durationBeats, 1)
    }
  }

  // 非和声音の「解決予定」を抽象値のまま残さず、実際に後続するノートへ結び付ける。
  for (let index = 0; index < articulatedNotes.length - 1; index++) {
    const note = articulatedNotes[index]
    if (note.plannedToneRole !== "passing-tone" && note.plannedToneRole !== "tension-hold") continue
    const next = articulatedNotes[index + 1]
    const nextEntry = chordAtBeat(map, next.startBeat)
    if (
      nextEntry &&
      next.startBeat - (note.startBeat + note.durationBeats) <= 1 &&
      isChordTone(nextEntry.parsed, pitchClass(next.pitch))
    ) {
      note.plannedResolution = {
        targetPitchClass: pitchClass(next.pitch),
        targetBeat: next.startBeat,
        maximumDelayBeats: Math.max(0.25, next.startBeat - note.startBeat),
      }
      note.plannedToneRole =
        Math.abs(next.pitch - note.pitch) === 1 ? "approach-tone" : "appoggiatura"
    }
  }

  return {
    notes: articulatedNotes,
    intent,
    phraseLengthBeats,
    seed,
    qualityScore: scorePhrase(articulatedNotes, intent, map, phraseLengthBeats),
  }
}

function restRatio(notes: MelodyNote[], totalBeats: number): number {
  const sounding = notes.reduce((sum, note) => sum + note.durationBeats, 0)
  return clamp01(1 - sounding / Math.max(1, totalBeats))
}

export function scorePhrase(
  notes: MelodyNote[],
  intent: PhraseIntent,
  map: HarmonicMapEntry[],
  phraseLengthBeats: number,
): number {
  if (notes.length < 4) return 0
  const strongNotes = notes.filter((note) => Math.abs(note.startBeat - Math.round(note.startBeat)) < 0.06)
  const strongFit =
    strongNotes.filter((note) => {
      const entry = chordAtBeat(map, note.startBeat)
      return entry ? isChordTone(entry.parsed, pitchClass(note.pitch)) || isTensionTone(entry.parsed, pitchClass(note.pitch)) : false
    }).length / Math.max(1, strongNotes.length)
  const intervals = notes.slice(1).map((note, index) => note.pitch - notes[index].pitch)
  const leaps = intervals.map((interval, index) => ({ interval, index })).filter(({ interval }) => Math.abs(interval) >= 5)
  const recovered =
    leaps.filter(({ interval, index }) => {
      const next = intervals[index + 1]
      return next !== undefined && Math.sign(next) === -Math.sign(interval) && Math.abs(next) <= 3
    }).length / Math.max(1, leaps.length)
  const pitches = notes.map((note) => note.pitch)
  const range = Math.max(...pitches) - Math.min(...pitches)
  const durationVariety = new Set(notes.map((note) => note.durationBeats)).size
  const actualRestRatio = restRatio(notes, phraseLengthBeats)
  const restFit = 1 - Math.min(1, Math.abs(actualRestRatio - intent.restRatio) / 0.35)
  const densityPerBeat = notes.length / phraseLengthBeats
  const targetDensity = 0.45 + intent.density * 0.8
  const densityFit = 1 - Math.min(1, Math.abs(densityPerBeat - targetDensity) / 0.9)
  const singableRange = range <= 19 ? 1 : Math.max(0, 1 - (range - 19) / 12)
  const cadenceFit =
    intent.cadence === "resolved"
      ? notes.at(-1)?.plannedToneRole === "chord-tone"
        ? 1
        : 0.4
      : notes.at(-1)?.plannedToneRole !== "chord-tone"
        ? 1
        : 0.65
  const score =
    strongFit * 24 +
    (leaps.length === 0 ? 0.85 : recovered) * 15 +
    singableRange * 13 +
    Math.min(1, durationVariety / 3) * 10 +
    restFit * 12 +
    densityFit * 12 +
    cadenceFit * 14
  return Math.round(score * 100) / 100
}

function phrasePlanOf(candidate: BuiltPhrase): PhrasePlan[] {
  const notes = candidate.notes
  const climax =
    notes.length > 0
      ? notes.reduce((best, note) => {
          const target = candidate.phraseLengthBeats * candidate.intent.climaxPosition
          const noteValue = note.pitch - Math.abs(note.startBeat - target) * 0.35
          const bestValue = best.pitch - Math.abs(best.startBeat - target) * 0.35
          return noteValue > bestValue ? note : best
        }, notes[0])
      : undefined
  const restBeats: number[] = []
  let cursor = 0
  for (const note of notes) {
    if (note.startBeat > cursor + 0.05) restBeats.push(cursor)
    cursor = Math.max(cursor, note.startBeat + note.durationBeats)
  }
  return [
    {
      phraseStartBeat: 0,
      phraseLengthBeats: candidate.phraseLengthBeats,
      climaxBeat: climax?.startBeat ?? 0,
      contour: candidate.intent.contour,
      restBeats,
      endTension: candidate.intent.cadence === "resolved" ? 0.1 : candidate.intent.cadence === "open" ? 0.5 : 0.85,
    },
  ]
}

export function phraseSimilarity(
  a: Pick<BuiltPhrase, "notes" | "intent" | "phraseLengthBeats">,
  b: Pick<BuiltPhrase, "notes" | "intent" | "phraseLengthBeats">,
  chords: ChordEvent[],
): MelodySimilarityBreakdown {
  const map = buildHarmonicMap(chords)
  const base = melodySimilarity(
    { notes: a.notes, plans: phrasePlanOf(a as BuiltPhrase) },
    { notes: b.notes, plans: phrasePlanOf(b as BuiltPhrase) },
    map,
  )
  const intentMatches = [
    a.intent.rhythmCharacter === b.intent.rhythmCharacter,
    a.intent.harmonicApproach === b.intent.harmonicApproach,
    a.intent.cadence === b.intent.cadence,
    a.intent.contour === b.intent.contour,
  ].filter(Boolean).length
  const intentSimilarity = intentMatches / 4
  return {
    ...base,
    overallSimilarity: clamp01(base.overallSimilarity * 0.85 + intentSimilarity * 0.15),
  }
}

function selectPool(pool: BuiltPhrase[], chords: ChordEvent[]): {
  candidate: BuiltPhrase
  selectionScore: number
  similarities: MelodySimilarityBreakdown[]
}[] {
  const eligible = pool.filter((candidate) => candidate.qualityScore >= QUALITY_FLOOR)
  const source = eligible.length >= FINAL_CANDIDATE_COUNT ? eligible : [...pool].sort((a, b) => b.qualityScore - a.qualityScore)
  const selected: {
    candidate: BuiltPhrase
    selectionScore: number
    similarities: MelodySimilarityBreakdown[]
  }[] = []
  const remaining = [...source]

  while (selected.length < FINAL_CANDIDATE_COUNT && remaining.length > 0) {
    let bestIndex = 0
    let bestScore = -Infinity
    let bestSimilarities: MelodySimilarityBreakdown[] = []
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index]
      const similarities = selected.map((item) => phraseSimilarity(candidate, item.candidate, chords))
      const diversity = similarities.length === 0 ? 1 : 1 - Math.max(...similarities.map((value) => value.overallSimilarity))
      const score = candidate.qualityScore * 0.68 + diversity * 100 * 0.32
      const intentRedundancy =
        selected.length === 0
          ? 0
          : Math.max(
              ...selected.map((item) => {
                const other = item.candidate.intent
                return (
                  (candidate.intent.rhythmCharacter === other.rhythmCharacter ? 0.45 : 0) +
                  (candidate.intent.contour === other.contour ? 0.25 : 0) +
                  (candidate.intent.harmonicApproach === other.harmonicApproach ? 0.2 : 0) +
                  (candidate.intent.cadence === other.cadence ? 0.1 : 0)
                )
              }),
            )
      const hardSimilarityOk =
        similarities.length === 0 ||
        Math.max(...similarities.map((value) => value.overallSimilarity)) <= (selected.length === 1 ? 0.76 : 0.8)
      const adjusted = (hardSimilarityOk ? score : score - 18) - intentRedundancy * 18
      if (adjusted > bestScore) {
        bestIndex = index
        bestScore = adjusted
        bestSimilarities = similarities
      }
    }
    selected.push({
      candidate: remaining.splice(bestIndex, 1)[0],
      selectionScore: Math.round(bestScore * 100) / 100,
      similarities: bestSimilarities,
    })
  }
  return selected
}

export function generatePhraseCandidates(input: GeneratePhrasesInput): Omit<PhraseCandidate, "id" | "batchId" | "createdAt">[] {
  const poolSize = Math.max(input.candidateCount ?? DEFAULT_POOL_SIZE, FINAL_CANDIDATE_COUNT)
  const pool = Array.from({ length: poolSize }, (_, poolIndex) =>
    buildPhrase(input, input.seed + poolIndex * 7919, poolIndex),
  )
  const selected = selectPool(pool, phraseChords(input, Math.min(input.totalBeats, 4 * input.beatsPerBar)))
  return selected.map(({ candidate, selectionScore, similarities }, index) => ({
    sectionId: input.sectionId,
    name: `Phrase ${index + 1}`,
    seed: candidate.seed,
    notes: candidate.notes,
    intent: candidate.intent,
    phraseLengthBeats: candidate.phraseLengthBeats,
    qualityScore: candidate.qualityScore,
    selectionScore,
    similarityToSelected: similarities,
  }))
}

export function regeneratePhraseCandidate(
  input: GeneratePhrasesInput,
  currentSeed: number,
  avoid: Pick<PhraseCandidate, "notes" | "intent" | "phraseLengthBeats">[],
): Omit<PhraseCandidate, "id" | "batchId" | "createdAt"> {
  const regenerationInput = { ...input, seed: currentSeed + 104729 }
  const pool = Array.from({ length: 8 }, (_, index) =>
    buildPhrase(regenerationInput, regenerationInput.seed + index * 7919, index + 3),
  )
  const eligible = pool.filter((candidate) => candidate.qualityScore >= QUALITY_FLOOR)
  const source = eligible.length > 0 ? eligible : pool
  const ranked = source
    .map((candidate) => {
      const similarities = avoid.map((other) => phraseSimilarity(candidate, other, input.chords))
      const diversity = similarities.length === 0 ? 1 : 1 - Math.max(...similarities.map((value) => value.overallSimilarity))
      return {
        candidate,
        similarities,
        score: candidate.qualityScore * 0.65 + diversity * 100 * 0.35,
      }
    })
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  return {
    sectionId: input.sectionId,
    name: "Regenerated Phrase",
    seed: best.candidate.seed,
    notes: best.candidate.notes,
    intent: best.candidate.intent,
    phraseLengthBeats: best.candidate.phraseLengthBeats,
    qualityScore: best.candidate.qualityScore,
    selectionScore: Math.round(best.score * 100) / 100,
    similarityToSelected: best.similarities,
  }
}
