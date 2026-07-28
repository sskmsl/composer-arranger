import type {
  CandidateMelodyDNA,
  MelodyGeneratorProfile,
  MelodyNote,
  ProfileExpressionPlan,
} from "@/core/melody"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { pitchClass } from "@/core/note"
import { MIN_MELODIC_DURATION_BEATS } from "./motifCore"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"
import { nearestAllowedPitch } from "./pitchUtils"

const SUPPORTED_PROFILES = new Set<MelodyGeneratorProfile>(["chromatic", "cinematic", "leaping"])

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function nearestIndex(notes: MelodyNote[], beat: number, includeEdges = false): number {
  const start = includeEdges ? 0 : 1
  const end = includeEdges ? notes.length : Math.max(start + 1, notes.length - 1)
  let best = start
  for (let index = start + 1; index < end; index++) {
    if (Math.abs(notes[index].startBeat - beat) < Math.abs(notes[best].startBeat - beat)) best = index
  }
  return best
}

function arcFor(
  profile: ProfileExpressionPlan["profile"],
  dna: CandidateMelodyDNA,
): ProfileExpressionPlan["arc"] {
  if (profile === "chromatic") {
    if (dna.harmonicResponse === "delayed-resolution") return "chromatic-neighbor"
    if (dna.harmonicResponse === "anticipatory") return "chromatic-anticipation"
    if (dna.harmonicResponse === "tension-hold") return "chromatic-tension-pedal"
    return "chromatic-suspension"
  }
  if (profile === "cinematic") {
    if (dna.rhythmGrammar === "sustained" && dna.phraseArchitecture === "long-arc") return "cinematic-slow-bloom"
    if (dna.climaxPlan.type === "rhythmic-peak") return "cinematic-breath-before-peak"
    if (dna.registerTrajectory === "falling") return "cinematic-low-reprise"
    return "cinematic-midpoint-surge"
  }
  if (dna.rhythmGrammar === "syncopated") return "leaping-echo"
  if (dna.registerTrajectory === "falling") return "leaping-downward-release"
  if (dna.motifIdentity === "stepwise-cell") return "leaping-delayed-call"
  return "leaping-early-call"
}

export function planProfileExpression(
  profile: MelodyGeneratorProfile | undefined,
  dna: CandidateMelodyDNA | undefined,
  totalBeats: number,
): ProfileExpressionPlan | undefined {
  if (!profile || !dna || !SUPPORTED_PROFILES.has(profile)) return undefined
  const supportedProfile = profile as ProfileExpressionPlan["profile"]
  const arc = arcFor(supportedProfile, dna)
  const focusFraction =
    arc === "leaping-early-call"
      ? 0.3
      : arc === "leaping-delayed-call"
        ? 0.68
        : arc === "cinematic-midpoint-surge"
          ? 0.52
          : arc === "cinematic-breath-before-peak"
            ? dna.climaxPlan.targetFraction
            : dna.climaxPlan.targetFraction
  return {
    profile: supportedProfile,
    arc,
    focusBeat: clamp(totalBeats * focusFraction, 1, Math.max(1, totalBeats - 1)),
  }
}

function pitchClassDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 12
  return Math.min(difference, 12 - difference)
}

function resolvedPair(
  note: MelodyNote,
  next: MelodyNote,
  harmonicMap: HarmonicMapEntry[],
): { dissonance: number; resolution: number } | undefined {
  const entry = chordAtBeat(harmonicMap, note.startBeat)
  const nextEntry = chordAtBeat(harmonicMap, next.startBeat)
  if (!entry || !nextEntry) return undefined
  const currentChordTones = chordTonePitchClasses(entry.parsed)
  const tensions = allUsablePitchClasses(entry.parsed).filter((pc) => !currentChordTones.includes(pc))
  const resolutions = chordTonePitchClasses(nextEntry.parsed)
  const pairs = tensions.flatMap((dissonance) =>
    resolutions
      .filter((resolution) => pitchClassDistance(dissonance, resolution) <= 2)
      .map((resolution) => ({ dissonance, resolution })),
  )
  if (pairs.length > 0) {
    return pairs.reduce((best, pair) =>
      pitchClassDistance(pitchClass(note.pitch), pair.dissonance) <
      pitchClassDistance(pitchClass(note.pitch), best.dissonance)
        ? pair
        : best,
    )
  }
  if (resolutions.length === 0) return undefined
  const resolution = resolutions.reduce((best, candidate) =>
    pitchClassDistance(pitchClass(next.pitch), candidate) < pitchClassDistance(pitchClass(next.pitch), best)
      ? candidate
      : best,
  )
  const lower = (resolution + 11) % 12
  const upper = (resolution + 1) % 12
  return {
    dissonance:
      pitchClassDistance(pitchClass(note.pitch), lower) <= pitchClassDistance(pitchClass(note.pitch), upper)
        ? lower
        : upper,
    resolution,
  }
}

