/**
 * Elegiac Cantabile dedicated generator
 *
 * Generation order:
 * Motif Seed → Phrase Architecture → macro target tones → motif development
 * → Climax → Ending.
 *
 * Notes are deliberately not interpolated between harmonic anchors. Harmony is
 * read at two-to-four-bar structural targets and at intentional resolutions;
 * the melodic surface is derived from the motif seed.
 */
import type {
  CandidateMelodyDNA,
  ElegiacClimaxType,
  ElegiacDevelopmentOperation,
  ElegiacEndingStrategy,
  ElegiacGenerationPlan,
  MelodyNote,
  MelodyOpeningPlan,
  PhraseContour,
  PhrasePlan,
  PlannedToneRole,
  SongMotifDNA,
} from "@/core/melody"
import type { SeededRandom } from "@/core/rng"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { pitchClass } from "@/core/note"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"
import { openingDirectionSign, openingStartMidi } from "./openingIntent"
import { nearestAllowedPitch } from "./pitchUtils"

const PHRASE_LENGTH_BY_ARCHITECTURE: Record<CandidateMelodyDNA["phraseArchitecture"], number> = {
  "call-response": 12,
  asymmetric: 14,
  balanced: 16,
  "long-arc": 18,
  cyclic: 12,
}

const DEVELOPMENT_BY_DNA: Record<
  CandidateMelodyDNA["developmentStrategy"],
  ElegiacDevelopmentOperation[]
> = {
  "literal-return": ["repeat", "delayed-return", "repeat"],
  sequence: ["repeat", "expansion", "delayed-return"],
  fragmentation: ["fragmentation", "repeat", "delayed-return"],
  augmentation: ["expansion", "fragmentation", "delayed-return"],
  "delayed-return": ["fragmentation", "delayed-return", "repeat"],
}

const CLIMAX_BY_MOTIF: Record<CandidateMelodyDNA["motifIdentity"], ElegiacClimaxType> = {
  "stepwise-cell": "longest-note",
  "leap-recovery": "leap",
  "chromatic-cell": "tension",
  "turn-cell": "silence",
  "repeated-cell": "low-return",
}

const ENDING_BY_MOTIF: Record<CandidateMelodyDNA["motifIdentity"], ElegiacEndingStrategy> = {
  "stepwise-cell": "suspended",
  "leap-recovery": "carry-over",
  "chromatic-cell": "resolved",
  "turn-cell": "open",
  "repeated-cell": "open",
}

export interface ElegiacGenerationResult {
  notes: MelodyNote[]
  phrasePlans: PhrasePlan[]
  plan: ElegiacGenerationPlan
}

