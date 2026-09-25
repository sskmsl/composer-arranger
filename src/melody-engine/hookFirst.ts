import { coreReferenceFit } from "./referenceFit"
import { SeededRandom } from "@/core/rng"
import type { MelodyNote, MelodyOpeningPlan } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import type { ResolvedMusicContext } from "@/core/musicContext"
import type { Density, GenerationParams, RangeSetting } from "./generationParams"
import type { HarmonicMapEntry } from "./harmonicMap"
import { generatePitchMotif, generateRhythmMotif, type MotifCore, type MotifEvent } from "./motifCore"
import { eventsLength, placeSegment } from "./phraseAssembler"

export interface CoreMotifJudgment {
  humability: number
  hookability: number
  rhythmicIdentity: number
  simplicity: number
  repeatability: number
}

export interface SelectedCoreMotif {
  core: MotifCore
  judgment: CoreMotifJudgment
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

function coreWithinTwoBars(events: MotifEvent[], pitches: number[], maximumBeats: number): MotifCore | null {
  const keptEvents: MotifEvent[] = []
  const keptPitches: number[] = []
  let pitchIndex = 0
  for (const event of events) {
    const pitch = event.isRest ? null : pitches[pitchIndex++]
    if (event.offsetBeats >= maximumBeats || keptPitches.length >= 5 && !event.isRest) break
    const durationBeats = Math.min(event.durationBeats, maximumBeats - event.offsetBeats)
    if (durationBeats < (event.isRest ? .1 : .25)) break
    keptEvents.push({ ...event, durationBeats })
    if (pitch !== null && pitch !== undefined) keptPitches.push(pitch)
  }
  if (keptPitches.length < 3) return null
  const length = eventsLength(keptEvents)
  const lengthBeats = length <= 4 ? 4 : 8
  if (lengthBeats - length >= .25) {
    keptEvents.push({ offsetBeats: length, durationBeats: lengthBeats - length, isRest: true })
  }
  return { events: keptEvents, pitches: keptPitches, lengthBeats }
}

/** 歌いやすさと記憶性を別々に測る。音数の少なさ単独では高得点にしない。 */
export function judgeCoreMotif(notes: readonly MelodyNote[], lengthBeats: number): CoreMotifJudgment {
  if (notes.length < 3) return { humability: 0, hookability: 0, rhythmicIdentity: 0, simplicity: 0, repeatability: 0 }
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const intervals = sorted.slice(1).map((note, index) => note.pitch - sorted[index].pitch)
  const gaps = sorted.slice(1).map((note, index) => note.startBeat - sorted[index].startBeat)
  const range = Math.max(...sorted.map((note) => note.pitch)) - Math.min(...sorted.map((note) => note.pitch))
  const leaps = intervals.filter((interval) => Math.abs(interval) >= 5)
  const stepwise = intervals.filter((interval) => Math.abs(interval) <= 3).length / intervals.length
  const pitchSet = new Set(sorted.map((note) => note.pitch)).size
  const sounding = sorted.reduce((sum, note) => sum + note.durationBeats, 0)
  const breathing = clamp01((lengthBeats - sounding) / lengthBeats)
  const rhythmTypes = new Set(gaps.map((gap) => Math.round(gap * 4) / 4)).size
  const durationTypes = new Set(sorted.map((note) => Math.round(note.durationBeats * 4) / 4)).size
  const rhythmicIdentity = clamp01((rhythmTypes - 1) * .38 + (durationTypes - 1) * .19)
  const contourSigns = intervals.map((interval) => Math.sign(interval))
  const contourTurns = contourSigns.slice(1).filter((sign, index) => sign !== contourSigns[index] && sign !== 0).length
  const contourClarity = clamp01(1 - Math.max(0, contourTurns - 1) * .3)
    * (intervals.some((interval) => interval !== 0) ? 1 : .42)
  const oneSignatureLeap = leaps.length === 1 && Math.abs(leaps[0]) <= 7 ? 1 : leaps.length === 0 ? .48 : .1
  const simpleSet = pitchSet >= 3 && pitchSet <= 5 ? 1 : pitchSet === 2 ? .35 : .5
  const simplicity = clamp01((sorted.length <= 5 ? 1 : .5) * .55 + simpleSet * .45)
  const rangeFit = range >= 3 && range <= 10 ? 1 : range < 3 ? .38 : clamp01(1 - (range - 10) / 8)
  const repeatability = clamp01(.45 * simplicity + .3 * contourClarity + .25 * (breathing >= .1 ? 1 : .35))
  const humability = clamp01(rangeFit * .24 + stepwise * .22 +
    (leaps.length <= 1 ? 1 : .1) * .18 + (breathing >= .08 ? 1 : .3) * .14 +
    simplicity * .12 + contourClarity * .1)
  const hookability = clamp01(rhythmicIdentity * .28 + contourClarity * .18 +
    oneSignatureLeap * .15 + simplicity * .12 + repeatability * .17 +
    (breathing >= .1 && breathing <= .55 ? 1 : .25) * .1)
  return { humability, hookability, rhythmicIdentity, simplicity, repeatability }
}

/** 既存のMotif生成・和声配置を短いCore候補として先に走らせ、最良の核だけを長いPhraseへ渡す。 */
export function selectCoreMotif(
  seed: number,
  harmonicMap: HarmonicMapEntry[],
  phraseLengthBeats: number,
  range: RangeSetting,
  params: GenerationParams,
  density: Density,
  sectionRole: SectionRole,
  opening?: MelodyOpeningPlan,
  musicContext?: ResolvedMusicContext,
): SelectedCoreMotif | null {
  const maximumBeats = Math.min(8, phraseLengthBeats)
  if (maximumBeats < 3) return null
  const chorus = sectionRole === "chorus" || sectionRole === "grand-chorus"
  // 参考曲の傾向に合う核を探せるよう、効かせる強さに応じて候補を少しだけ増やす
  const poolSize = (chorus ? 20 : 8) + Math.round((musicContext?.reference?.melody?.strength ?? 0) * 16)
  let best: SelectedCoreMotif | null = null
  let bestScore = -Infinity
  const melodyReference = musicContext?.reference?.melody
  const referenceShare = melodyReference ? Math.min(.3, melodyReference.strength * .5) : 0
  for (let index = 0; index < poolSize; index++) {
    const rng = new SeededRandom((seed ^ 0x45d9f3b) + index * 104729)
    const events = generateRhythmMotif(rng, density, params, opening, 3)
    const pitches = generatePitchMotif(rng, events, 0, harmonicMap, range, params, opening, true)
    const candidate = coreWithinTwoBars(events, pitches, maximumBeats)
    if (!candidate) continue
    const placed = placeSegment(candidate.events, candidate.pitches, 0, harmonicMap, range, params, rng, { opening })
    if (placed.length < 3) continue
    const core = { ...candidate, pitches: placed.map((note) => note.pitch) }
    const judgment = judgeCoreMotif(placed, core.lengthBeats)
    const genreRhythm = musicContext?.styleActive ? musicContext.genre.syncopation : .5
    const rhythmFit = 1 - Math.abs(judgment.rhythmicIdentity - (.48 + (genreRhythm - .5) * .12))
    const hookScore = chorus
      ? judgment.humability * .25 + judgment.hookability * .37 + judgment.rhythmicIdentity * .38
      : judgment.humability * .55 + judgment.hookability * .4 + rhythmFit * .05
    // 参考曲の旋律傾向は Hook-first の判断を上書きしない(最大でも3割まで)。元の音列は持っていない
    const score = referenceShare > 0
      ? hookScore * (1 - referenceShare) + coreReferenceFit(judgment, placed, core.lengthBeats, melodyReference!.traits) * referenceShare
      : hookScore
    if (score > bestScore) {
      bestScore = score
      best = { core, judgment }
    }
  }
  return best
}