function applyChromaticResolution(
  notes: MelodyNote[],
  focusBeat: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  role: "approach-tone" | "appoggiatura",
): void {
  if (notes.length < 3) return
  const indexes = Array.from({ length: notes.length - 2 }, (_value, index) => index + 1).sort(
    (a, b) => Math.abs(notes[a].startBeat - focusBeat) - Math.abs(notes[b].startBeat - focusBeat),
  )
  for (const index of indexes) {
    const note = notes[index]
    const next = notes[index + 1]
    const pair = resolvedPair(note, next, harmonicMap)
    if (!pair) continue
    note.pitch = nearestAllowedPitch(note.pitch, [pair.dissonance], range)
    next.pitch = nearestAllowedPitch(note.pitch, [pair.resolution], range)
    note.durationBeats = Math.min(role === "appoggiatura" ? 1.25 : 0.75, Math.max(0.25, next.startBeat - note.startBeat))
    note.plannedToneRole = role
    note.plannedResolution = {
      targetPitchClass: pair.resolution,
      targetBeat: next.startBeat,
      maximumDelayBeats: Math.max(0.75, next.startBeat - note.startBeat),
    }
    next.plannedToneRole = "chord-tone"
    next.plannedResolution = undefined
    return
  }
}

function harmonicBoundaryNear(
  harmonicMap: HarmonicMapEntry[],
  focusBeat: number,
  totalBeats: number,
): number | undefined {
  const boundaries = harmonicMap
    .map((entry) => entry.chord.startBeat)
    .filter((beat) => beat > 0.5 && beat < totalBeats - 0.5)
  if (boundaries.length === 0) return undefined
  return boundaries.reduce((best, beat) => (Math.abs(beat - focusBeat) < Math.abs(best - focusBeat) ? beat : best))
}

function applyChromaticBoundary(
  notes: MelodyNote[],
  plan: ProfileExpressionPlan,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
): void {
  const boundary = harmonicBoundaryNear(harmonicMap, plan.focusBeat, totalBeats)
  if (boundary === undefined) return
  const afterIndex = notes.findIndex((note) => note.startBeat >= boundary)
  if (afterIndex <= 0) return
  const before = notes[afterIndex - 1]
  const after = notes[afterIndex]
  const currentEntry = chordAtBeat(harmonicMap, Math.max(0, boundary - 0.01))
  const nextEntry = chordAtBeat(harmonicMap, boundary + 0.01)
  if (!currentEntry || !nextEntry) return

  if (plan.arc === "chromatic-anticipation") {
    const nextChordTones = chordTonePitchClasses(nextEntry.parsed)
    const targetPitch = nearestAllowedPitch(before.pitch, nextChordTones, range)
    before.startBeat = Math.max(0, boundary - 0.75)
    before.durationBeats = 0.75
    before.pitch = targetPitch
    before.plannedToneRole = "anticipation"
    before.plannedResolution = {
      targetPitchClass: pitchClass(targetPitch),
      targetBeat: after.startBeat,
      maximumDelayBeats: Math.max(0.75, after.startBeat - before.startBeat),
    }
    after.pitch = nearestAllowedPitch(targetPitch, [pitchClass(targetPitch)], range)
    after.plannedToneRole = "chord-tone"
    return
  }

  const currentChordTones = chordTonePitchClasses(currentEntry.parsed)
  const nextChordTones = chordTonePitchClasses(nextEntry.parsed)
  const pairs = currentChordTones.flatMap((held) =>
    nextChordTones
      .filter((resolution) => pitchClassDistance(held, resolution) <= 2 && held !== resolution)
      .map((resolution) => ({ held, resolution })),
  )
  if (pairs.length === 0) {
    applyChromaticResolution(notes, plan.focusBeat, harmonicMap, range, "appoggiatura")
    return
  }
  const pair = pairs[0]
  before.pitch = nearestAllowedPitch(before.pitch, [pair.held], range)
  before.durationBeats = Math.max(0.5, after.startBeat - before.startBeat)
  before.plannedToneRole = "suspension"
  before.plannedResolution = {
    targetPitchClass: pair.resolution,
    targetBeat: after.startBeat,
    maximumDelayBeats: Math.max(1, after.startBeat - boundary),
  }
  after.pitch = nearestAllowedPitch(before.pitch, [pair.resolution], range)
  after.plannedToneRole = "chord-tone"
}