interface MotifEvent {
  interval: number
  duration: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function buildPhraseLengths(totalBeats: number, dna: CandidateMelodyDNA): number[] {
  const primary = PHRASE_LENGTH_BY_ARCHITECTURE[dna.phraseArchitecture]
  const secondary =
    dna.phraseArchitecture === "asymmetric"
      ? 12
      : dna.phraseArchitecture === "call-response"
        ? 14
        : dna.phraseArchitecture === "long-arc"
          ? 16
          : primary
  const lengths: number[] = []
  let cursor = 0
  let index = 0
  while (cursor < totalBeats - 0.01) {
    const planned = index % 2 === 0 ? primary : secondary
    const remaining = totalBeats - cursor
    if (remaining < 4 && lengths.length > 0) {
      lengths[lengths.length - 1] += remaining
      break
    }
    const length = Math.min(planned, remaining)
    lengths.push(length)
    cursor += length
    index++
  }
  return lengths
}

function motifLength(dna: CandidateMelodyDNA): number {
  switch (dna.motifIdentity) {
    case "leap-recovery":
      return 3
    case "turn-cell":
      return 5
    case "chromatic-cell":
      return 4
    case "repeated-cell":
      return 2
    case "stepwise-cell":
      return 4
  }
}

function buildMotifSeed(
  rng: SeededRandom,
  opening: MelodyOpeningPlan | undefined,
  dna: CandidateMelodyDNA,
  songDNA: SongMotifDNA | undefined,
): ElegiacGenerationPlan["motifSeed"] {
  const length = clamp(motifLength(dna) + (rng.chance(0.24) ? rng.jitter() : 0), 2, 5)
  const sign = opening ? openingDirectionSign(opening) || (rng.chance(0.5) ? 1 : -1) : rng.chance(0.5) ? 1 : -1
  let intervals: number[]
  switch (dna.motifIdentity) {
    case "repeated-cell":
      intervals = [0, 0, sign * 2, 0]
      break
    case "leap-recovery":
      intervals = [0, sign * rng.pick([5, 7]), sign * rng.pick([2, 3]), 0]
      break
    case "turn-cell":
      intervals = [0, sign * 2, 0, -sign * 2, 0]
      break
    case "chromatic-cell":
      intervals = [0, sign, sign * 3, sign * 2, 0]
      break
    case "stepwise-cell":
      intervals = [0, sign * 2, sign * 3, sign * 2, 0]
      break
  }
  intervals = intervals.slice(0, length)
  if (opening?.intent.entryType === "repeated-note" && intervals.length > 1) intervals[1] = 0
  if (opening?.intent.entryType === "leap-entry" && intervals.length > 1) intervals[1] = sign * 5
  if (songDNA?.intervalCells.length && intervals.length > 2 && rng.chance(0.35)) {
    const characteristic = clamp(Math.round(rng.pick(songDNA.intervalCells)), -5, 5)
    intervals[intervals.length - 2] = characteristic
  }

  const sustained = dna.rhythmGrammar === "sustained"
  const durationPalette = sustained ? [1, 1.5, 2, 3] : [0.5, 0.75, 1, 1.5, 2]
  const durations = intervals.map((_, index) =>
    index === 0 && opening ? opening.firstNoteDuration : rng.pick(durationPalette),
  )
  return { intervals, durations }
}

function breathFraction(dna: CandidateMelodyDNA, phraseIndex: number): number {
  const base =
    dna.phraseArchitecture === "asymmetric"
      ? 0.38
      : dna.phraseArchitecture === "call-response"
        ? 0.5
        : dna.phraseArchitecture === "long-arc"
          ? 0.68
          : dna.phraseArchitecture === "cyclic"
            ? 0.32
            : 0.57
  return clamp(base + (phraseIndex % 2 === 0 ? 0 : -0.12), 0.25, 0.78)
}

function buildBreaths(
  phraseLengths: number[],
  opening: MelodyOpeningPlan | undefined,
  dna: CandidateMelodyDNA,
): number[] {
  const breaths: number[] = []
  let start = 0
  phraseLengths.forEach((length, index) => {
    const structural = start + length * breathFraction(dna, index)
    breaths.push(structural)
    if (index === 0 && opening) {
      const openingBreath = start + opening.startBeatOffset + opening.openingPhraseLengthBeats
      if (openingBreath > start + 1 && openingBreath < start + length - 1) breaths.push(openingBreath)
    }
    start += length
  })
  return unique(breaths.map((beat) => Math.round(beat * 4) / 4)).sort((a, b) => a - b)
}

function buildTargetTones(
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  dna: CandidateMelodyDNA,
): ElegiacGenerationPlan["targetTones"] {
  const span = dna.phraseArchitecture === "long-arc" ? 16 : dna.phraseArchitecture === "asymmetric" ? 12 : 8
  const targets: ElegiacGenerationPlan["targetTones"] = []
  const mid = Math.round((range.low + range.high) / 2)
  for (let beat = Math.min(span, totalBeats); beat <= totalBeats + 0.01; beat += span) {
    const probe = Math.min(totalBeats - 0.01, beat)
    const entry = chordAtBeat(harmonicMap, probe)
    if (!entry) continue
    const chordTones = chordTonePitchClasses(entry.parsed)
    const usable = allUsablePitchClasses(entry.parsed)
    const preferred =
      dna.harmonicResponse === "tension-hold" || dna.harmonicResponse === "delayed-resolution"
        ? usable.filter((pc) => !chordTones.includes(pc))
        : chordTones
    const pitch = nearestAllowedPitch(mid, preferred.length > 0 ? preferred : chordTones, range)
    targets.push({ beat: probe, pitchClass: pitchClass(pitch) })
  }
  return targets
}

function transformMotif(
  seed: ElegiacGenerationPlan["motifSeed"],
  operation: ElegiacDevelopmentOperation,
  occurrence: number,
): MotifEvent[] {
  let intervals = [...seed.intervals]
  let durations = [...seed.durations]
  if (operation === "fragmentation") {
    const length = Math.max(2, Math.ceil(intervals.length / 2))
    intervals = intervals.slice(0, length)
    durations = durations.slice(0, length)
  } else if (operation === "expansion") {
    intervals = intervals.map((interval, index) =>
      index === 0 ? 0 : Math.sign(interval) * Math.max(1, Math.round(Math.abs(interval) * 1.45)),
    )
    durations = durations.map((duration) => Math.min(3, duration * 1.35))
  }
  const sequenceOffset = operation === "repeat" ? 0 : occurrence % 2 === 0 ? 2 : -2
  return intervals.map((interval, index) => ({
    interval: interval + sequenceOffset,
    duration: durations[index],
  }))
}

function fitMelodicPitch(
  desired: number,
  beat: number,
  range: RangeSetting,
  harmonicMap: HarmonicMapEntry[],
): { pitch: number; role: PlannedToneRole } {
  let pitch = desired
  while (pitch < range.low) pitch += 12
  while (pitch > range.high) pitch -= 12
  pitch = clamp(Math.round(pitch), range.low, range.high)
  const entry = chordAtBeat(harmonicMap, beat)
  if (!entry) return { pitch, role: "passing-tone" }
  const chordTones = chordTonePitchClasses(entry.parsed)
  const usable = allUsablePitchClasses(entry.parsed)
  const pc = pitchClass(pitch)
  if (chordTones.includes(pc)) return { pitch, role: "chord-tone" }
  if (usable.includes(pc)) return { pitch, role: "passing-tone" }
  // Weak-beat steps are meaningful passing/neighbor tones. Only a hard,
  // sustained strong-beat conflict is corrected later by the resolution step.
  return { pitch, role: "passing-tone" }
}

function isStrongBeat(beat: number): boolean {
  return Math.abs(beat - Math.round(beat)) < 0.06
}

function nearestPitchWithContour(
  desired: number,
  allowedPitchClasses: number[],
  range: RangeSetting,
  previous: MelodyNote | undefined,
  next: MelodyNote | undefined,
): number {
  const candidates: number[] = []
  for (let pitch = range.low; pitch <= range.high; pitch++) {
    if (allowedPitchClasses.includes(pitchClass(pitch))) candidates.push(pitch)
  }
  if (candidates.length === 0) return clamp(Math.round(desired), range.low, range.high)
  const incomingDirection = previous ? Math.sign(desired - previous.pitch) : 0
  const outgoingDirection = next ? Math.sign(next.pitch - desired) : 0
  return candidates.reduce((best, candidate) => {
    const bestIncoming = previous ? Math.sign(best - previous.pitch) : 0
    const candidateIncoming = previous ? Math.sign(candidate - previous.pitch) : 0
    const bestOutgoing = next ? Math.sign(next.pitch - best) : 0
    const candidateOutgoing = next ? Math.sign(next.pitch - candidate) : 0
    const bestPenalty =
      Math.abs(best - desired) +
      (incomingDirection !== 0 && bestIncoming !== incomingDirection ? 3 : 0) +
      (outgoingDirection !== 0 && bestOutgoing !== outgoingDirection ? 2 : 0)
    const candidatePenalty =
      Math.abs(candidate - desired) +
      (incomingDirection !== 0 && candidateIncoming !== incomingDirection ? 3 : 0) +
      (outgoingDirection !== 0 && candidateOutgoing !== outgoingDirection ? 2 : 0)
    return candidatePenalty < bestPenalty ? candidate : best
  })
}

/**
 * Profileの歌唱線を残しながら、聴感上露出する音だけを和声検証する。
 * 弱拍の短い非和声音は、直後に順次解決する場合だけ保持する。
 */
function harmonizeExposedNotes(
  notes: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
): void {
  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index]
    const previous = notes[index - 1]
    const next = notes[index + 1]
    const entry = chordAtBeat(harmonicMap, note.startBeat)
    if (!entry) continue
    const chordTones = chordTonePitchClasses(entry.parsed)
    const usable = allUsablePitchClasses(entry.parsed)
    const pc = pitchClass(note.pitch)
    if (chordTones.includes(pc)) {
      note.plannedToneRole = "chord-tone"
      continue
    }

