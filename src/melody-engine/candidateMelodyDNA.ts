import type {
  CandidateMelodyDNA,
  MelodyGeneratorProfile,
  MelodyNote,
  MelodyOpeningPlan,
  PhraseContour,
} from "@/core/melody"
import type { SeededRandom } from "@/core/rng"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { pitchClass } from "@/core/note"
import type { GenerationParams, RangeSetting } from "./generationParams"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { nearestAllowedPitch } from "./pitchUtils"

type DNAPrototype = Omit<CandidateMelodyDNA, "climaxPlan"> & {
  climaxPlan: Omit<CandidateMelodyDNA["climaxPlan"], "targetFraction">
}

const PROTOTYPES: Record<MelodyGeneratorProfile, DNAPrototype[]> = {
  standard: [
    dna("stepwise-cell", "balanced", "call-response", "chord-following", "arch", "sequence", "pitch-peak", "late", "resolved"),
    dna("turn-cell", "sustained", "long-arc", "common-tone", "rising", "augmentation", "tension-peak", "middle", "open"),
    dna("leap-recovery", "syncopated", "asymmetric", "anticipatory", "terraced", "fragmentation", "rhythmic-peak", "early", "carry-forward"),
    dna("repeated-cell", "balanced", "balanced", "delayed-resolution", "falling", "delayed-return", "pitch-peak", "middle", "suspended"),
  ],
  minimal: [
    dna("repeated-cell", "sustained", "long-arc", "common-tone", "contained", "literal-return", "tension-peak", "late", "open"),
    dna("stepwise-cell", "balanced", "asymmetric", "delayed-resolution", "falling", "delayed-return", "pitch-peak", "middle", "suspended"),
    dna("turn-cell", "sustained", "call-response", "anticipatory", "terraced", "augmentation", "rhythmic-peak", "early", "carry-forward"),
    dna("repeated-cell", "cyclic", "cyclic", "tension-hold", "contained", "fragmentation", "tension-peak", "middle", "resolved"),
  ],
  leaping: [
    dna("leap-recovery", "balanced", "call-response", "chord-following", "arch", "sequence", "pitch-peak", "late", "resolved"),
    dna("turn-cell", "syncopated", "asymmetric", "anticipatory", "rising", "fragmentation", "rhythmic-peak", "middle", "carry-forward"),
    dna("leap-recovery", "sustained", "long-arc", "delayed-resolution", "falling", "augmentation", "tension-peak", "early", "suspended"),
    dna("stepwise-cell", "balanced", "balanced", "common-tone", "terraced", "delayed-return", "pitch-peak", "middle", "open"),
  ],
  rhythmic: [
    dna("repeated-cell", "syncopated", "asymmetric", "anticipatory", "terraced", "fragmentation", "rhythmic-peak", "early", "carry-forward"),
    dna("turn-cell", "cyclic", "cyclic", "chord-following", "contained", "literal-return", "pitch-peak", "middle", "resolved"),
    dna("stepwise-cell", "speech-like", "call-response", "delayed-resolution", "rising", "sequence", "tension-peak", "late", "suspended"),
    dna("leap-recovery", "balanced", "balanced", "common-tone", "arch", "augmentation", "pitch-peak", "late", "open"),
  ],
  chromatic: [
    dna("chromatic-cell", "balanced", "long-arc", "delayed-resolution", "rising", "sequence", "tension-peak", "late", "suspended"),
    dna("turn-cell", "syncopated", "asymmetric", "anticipatory", "terraced", "fragmentation", "rhythmic-peak", "early", "carry-forward"),
    dna("stepwise-cell", "sustained", "call-response", "tension-hold", "falling", "augmentation", "pitch-peak", "middle", "open"),
    dna("leap-recovery", "balanced", "balanced", "common-tone", "arch", "delayed-return", "tension-peak", "middle", "resolved"),
  ],
  cinematic: [
    dna("stepwise-cell", "sustained", "long-arc", "common-tone", "rising", "augmentation", "pitch-peak", "late", "open"),
    dna("leap-recovery", "balanced", "call-response", "anticipatory", "arch", "sequence", "tension-peak", "middle", "carry-forward"),
    dna("turn-cell", "syncopated", "asymmetric", "delayed-resolution", "terraced", "fragmentation", "rhythmic-peak", "early", "suspended"),
    dna("repeated-cell", "balanced", "balanced", "chord-following", "falling", "delayed-return", "pitch-peak", "late", "resolved"),
  ],
  "elegiac-cantabile": [
    dna("stepwise-cell", "sustained", "long-arc", "delayed-resolution", "falling", "augmentation", "tension-peak", "late", "suspended"),
    dna("turn-cell", "balanced", "call-response", "common-tone", "rising", "delayed-return", "pitch-peak", "middle", "open"),
    dna("leap-recovery", "sustained", "asymmetric", "anticipatory", "arch", "fragmentation", "rhythmic-peak", "early", "carry-forward"),
    dna("chromatic-cell", "balanced", "balanced", "tension-hold", "terraced", "sequence", "tension-peak", "middle", "resolved"),
  ],
  "speech-rhythmic": [
    dna("repeated-cell", "speech-like", "asymmetric", "chord-following", "contained", "fragmentation", "rhythmic-peak", "early", "carry-forward"),
    dna("turn-cell", "syncopated", "call-response", "anticipatory", "terraced", "sequence", "pitch-peak", "middle", "open"),
    dna("stepwise-cell", "cyclic", "cyclic", "common-tone", "rising", "literal-return", "tension-peak", "late", "suspended"),
    dna("repeated-cell", "balanced", "balanced", "delayed-resolution", "falling", "delayed-return", "rhythmic-peak", "middle", "resolved"),
  ],
  incantatory: [
    dna("repeated-cell", "cyclic", "cyclic", "chord-following", "contained", "literal-return", "rhythmic-peak", "early", "open"),
    dna("chromatic-cell", "balanced", "asymmetric", "tension-hold", "terraced", "sequence", "tension-peak", "middle", "suspended"),
    dna("turn-cell", "syncopated", "call-response", "anticipatory", "rising", "fragmentation", "pitch-peak", "late", "carry-forward"),
    dna("leap-recovery", "sustained", "long-arc", "common-tone", "arch", "delayed-return", "pitch-peak", "middle", "resolved"),
  ],
}