function applyChromaticPedal(
  notes: MelodyNote[],
  plan: ProfileExpressionPlan,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
): void {
  if (notes.length < 2) return
  const index = nearestIndex(notes, plan.focusBeat)
  const note = notes[index]
  const next = notes[index + 1]
  const entry = chordAtBeat(harmonicMap, note.startBeat)
  if (!entry) return
  const chordTones = chordTonePitchClasses(entry.parsed)
  const tensions = allUsablePitchClasses(entry.parsed).filter((pc) => !chordTones.includes(pc))
  if (tensions.length === 0) {
    applyChromaticResolution(notes, plan.focusBeat, harmonicMap, range, "appoggiatura")
    return
  }
  note.pitch = nearestAllowedPitch(note.pitch, tensions, range)
  note.durationBeats = Math.min(2, Math.max(0.75, next.startBeat - note.startBeat))
  note.velocity = Math.max(note.velocity, 91)
  note.plannedToneRole = "tension-hold"
  note.plannedResolution = undefined
}

function applyChromatic(
  notes: MelodyNote[],
  plan: ProfileExpressionPlan,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
): void {
  if (plan.arc === "chromatic-neighbor") {
    applyChromaticResolution(notes, plan.focusBeat, harmonicMap, range, "approach-tone")
  } else if (plan.arc === "chromatic-tension-pedal") {
    applyChromaticPedal(notes, plan, harmonicMap, range)
  } else {
    applyChromaticBoundary(notes, plan, harmonicMap, range, totalBeats)
  }
}

function shiftOctaveIntoRange(pitch: number, direction: -1 | 1, range: RangeSetting): number {
  const shifted = pitch + direction * 12
  return shifted >= range.low && shifted <= range.high ? shifted : pitch
}

function applyCinematic(
  notes: MelodyNote[],
  plan: ProfileExpressionPlan,
  range: RangeSetting,
  totalBeats: number,
): void {
  if (notes.length === 0) return
  const focusIndex = nearestIndex(notes, plan.focusBeat, true)
  if (plan.arc === "cinematic-slow-bloom") {
    notes.forEach((note) => {
      const progress = note.startBeat / Math.max(1, totalBeats)
      note.velocity = Math.round(clamp(62 + progress * 35, 58, 100))
      if (progress < 0.4) note.pitch = shiftOctaveIntoRange(note.pitch, -1, range)
    })
    notes[focusIndex].velocity = 104
    return
  }
  if (plan.arc === "cinematic-midpoint-surge") {
    notes.forEach((note) => {
      const distance = Math.abs(note.startBeat - plan.focusBeat) / Math.max(1, totalBeats)
      note.velocity = Math.round(clamp(98 - distance * 80, 62, 102))
    })
    notes[focusIndex].durationBeats = Math.max(notes[focusIndex].durationBeats, 1.5)
    notes[focusIndex].velocity = 106
    return
  }
  if (plan.arc === "cinematic-breath-before-peak") {
    const silenceStart = Math.max(0, plan.focusBeat - 1.25)
    for (let index = notes.length - 1; index >= 0; index--) {
      const note = notes[index]
      if (note.startBeat >= silenceStart && note.startBeat < plan.focusBeat && notes.length > 3) notes.splice(index, 1)
      else if (note.startBeat < silenceStart && note.startBeat + note.durationBeats > silenceStart) {
        note.durationBeats = Math.max(0.2, silenceStart - note.startBeat)
      }
    }
    const arrivalIndex = nearestIndex(notes, plan.focusBeat, true)
    notes[arrivalIndex].velocity = 106
    return
  }
  notes.forEach((note) => {
    if (note.startBeat >= totalBeats * 0.68) {
      note.pitch = shiftOctaveIntoRange(note.pitch, -1, range)
      note.velocity = Math.max(62, note.velocity - 8)
    }
  })
  const last = notes[notes.length - 1]
  last.durationBeats = Math.min(Math.max(last.durationBeats, 1.75), totalBeats - last.startBeat)
}

function leapPair(
  previous: MelodyNote,
  target: MelodyNote,
  recovery: MelodyNote,
  direction: -1 | 1,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
): { targetPitch: number; recoveryPitch: number } | undefined {
  const targetEntry = chordAtBeat(harmonicMap, target.startBeat)
  const recoveryEntry = chordAtBeat(harmonicMap, recovery.startBeat)
  if (!targetEntry || !recoveryEntry) return undefined
  const targetClasses = allUsablePitchClasses(targetEntry.parsed)
  const recoveryClasses = chordTonePitchClasses(recoveryEntry.parsed)
  const pairs: { targetPitch: number; recoveryPitch: number; score: number }[] = []
  for (let targetPitch = range.low; targetPitch <= range.high; targetPitch++) {
    if (!targetClasses.includes(pitchClass(targetPitch))) continue
    const leap = targetPitch - previous.pitch
    if (Math.abs(leap) < 7 || Math.sign(leap) !== direction) continue
    for (let recoveryPitch = range.low; recoveryPitch <= range.high; recoveryPitch++) {
      if (!recoveryClasses.includes(pitchClass(recoveryPitch))) continue
      if (Math.abs(recoveryPitch - targetPitch) > 2) continue
      pairs.push({
        targetPitch,
        recoveryPitch,
        score: Math.abs(targetPitch - target.pitch) + Math.abs(recoveryPitch - recovery.pitch),
      })
    }
  }
  if (pairs.length === 0) return undefined
  return pairs.reduce((best, pair) => (pair.score < best.score ? pair : best))
}