    const nextEntry = next ? chordAtBeat(harmonicMap, next.startBeat) : undefined
    const nextUsable = nextEntry ? allUsablePitchClasses(nextEntry.parsed) : []
    const resolvesByStep =
      Boolean(next) &&
      next!.startBeat - (note.startBeat + note.durationBeats) <= 0.8 &&
      Math.abs(next!.pitch - note.pitch) <= 2 &&
      nextUsable.includes(pitchClass(next!.pitch))
    const intentionalDissonance =
      note.plannedResolution !== undefined &&
      (note.plannedToneRole === "suspension" || note.plannedToneRole === "appoggiatura")
    const exposed = isStrongBeat(note.startBeat) || note.durationBeats >= 1.25

    if (!exposed && note.durationBeats <= 1 && resolvesByStep) {
      note.plannedToneRole = usable.includes(pc) ? "approach-tone" : "passing-tone"
      note.plannedResolution = {
        targetPitchClass: pitchClass(next!.pitch),
        targetBeat: next!.startBeat,
        maximumDelayBeats: Math.max(0.5, next!.startBeat - note.startBeat),
      }
      continue
    }
    if (intentionalDissonance && resolvesByStep) {
      note.plannedResolution = {
        targetPitchClass: pitchClass(next!.pitch),
        targetBeat: next!.startBeat,
        maximumDelayBeats: Math.max(0.5, next!.startBeat - note.startBeat),
      }
      continue
    }
    if (usable.includes(pc) && !exposed) {
      note.plannedToneRole = "approach-tone"
      continue
    }