function dna(
  motifIdentity: CandidateMelodyDNA["motifIdentity"],
  rhythmGrammar: CandidateMelodyDNA["rhythmGrammar"],
  phraseArchitecture: CandidateMelodyDNA["phraseArchitecture"],
  harmonicResponse: CandidateMelodyDNA["harmonicResponse"],
  registerTrajectory: CandidateMelodyDNA["registerTrajectory"],
  developmentStrategy: CandidateMelodyDNA["developmentStrategy"],
  climaxType: CandidateMelodyDNA["climaxPlan"]["type"],
  climaxPosition: CandidateMelodyDNA["climaxPlan"]["position"],
  endingStrategy: CandidateMelodyDNA["endingStrategy"],
): DNAPrototype {
  return {
    motifIdentity,
    rhythmGrammar,
    phraseArchitecture,
    harmonicResponse,
    registerTrajectory,
    developmentStrategy,
    climaxPlan: { type: climaxType, position: climaxPosition },
    endingStrategy,
  }
}

const CLIMAX_FRACTION: Record<CandidateMelodyDNA["climaxPlan"]["position"], number> = {
  early: 0.34,
  middle: 0.58,
  late: 0.8,
}

/** Profile固有の候補群から、Pattern番号とは独立した全体DNAを決定する。 */
export function planCandidateMelodyDNA(
  rng: SeededRandom,
  profile: MelodyGeneratorProfile,
  candidatePoolIndex: number,
): CandidateMelodyDNA {
  const prototypes = PROTOTYPES[profile]
  const rotation = rng.intBetween(0, prototypes.length - 1)
  const source = prototypes[(candidatePoolIndex + rotation) % prototypes.length]
  const jitter = (rng.next() - 0.5) * 0.06
  return {
    ...source,
    climaxPlan: {
      ...source.climaxPlan,
      targetFraction: clamp(CLIMAX_FRACTION[source.climaxPlan.position] + jitter, 0.2, 0.9),
    },
  }
}