function applyLeapGesture(
  notes: MelodyNote[],
  focusBeat: number,
  direction: -1 | 1,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
): void {
  if (notes.length < 3) return
  const indexes = Array.from({ length: notes.length - 2 }, (_value, index) => index + 1).sort(
    (a, b) => Math.abs(notes[a].startBeat - focusBeat) - Math.abs(notes[b].startBeat - focusBeat),
  )
  for (const index of indexes) {
    const previous = notes[index - 1]
    const target = notes[index]
    const recovery = notes[index + 1]
    const pair = leapPair(previous, target, recovery, direction, harmonicMap, range)
    if (!pair) continue
    target.pitch = pair.targetPitch
    target.velocity = Math.max(target.velocity, 96)
    const entry = chordAtBeat(harmonicMap, target.startBeat)
    const chordTones = entry ? chordTonePitchClasses(entry.parsed) : []
    target.plannedToneRole = chordTones.includes(pitchClass(target.pitch)) ? "chord-tone" : "appoggiatura"
    recovery.pitch = pair.recoveryPitch
    recovery.plannedToneRole = "chord-tone"
    if (target.plannedToneRole === "appoggiatura") {
      target.plannedResolution = {
        targetPitchClass: pitchClass(recovery.pitch),
        targetBeat: recovery.startBeat,
        maximumDelayBeats: Math.max(0.75, recovery.startBeat - target.startBeat),
      }
    } else {
      target.plannedResolution = undefined
    }
    return
  }
}

function applyLeaping(
  notes: MelodyNote[],
  plan: ProfileExpressionPlan,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
): void {
  if (plan.arc === "leaping-downward-release") {
    applyLeapGesture(notes, plan.focusBeat, -1, harmonicMap, range)
    applyLeapGesture(notes, totalBeats * 0.48, 1, harmonicMap, range)
  } else if (plan.arc === "leaping-echo") {
    applyLeapGesture(notes, totalBeats * 0.34, 1, harmonicMap, range)
    applyLeapGesture(notes, totalBeats * 0.66, -1, harmonicMap, range)
  } else {
    applyLeapGesture(notes, plan.focusBeat, 1, harmonicMap, range)
    applyLeapGesture(notes, totalBeats * 0.56, -1, harmonicMap, range)
  }
}

function normalizeMonophonic(notes: MelodyNote[], totalBeats: number): MelodyNote[] {
  const candidates = notes
    .filter((note) => note.startBeat <= totalBeats - MIN_MELODIC_DURATION_BEATS)
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  // Profile表現の局所変形で近接しすぎたアタックは、直前音を極端に短くせず後続側を省く。
  // これによりモノフォニック性と最小可聴音価を同時に保つ。
  const sorted: MelodyNote[] = []
  for (const note of candidates) {
    const previous = sorted[sorted.length - 1]
    if (previous && note.startBeat - previous.startBeat < MIN_MELODIC_DURATION_BEATS - 1e-6) continue
    sorted.push(note)
  }
  for (let index = 0; index < sorted.length; index++) {
    const note = sorted[index]
    const next = sorted[index + 1]
    const available = Math.min(totalBeats, next?.startBeat ?? totalBeats) - note.startBeat
    note.durationBeats = Math.max(MIN_MELODIC_DURATION_BEATS, Math.min(note.durationBeats, available))
  }
  return sorted
}

export function applyProfileExpression(
  source: MelodyNote[],
  plan: ProfileExpressionPlan | undefined,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
): MelodyNote[] {
  if (!plan || source.length === 0) return source
  const notes = source.map((note) => ({
    ...note,
    plannedResolution: note.plannedResolution ? { ...note.plannedResolution } : undefined,
  }))
  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  if (plan.profile === "chromatic") applyChromatic(notes, plan, harmonicMap, range, totalBeats)
  else if (plan.profile === "cinematic") applyCinematic(notes, plan, range, totalBeats)
  else applyLeaping(notes, plan, harmonicMap, range, totalBeats)
  return normalizeMonophonic(notes, totalBeats)
}