    // 強拍・長音では曖昧なテンションより歌唱的なコードトーンを優先する。
    // contour penaltyを含む局所探索により、Motifの進行方向は可能な限り維持する。
    note.pitch = nearestPitchWithContour(note.pitch, chordTones, range, previous, next)
    note.plannedToneRole = "chord-tone"
    note.plannedResolution = undefined
  }
}

function makeNote(
  rng: SeededRandom,
  startBeat: number,
  durationBeats: number,
  pitch: number,
  role: PlannedToneRole,
): MelodyNote {
  return {
    id: crypto.randomUUID(),
    startBeat,
    durationBeats,
    pitch,
    velocity: 70 + rng.intBetween(0, 8),
    locks: [],
    plannedToneRole: role,
  }
}

function nextTargetAnchor(
  currentPitch: number,
  currentBeat: number,
  plan: ElegiacGenerationPlan,
  range: RangeSetting,
): number {
  const target = plan.targetTones.find((tone) => tone.beat >= currentBeat - 0.01)
  return target ? nearestAllowedPitch(currentPitch, [target.pitchClass], range) : currentPitch
}

function generatePhrase(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  phraseStart: number,
  phraseLength: number,
  phraseIndex: number,
  range: RangeSetting,
  noteDensity: number,
  opening: MelodyOpeningPlan | undefined,
  plan: ElegiacGenerationPlan,
): MelodyNote[] {
  const phraseEnd = phraseStart + phraseLength
  const rests = plan.breathBeats.filter((beat) => beat > phraseStart && beat < phraseEnd)
  const notes: MelodyNote[] = []
  let cursor = phraseStart + (phraseIndex === 0 && opening ? opening.startBeatOffset : 0)
  let anchor =
    phraseIndex === 0 && opening
      ? openingStartMidi(opening, range)
      : nextTargetAnchor(Math.round((range.low + range.high) / 2), phraseStart, plan, range)
  let occurrence = 0
  let breathIndex = 0
  const densityRest = clamp(0.7 + (1 - noteDensity) * 0.8, 0.65, 1.3)

  while (cursor < phraseEnd - 0.2) {
    const breath = rests[breathIndex]
    if (breath !== undefined && cursor >= breath - 0.6) {
      cursor = Math.max(cursor, breath + densityRest)
      breathIndex++
      if (cursor >= phraseEnd - 0.2) break
    }
    const operation = plan.development[occurrence % plan.development.length]
    if (operation === "delayed-return" && occurrence > 0) cursor += 0.75 + densityRest * 0.5
    if (cursor >= phraseEnd - 0.2) break
    const events = transformMotif(plan.motifSeed, operation, occurrence)
    anchor = nextTargetAnchor(anchor, cursor, plan, range)
    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
      if (cursor >= phraseEnd - 0.1) break
      const event = events[eventIndex]
      const duration =
        phraseIndex === 0 && occurrence === 0 && eventIndex === 0 && opening
          ? opening.firstNoteDuration
          : event.duration
      const fitted = fitMelodicPitch(anchor + event.interval, cursor, range, harmonicMap)
      const clippedDuration = Math.min(duration, phraseEnd - cursor)
      const note = makeNote(rng, cursor, Math.max(0.2, clippedDuration), fitted.pitch, fitted.role)
      if (phraseIndex === 0 && occurrence === 0 && eventIndex === 0 && opening?.intent.entryType === "suspension") {
        note.plannedToneRole = "suspension"
      }
      notes.push(note)
      cursor += clippedDuration
      const nextBreath = rests[breathIndex]
      if (nextBreath !== undefined && cursor >= nextBreath - 0.2) break
    }
    const last = notes[notes.length - 1]
    if (last) anchor = last.pitch
    cursor += operation === "fragmentation" ? 0.5 : 0.25
    occurrence++
  }
  return notes
}