/** DNAを既存Profile値へ穏やかに重ね、Profileらしさを残したまま生成判断を分岐する。 */
export function applyCandidateMelodyDNA(
  params: GenerationParams,
  candidateDNA: CandidateMelodyDNA,
  profile?: MelodyGeneratorProfile,
): GenerationParams {
  const out: GenerationParams = { ...params, contourWeights: { ...params.contourWeights } }

  switch (candidateDNA.motifIdentity) {
    case "leap-recovery":
      out.leapWidthBias = nudge(out.leapWidthBias, 0.78, 0.45)
      break
    case "repeated-cell":
      out.motifRepeatTarget = nudge(out.motifRepeatTarget, 0.76, 0.45)
      out.leapWidthBias = nudge(out.leapWidthBias, 0.12, 0.35)
      break
    case "chromatic-cell":
      out.tensionUsageTarget = nudge(out.tensionUsageTarget, 0.68, 0.5)
      break
    case "stepwise-cell":
      out.leapWidthBias = nudge(out.leapWidthBias, 0.18, 0.4)
      break
    case "turn-cell":
      out.noveltyWeight = nudge(out.noveltyWeight, 0.62, 0.25)
      break
  }

  switch (candidateDNA.rhythmGrammar) {
    case "sustained":
      out.densityNoteMultiplier = nudge(out.densityNoteMultiplier, 0.62, 0.45)
      out.restRatioTarget = nudge(out.restRatioTarget, 0.34, 0.3)
      break
    case "syncopated":
      out.syncopationAmount = nudge(out.syncopationAmount, 0.82, 0.5)
      break
    case "speech-like":
      out.syncopationAmount = nudge(out.syncopationAmount, 0.68, 0.4)
      out.densityNoteMultiplier = nudge(out.densityNoteMultiplier, 1.28, 0.3)
      break
    case "cyclic":
      out.motifRepeatTarget = nudge(out.motifRepeatTarget, 0.8, 0.4)
      break
    case "balanced":
      break
  }

  switch (candidateDNA.harmonicResponse) {
    case "chord-following":
      out.tensionUsageTarget = nudge(out.tensionUsageTarget, 0.16, 0.3)
      break
    case "common-tone":
      out.leapWidthBias = nudge(out.leapWidthBias, 0.18, 0.25)
      out.motifRepeatTarget = nudge(out.motifRepeatTarget, 0.68, 0.25)
      break
    case "anticipatory":
      out.syncopationAmount = nudge(out.syncopationAmount, 0.7, 0.3)
      out.tensionUsageTarget = nudge(out.tensionUsageTarget, 0.42, 0.25)
      break
    case "delayed-resolution":
      out.tensionUsageTarget = nudge(out.tensionUsageTarget, 0.56, 0.35)
      out.endTensionBias = nudge(out.endTensionBias, 0.68, 0.25)
      break
    case "tension-hold":
      out.tensionUsageTarget = nudge(out.tensionUsageTarget, 0.72, 0.45)
      out.endTensionBias = nudge(out.endTensionBias, 0.82, 0.35)
      break
  }

  out.endTensionBias =
    candidateDNA.endingStrategy === "resolved"
      ? nudge(out.endTensionBias, 0.08, 0.65)
      : candidateDNA.endingStrategy === "open"
        ? nudge(out.endTensionBias, 0.48, 0.45)
        : nudge(out.endTensionBias, 0.82, 0.6)
  out.climaxBias =
    candidateDNA.climaxPlan.position === "early"
      ? "early"
      : candidateDNA.climaxPlan.position === "late"
        ? "end"
        : "late"

  const preferredContour = contourForTrajectory(candidateDNA.registerTrajectory)
  for (const contour of Object.keys(out.contourWeights) as PhraseContour[]) {
    out.contourWeights[contour] *= contour === preferredContour ? 2.1 : 0.72
  }
  // Candidate DNAはProfile美学の内側で差を作る。Profile固有の中核値を逆転させない。
  if (profile === "leaping") out.leapWidthBias = Math.max(out.leapWidthBias, 0.72)
  if (profile === "minimal") {
    out.leapWidthBias = Math.min(out.leapWidthBias, 0.28)
    out.densityNoteMultiplier = Math.min(out.densityNoteMultiplier, 0.78)
  }
  if (profile === "rhythmic") out.syncopationAmount = Math.max(out.syncopationAmount, 0.62)
  if (profile === "chromatic") out.tensionUsageTarget = Math.max(out.tensionUsageTarget, 0.5)
  return out
}