function nearestNoteIndex(notes: MelodyNote[], beat: number): number {
  let best = 0
  for (let i = 1; i < notes.length; i++) {
    if (Math.abs(notes[i].startBeat - beat) < Math.abs(notes[best].startBeat - beat)) best = i
  }
  return best
}

function applyClimax(
  notes: MelodyNote[],
  plan: ElegiacGenerationPlan,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
): void {
  if (notes.length === 0) return
  let index = nearestNoteIndex(notes.slice(0, Math.max(1, notes.length - 1)), plan.climaxBeat)
  const note = notes[index]
  note.velocity = Math.max(note.velocity, 94)
  if (plan.climaxType === "longest-note") {
    const desiredEnd = Math.min(totalBeats, note.startBeat + 3)
    while (notes[index + 1] && notes[index + 1].startBeat < desiredEnd) notes.splice(index + 1, 1)
    note.durationBeats = Math.max(note.durationBeats, desiredEnd - note.startBeat)
  } else if (plan.climaxType === "leap") {
    const previous = notes[index - 1]
    const sign = previous && previous.pitch > (range.low + range.high) / 2 ? -1 : 1
    note.pitch = clamp((previous?.pitch ?? note.pitch) + sign * 7, range.low, range.high)
    note.plannedToneRole = "appoggiatura"
    const next = notes[index + 1]
    if (next) {
      next.pitch = clamp(note.pitch - sign * 2, range.low, range.high)
      note.plannedResolution = {
        targetPitchClass: pitchClass(next.pitch),
        targetBeat: next.startBeat,
        maximumDelayBeats: Math.max(0.5, next.startBeat - note.startBeat),
      }
    }
  } else if (plan.climaxType === "tension") {
    const entry = chordAtBeat(harmonicMap, note.startBeat)
    if (entry) {
      const chordTones = chordTonePitchClasses(entry.parsed)
      const tensions = allUsablePitchClasses(entry.parsed).filter((pc) => !chordTones.includes(pc))
      if (tensions.length > 0) note.pitch = nearestAllowedPitch(note.pitch, tensions, range)
    }
    note.plannedToneRole = "appoggiatura"
    const next = notes[index + 1]
    if (next) {
      note.plannedResolution = {
        targetPitchClass: pitchClass(next.pitch),
        targetBeat: next.startBeat,
        maximumDelayBeats: Math.max(0.5, next.startBeat - note.startBeat),
      }
    }
  } else if (plan.climaxType === "silence") {
    const silenceStart = Math.max(0, plan.climaxBeat - 1.25)
    if (totalBeats >= 4 && notes.length >= 3) {
      for (let i = notes.length - 1; i >= 0; i--) {
        const candidate = notes[i]
        if (candidate.startBeat >= silenceStart && candidate.startBeat < plan.climaxBeat) notes.splice(i, 1)
        else if (candidate.startBeat < silenceStart && candidate.startBeat + candidate.durationBeats > silenceStart) {
          candidate.durationBeats = Math.max(0.2, silenceStart - candidate.startBeat)
        }
      }
    }
    if (notes.length === 0) return
    index = nearestNoteIndex(notes, plan.climaxBeat)
    notes[index].velocity = Math.max(notes[index].velocity, 92)
  } else {
    const lowBandHigh = Math.min(range.high, range.low + Math.max(5, Math.floor((range.high - range.low) * 0.38)))
    note.pitch = clamp(note.pitch - 12, range.low, lowBandHigh)
    note.durationBeats = Math.max(note.durationBeats, 1.75)
    note.plannedToneRole = "common-tone"
  }
}

function applyOpeningResolution(notes: MelodyNote[], opening: MelodyOpeningPlan | undefined): void {
  if (!opening || notes.length < 2) return
  const first = notes[0]
  const second = notes[1]
  first.startBeat = opening.startBeatOffset
  first.durationBeats = Math.min(opening.firstNoteDuration, Math.max(0.2, second.startBeat - first.startBeat))
  if (opening.intent.entryType === "suspension") {
    first.plannedToneRole = "suspension"
    first.plannedResolution = {
      targetPitchClass: pitchClass(second.pitch),
      targetBeat: second.startBeat,
      maximumDelayBeats: Math.max(0.5, second.startBeat - first.startBeat),
    }
  }
}

function applyEnding(
  notes: MelodyNote[],
  plan: ElegiacGenerationPlan,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  totalBeats: number,
): void {
  if (notes.length === 0) return
  const last = notes[notes.length - 1]
  const entry = chordAtBeat(harmonicMap, Math.min(totalBeats - 0.01, last.startBeat))
  if (!entry) return
  const chordTones = chordTonePitchClasses(entry.parsed)
  const usable = allUsablePitchClasses(entry.parsed)
  if (plan.endingStrategy === "resolved") {
    last.pitch = nearestAllowedPitch(last.pitch, [entry.parsed.rootPc, chordTones[1] ?? entry.parsed.rootPc], range)
    last.durationBeats = Math.min(Math.max(1.5, last.durationBeats), totalBeats - last.startBeat)
    last.plannedToneRole = "chord-tone"
  } else if (plan.endingStrategy === "suspended") {
    const tensions = usable.filter((pc) => !chordTones.includes(pc))
    if (tensions.length > 0) last.pitch = nearestAllowedPitch(last.pitch, tensions, range)
    last.durationBeats = Math.min(Math.max(2, last.durationBeats), totalBeats - last.startBeat)
    last.plannedToneRole = "tension-hold"
  } else if (plan.endingStrategy === "open") {
    const openPitchClass = entry.parsed.tensions[0]?.pitchClass ?? chordTones[2] ?? entry.parsed.rootPc
    last.pitch = nearestAllowedPitch(last.pitch, [openPitchClass], range)
    last.durationBeats = Math.min(Math.max(1, last.durationBeats), totalBeats - last.startBeat)
    last.plannedToneRole = chordTones.includes(pitchClass(last.pitch)) ? "chord-tone" : "tension-hold"
  } else {
    const previous = notes[notes.length - 2]
    last.pitch = nearestAllowedPitch((previous?.pitch ?? last.pitch) + 2, usable, range)
    last.durationBeats = Math.min(0.75, totalBeats - last.startBeat)
    last.plannedToneRole = "anticipation"
  }
}