export function phraseLengthsForDNA(
  totalBeats: number,
  opening: MelodyOpeningPlan | undefined,
  defaultLength: number,
  candidateDNA: CandidateMelodyDNA | undefined,
): number[] {
  const lengths: number[] = []
  let remaining = totalBeats
  const first = Math.min(remaining, opening?.openingPhraseLengthBeats ?? defaultLength)
  if (first > 0.01) {
    lengths.push(first)
    remaining -= first
  }
  const pattern =
    candidateDNA?.phraseArchitecture === "long-arc"
      ? [16, 12]
      : candidateDNA?.phraseArchitecture === "asymmetric"
        ? [6, 10, 8]
        : candidateDNA?.phraseArchitecture === "call-response"
          ? [4, 8]
          : candidateDNA?.phraseArchitecture === "cyclic"
            ? [4, 6]
            : [defaultLength]
  let index = 0
  while (remaining > 0.01) {
    const length = Math.min(remaining, pattern[index % pattern.length])
    lengths.push(length)
    remaining -= length
    index++
  }
  return lengths
}

/** フレーズごとの音域重心を変え、全体のregister trajectoryを実音へ反映する。 */
export function rangeForPhrase(
  range: RangeSetting,
  candidateDNA: CandidateMelodyDNA | undefined,
  phraseIndex: number,
  phraseCount: number,
): RangeSetting {
  if (!candidateDNA || phraseCount <= 0) return range
  const span = range.high - range.low
  const progress = phraseCount <= 1 ? 0.5 : phraseIndex / (phraseCount - 1)
  const shift =
    candidateDNA.registerTrajectory === "rising"
      ? (progress - 0.5) * 6
      : candidateDNA.registerTrajectory === "falling"
        ? (0.5 - progress) * 6
        : candidateDNA.registerTrajectory === "arch"
          ? (0.5 - Math.abs(progress - 0.5)) * 6 - 1.5
          : candidateDNA.registerTrajectory === "terraced"
            ? (phraseIndex % 2 === 0 ? -2 : 3)
            : 0
  if (candidateDNA.registerTrajectory === "contained") {
    const mid = Math.round((range.low + range.high) / 2)
    return { low: Math.max(range.low, mid - Math.min(5, span / 2)), high: Math.min(range.high, mid + Math.min(5, span / 2)) }
  }
  const low = clamp(Math.round(range.low + shift), range.low, Math.max(range.low, range.high - 4))
  const high = clamp(Math.round(range.high + shift), Math.min(range.high, low + 4), range.high)
  return { low, high }
}

/**
 * 全体生成後、計画した頂点と終止が実音に現れているかを確認し、該当構造音だけを最小調整する。
 * モチーフ本体や中間音列は作り直さない。
 */