function normalizeNotes(notes: MelodyNote[], range: RangeSetting, totalBeats: number): MelodyNote[] {
  const sorted = notes
    .filter((note) => note.startBeat < totalBeats - 0.01)
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const out: MelodyNote[] = []
  for (const source of sorted) {
    const note = {
      ...source,
      pitch: clamp(Math.round(source.pitch), range.low, range.high),
      startBeat: clamp(source.startBeat, 0, totalBeats),
      durationBeats: Math.max(0.01, Math.min(source.durationBeats, totalBeats - clamp(source.startBeat, 0, totalBeats))),
    }
    const previous = out[out.length - 1]
    if (previous && previous.startBeat + previous.durationBeats > note.startBeat) {
      previous.durationBeats = Math.max(0.15, note.startBeat - previous.startBeat)
    }
    if (!previous || note.startBeat - previous.startBeat >= 0.15) out.push(note)
  }
  return out
}

/** 最高音の希少性は保つが、その最高音をClimaxと同一視したり後半へ固定したりはしない。 */
function ensureRareHighest(
  notes: MelodyNote[],
  plan: ElegiacGenerationPlan,
  range: RangeSetting,
  harmonicMap: HarmonicMapEntry[],
): void {
  if (notes.length < 2) return
  const totalBeats = Math.max(...notes.map((note) => note.startBeat + note.durationBeats))
  const earlyIndexes = notes.flatMap((note, index) => (note.startBeat <= totalBeats * 0.45 ? [index] : []))
  const keep =
    plan.climaxType === "longest-note"
      ? notes.reduce((best, note, index) => (note.durationBeats > notes[best].durationBeats ? index : best), 0)
      : plan.climaxType === "silence" || plan.climaxType === "low-return"
        ? (earlyIndexes.length > 0 ? earlyIndexes : [0]).reduce((best, index) =>
            notes[index].pitch > notes[best].pitch ? index : best,
          )
        : notes.reduce(
            (best, _note, index) =>
              Math.abs(notes[index].startBeat - plan.climaxBeat) < Math.abs(notes[best].startBeat - plan.climaxBeat)
                ? index
                : best,
            0,
          )
  const keepEntry = chordAtBeat(harmonicMap, notes[keep].startBeat)
  const keepAllowed = keepEntry ? allUsablePitchClasses(keepEntry.parsed) : [pitchClass(notes[keep].pitch)]
  notes[keep].pitch = nearestAllowedPitch(range.high, keepAllowed, range)
  if (keepEntry) {
    notes[keep].plannedToneRole = chordTonePitchClasses(keepEntry.parsed).includes(pitchClass(notes[keep].pitch))
      ? "chord-tone"
      : "tension-hold"
    notes[keep].plannedResolution = undefined
  }
  const safeHighest = notes[keep].pitch
  for (let index = 0; index < notes.length; index++) {
    if (index === keep) continue
    if (notes[index].pitch < safeHighest) continue
    const entry = chordAtBeat(harmonicMap, notes[index].startBeat)
    const allowed = entry ? allUsablePitchClasses(entry.parsed) : [pitchClass(notes[index].pitch)]
    let lowered = nearestAllowedPitch(safeHighest - 3, allowed, range)
    if (lowered >= safeHighest && lowered - 12 >= range.low) lowered -= 12
    notes[index].pitch = lowered
    if (entry) {
      notes[index].plannedToneRole = chordTonePitchClasses(entry.parsed).includes(pitchClass(lowered))
        ? "chord-tone"
        : "tension-hold"
      notes[index].plannedResolution = undefined
    }
  }
}