export function applyCandidateNarrative(
  source: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  candidateDNA: CandidateMelodyDNA,
): MelodyNote[] {
  const notes = source.map((note) => ({ ...note }))
  if (notes.length === 0) return notes
  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)

  const targetBeat = totalBeats * candidateDNA.climaxPlan.targetFraction
  // 終止音はEnding Strategyの役割を優先する。頂点候補は、音が1つしかない場合を除き終止音の手前から選ぶ。
  const climaxCandidates = notes.length > 1 ? notes.slice(0, -1) : notes
  const climax = climaxCandidates.reduce((best, note) =>
    Math.abs(note.startBeat - targetBeat) < Math.abs(best.startBeat - targetBeat) ? note : best,
  )
  if (candidateDNA.climaxPlan.type === "rhythmic-peak") {
    climax.velocity = Math.max(climax.velocity, 96)
  } else {
    climax.velocity = Math.max(climax.velocity, candidateDNA.climaxPlan.type === "tension-peak" ? 91 : 94)
  }

  const last = notes[notes.length - 1]
  const entry = chordAtBeat(harmonicMap, last.startBeat)
  if (entry) {
    const chordTones = chordTonePitchClasses(entry.parsed)
    const usable = allUsablePitchClasses(entry.parsed)
    switch (candidateDNA.endingStrategy) {
      case "resolved":
        last.pitch = nearestAllowedPitch(last.pitch, [entry.parsed.rootPc, chordTones[1] ?? entry.parsed.rootPc], range)
        last.plannedToneRole = "chord-tone"
        last.durationBeats = Math.min(Math.max(last.durationBeats, 1), Math.max(0.1, totalBeats - last.startBeat))
        break
      case "open": {
        const openPc = entry.parsed.tensions[0]?.pitchClass ?? chordTones[2] ?? entry.parsed.rootPc
        last.pitch = nearestAllowedPitch(last.pitch, [openPc], range)
        last.plannedToneRole = entry.parsed.tensions.length ? "tension-hold" : "chord-tone"
        break
      }
      case "suspended": {
        const tensionOnly = usable.filter((pc) => !chordTones.includes(pc))
        if (tensionOnly.length > 0) {
          last.pitch = nearestAllowedPitch(last.pitch, tensionOnly, range)
          last.plannedToneRole = "tension-hold"
        }
        last.durationBeats = Math.min(Math.max(last.durationBeats, 1.5), Math.max(0.1, totalBeats - last.startBeat))
        break
      }
      case "carry-forward": {
        const previous = notes[notes.length - 2]
        const target = previous ? previous.pitch + 2 : last.pitch + 2
        last.pitch = nearestAllowedPitch(target, usable, range)
        last.plannedToneRole = chordTones.includes(pitchClass(last.pitch)) ? "chord-tone" : "anticipation"
        last.durationBeats = Math.min(last.durationBeats, 0.75)
        break
      }
    }
  }

  // 頂点位置の違いが単なるメタデータにならないよう、計画位置の構造音を一度だけの最高音にする。
  // 他音はpitch classを保ったオクターブ移動を優先し、和声機能や終止機能を変えない。
  const climaxEntry = chordAtBeat(harmonicMap, climax.startBeat)
  const climaxChordTones = climaxEntry ? chordTonePitchClasses(climaxEntry.parsed) : []
  const climaxTensions = climaxEntry
    ? allUsablePitchClasses(climaxEntry.parsed).filter((pc) => !climaxChordTones.includes(pc))
    : []
  const climaxAllowed = climaxEntry
    ? candidateDNA.climaxPlan.type === "tension-peak" && climaxTensions.length > 0
      ? climaxTensions
      : climaxChordTones
    : [pitchClass(climax.pitch)]
  const existingMax = Math.max(...notes.map((note) => note.pitch))
  const intendedLift =
    candidateDNA.climaxPlan.type === "pitch-peak"
      ? 5
      : candidateDNA.climaxPlan.type === "tension-peak"
        ? 3
        : 0
  const desiredPeak = Math.min(range.high, Math.max(existingMax, climax.pitch + intendedLift))
  const peakCandidates: number[] = []
  for (let pitch = Math.max(range.low, existingMax); pitch <= range.high; pitch++) {
    if (climaxAllowed.includes(pitchClass(pitch))) peakCandidates.push(pitch)
  }
  const peakPitch =
    peakCandidates.length > 0
      ? peakCandidates.reduce((best, pitch) =>
          Math.abs(pitch - desiredPeak) < Math.abs(best - desiredPeak) ? pitch : best,
        )
      : nearestAllowedPitch(desiredPeak, climaxAllowed, range)
  climax.pitch = peakPitch
  climax.plannedToneRole = climaxChordTones.includes(pitchClass(peakPitch)) ? "chord-tone" : "tension-hold"
  for (const note of notes) {
    if (note === climax || note.pitch < peakPitch) continue
    let lowered = note.pitch
    while (lowered >= peakPitch && lowered - 12 >= range.low) lowered -= 12
    if (lowered >= peakPitch) lowered = Math.max(range.low, peakPitch - 1)
    note.pitch = lowered
  }
  return notes
}

function contourForTrajectory(trajectory: CandidateMelodyDNA["registerTrajectory"]): PhraseContour {
  switch (trajectory) {
    case "rising":
      return "ascending"
    case "falling":
      return "descending"
    case "arch":
      return "arch"
    case "terraced":
      return "wave"
    case "contained":
      return "inverted-arch"
  }
}

function nudge(value: number, target: number, amount: number): number {
  return value + (target - value) * amount
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}