function contourForNotes(notes: MelodyNote[]): PhraseContour {
  if (notes.length < 2) return "wave"
  const first = notes[0].pitch
  const last = notes[notes.length - 1].pitch
  const peakIndex = notes.reduce((best, note, index) => (note.pitch > notes[best].pitch ? index : best), 0)
  if (peakIndex > 0 && peakIndex < notes.length - 1) return "arch"
  if (last > first + 2) return "ascending"
  if (last < first - 2) return "descending"
  return "wave"
}

function phrasePlans(
  notes: MelodyNote[],
  lengths: number[],
  plan: ElegiacGenerationPlan,
): PhrasePlan[] {
  const out: PhrasePlan[] = []
  let start = 0
  for (const length of lengths) {
    const end = start + length
    const phraseNotes = notes.filter((note) => note.startBeat >= start && note.startBeat < end)
    out.push({
      phraseStartBeat: start,
      phraseLengthBeats: length,
      climaxBeat:
        plan.climaxBeat >= start && plan.climaxBeat < end
          ? plan.climaxBeat
          : phraseNotes.length
            ? phraseNotes.reduce((best, note) => (note.velocity > best.velocity ? note : best)).startBeat
            : start + length / 2,
      contour: contourForNotes(phraseNotes),
      restBeats: plan.breathBeats.filter((beat) => beat > start && beat < end),
      endTension: plan.endingStrategy === "resolved" ? 0.1 : plan.endingStrategy === "open" ? 0.5 : 0.85,
    })
    start = end
  }
  return out
}

export function generateElegiacCantabile(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  intensity: number,
  noteDensity: number,
  songDNA: SongMotifDNA | undefined,
  opening: MelodyOpeningPlan | undefined,
  candidateDNA: CandidateMelodyDNA,
): ElegiacGenerationResult {
  const motifSeed = buildMotifSeed(rng, opening, candidateDNA, songDNA)
  const phraseLengths = buildPhraseLengths(totalBeats, candidateDNA)
  const breathBeats = buildBreaths(phraseLengths, opening, candidateDNA)
  const climaxType = CLIMAX_BY_MOTIF[candidateDNA.motifIdentity]
  const climaxBeat = clamp(totalBeats * candidateDNA.climaxPlan.targetFraction, 1, Math.max(1, totalBeats - 1))
  const endingStrategy = ENDING_BY_MOTIF[candidateDNA.motifIdentity]
  const plan: ElegiacGenerationPlan = {
    motifSeed,
    phraseLengths,
    breathBeats,
    climaxType,
    climaxBeat,
    endingStrategy,
    targetTones: buildTargetTones(harmonicMap, totalBeats, range, candidateDNA),
    development: DEVELOPMENT_BY_DNA[candidateDNA.developmentStrategy],
  }

  const notes: MelodyNote[] = []
  let phraseStart = 0
  phraseLengths.forEach((length, index) => {
    notes.push(
      ...generatePhrase(
        rng,
        harmonicMap,
        phraseStart,
        length,
        index,
        range,
        noteDensity + intensity * 0.04,
        index === 0 ? opening : undefined,
        plan,
      ),
    )
    phraseStart += length
  })

  applyOpeningResolution(notes, opening)
  applyClimax(notes, plan, harmonicMap, range, totalBeats)
  // Climaxのleap/recoveryで変更された後続音も含め、最終的な旋律表面を検証する。
  harmonizeExposedNotes(notes, harmonicMap, range)
  applyEnding(notes, plan, harmonicMap, range, totalBeats)
  const normalized = normalizeNotes(notes, range, totalBeats)
  ensureRareHighest(normalized, plan, range, harmonicMap)
  return {
    notes: normalized,
    phrasePlans: phrasePlans(normalized, phraseLengths, plan),
    plan,
  }
}
