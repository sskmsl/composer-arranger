import type { SeededRandom } from "@/core/rng"
import type { MelodyOpeningPlan } from "@/core/melody"
import type { Density, GenerationParams, RangeSetting } from "./generationParams"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { nearestAllowedPitch, withKeyBias } from "./pitchUtils"

export interface MotifEvent {
  offsetBeats: number
  durationBeats: number
  isRest: boolean
}

export interface MotifCore {
  events: MotifEvent[]
  /** 非休符イベントに対応するピッチ(絶対MIDI) */
  pitches: number[]
  lengthBeats: number
}

const DURATION_PALETTE: Record<Density, number[]> = {
  sparse: [1, 1.5, 2, 2, 3],
  balanced: [0.5, 1, 1, 1.5, 2],
  active: [0.25, 0.5, 0.5, 0.5, 1, 1.5],
}

/**
 * densityNoteMultiplierに応じて音価パレットの重みを短い方(または長い方)へ寄せる。
 * multiplier>1(Active寄り)ほど短い音価を、<1(Outro等)ほど長い音価を選びやすくすることで、
 * 同じフレーズ長でも実際のノート数が変化するようにする(以前はDensity Note Multiplierが
 * 計算されるだけで生成処理のどこからも参照されておらず、常に無効だった)。
 */
function pickDuration(rng: SeededRandom, palette: number[], densityNoteMultiplier: number): number {
  const bias = Math.max(0.35, Math.min(2.8, densityNoteMultiplier))
  const n = palette.length
  const weights = palette.map((_, i) => Math.pow(bias, 1 - (2 * i) / Math.max(1, n - 1)))
  return rng.weightedPick(palette, weights)
}

/**
 * 9.3 Rhythm Motif: 音程より先にリズムの核(2〜5音)を作る。
 * openingが渡された場合は、その冒頭設計(弱起/休符後開始・最初の音価・輪郭)を核の先頭へ反映する。
 */
export function generateRhythmMotif(rng: SeededRandom, density: Density, params: GenerationParams, opening?: MelodyOpeningPlan): MotifEvent[] {
  const palette = DURATION_PALETTE[density]
  const noteCount = rng.intBetween(2, 5)
  const events: MotifEvent[] = []
  let cursor = 0

  if (opening) {
    // Opening Plan: 開始拍オフセット(弱起/休符後開始)を休符として先頭へ置く
    if (opening.startBeatOffset > 0) {
      events.push({ offsetBeats: 0, durationBeats: opening.startBeatOffset, isRest: true })
      cursor = opening.startBeatOffset
    }
    // 最初の音価は計画で固定する
    events.push({ offsetBeats: cursor, durationBeats: opening.firstNoteDuration, isRest: false })
    cursor += opening.firstNoteDuration
    // repeated-note入口は2音目も同じ音価で刻み、識別可能な核にする
    if (opening.openingContour === "repeated-note") {
      events.push({ offsetBeats: cursor, durationBeats: opening.firstNoteDuration, isRest: false })
      cursor += opening.firstNoteDuration
    }
  } else if (rng.chance(params.restRatioTarget * 0.3)) {
    // 小節頭の休符(9.3)を稀に許容し、フレーズの食い込みを演出する
    const leadRest = rng.pick([0.5, 1])
    events.push({ offsetBeats: 0, durationBeats: leadRest, isRest: true })
    cursor = leadRest
  }

  const startIdx = events.filter((e) => !e.isRest).length
  // 平坦な冒頭(repeated-note/static)は核が数音で尽きると「flatな核」になり、モチーフ反復で
  // セクション全体まで平坦化してしまう。そのため平坦入口のときだけ、冒頭に従わせる音数(budget)より
  // 2音多い自然な音を核へ足して、反復されても輪郭が残るようにする(他の入口は音数を変えない=
  // Minimal等の休符量を損なわない)。
  const isFlatOpening = opening && (opening.openingContour === "repeated-note" || opening.initialDirection === "static")
  const targetCount = isFlatOpening ? Math.max(noteCount, openingNoteBudget(opening!) + 2) : noteCount
  for (let i = startIdx; i < Math.max(startIdx + 1, targetCount); i++) {
    const rawDuration = pickDuration(rng, palette, params.densityNoteMultiplier)
    const isRest = i > 0 && i < noteCount - 1 && rng.chance(params.restRatioTarget * 0.35)
    // syncopationAmountに応じて、拍頭に揃っている場合に限り開始位置を後ろへ食い込ませる。
    // (durationも同じ分だけ削るため、次イベントのcursor位置は変えない=はみ出し・重なりは発生しない)
    // 短い音価(0.5拍)も対象に含めることで、Active(音価が短くなる)でもsyncopationAmountが効くようにする。
    const onBeat = Math.abs(cursor - Math.round(cursor)) < 0.01
    let offset = cursor
    let duration = rawDuration
    if (!isRest && onBeat && rawDuration >= 0.5 && rng.chance(params.syncopationAmount * 0.7)) {
      const shift = rawDuration > 0.75 ? 0.5 : 0.25
      if (rawDuration - shift >= 0.2) {
        offset = cursor + shift
        duration = rawDuration - shift
      }
    }
    events.push({ offsetBeats: offset, durationBeats: duration, isRest })
    cursor += rawDuration
  }
  return events
}

/** 9.4 Pitch Motif: 2〜5音の核へピッチを割り当てる */
export function generatePitchMotif(
  rng: SeededRandom,
  events: MotifEvent[],
  motifStartBeat: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  opening?: MelodyOpeningPlan,
): number[] {
  const effectiveHigh = range.high - params.peakHeadroomSemitones
  const effectiveRange = { low: range.low, high: Math.max(range.low + 4, effectiveHigh) }
  const midRange = Math.round((effectiveRange.low + effectiveRange.high) / 2)

  const pitches: number[] = []
  let prev: number | null = null
  let sounded = 0
  // Issue #64: 跳躍の直後は反行・順次進行で回収し、跳躍が連続しないようにする
  let lastWasLeap = false
  let lastDirection = 1

  for (const event of events) {
    if (event.isRest) continue
    const beat = motifStartBeat + event.offsetBeats
    const entry = chordAtBeat(harmonicMap, beat)
    const chordTones = entry ? chordTonePitchClasses(entry.parsed) : [0, 4, 7]
    const usable = entry ? allUsablePitchClasses(entry.parsed) : chordTones

    if (prev === null) {
      let best: number
      if (opening) {
        // Opening Plan: 計画した開始ピッチクラスを、計画した音域帯の中で最も近い位置に置く
        const band = clampBand(opening.openingRegister, effectiveRange)
        const bandMid = Math.round((band.low + band.high) / 2)
        best = nearestAllowedPitch(bandMid, [opening.startPitchClass], band)
      } else {
        // 開始音: コードトーンの中からレンジ中央に最も近いもの(9.4 歌いやすさ・音域内での位置)
        best = chordTones[0]
        let bestDist = Infinity
        for (const pc of chordTones) {
          const cand = nearestAllowedPitch(midRange - 6 + (pc - (midRange % 12) + 24) % 12, [pc], effectiveRange)
          const dist = Math.abs(cand - midRange)
          if (dist < bestDist) {
            bestDist = dist
            best = cand
          }
        }
      }
      pitches.push(best)
      prev = best
      sounded++
      continue
    }

    // Opening Plan: 冒頭の数音だけは計画した進行方向・輪郭に従わせる
    if (opening && sounded < openingNoteBudget(opening)) {
      const snapped = openingNextPitch(rng, opening, prev, sounded, chordTones, usable, effectiveRange, params)
      pitches.push(snapped)
      prev = snapped
      sounded++
      continue
    }

    // 強拍ではコードトーン/テンション解決を安定させるため、テンション採用率を弱拍より抑える
    const isStrongBeat = Math.abs(beat - Math.round(beat)) < 0.01
    const tensionChance = isStrongBeat ? params.tensionUsageTarget * 0.5 : Math.min(1, params.tensionUsageTarget * 1.15)
    const useTension = rng.chance(tensionChance)
    const allowed = useTension ? withKeyBias(usable, params.keyScalePitchClasses) : chordTones

    let direction: number
    let magnitude: number
    if (lastWasLeap) {
      // 跳躍の直後は逆方向への順次進行で回収し、歌いやすさを保つ(連続跳躍を作らない)
      direction = -lastDirection
      magnitude = rng.intBetween(1, 2)
    } else {
      const wantsLeap = rng.chance(params.leapWidthBias)
      direction = rng.chance(0.5) ? 1 : -1
      magnitude = wantsLeap ? rng.intBetween(3, 7) : rng.intBetween(1, 2)
    }
    const candidate = prev + direction * magnitude
    const snapped = nearestAllowedPitch(candidate, allowed, effectiveRange)
    pitches.push(snapped)
    lastWasLeap = !lastWasLeap && magnitude >= 3
    lastDirection = direction
    prev = snapped
    sounded++
  }

  return pitches
}

function clampBand(band: { lowestMidiNote: number; highestMidiNote: number }, range: RangeSetting): RangeSetting {
  const low = Math.max(range.low, Math.min(band.lowestMidiNote, range.high - 2))
  const high = Math.min(range.high, Math.max(band.highestMidiNote, low + 2))
  return { low, high }
}

/** 冒頭で計画に従わせる音数(輪郭を成立させるのに必要な3〜4音) */
function openingNoteBudget(opening: MelodyOpeningPlan): number {
  return opening.openingContour === "repeated-note" ? 3 : 4
}

function dirSign(direction: MelodyOpeningPlan["initialDirection"]): number {
  return direction === "ascending" ? 1 : direction === "descending" ? -1 : 0
}

/** 冒頭ノートのピッチを、計画した輪郭(順次/跳躍して回収/同音反復/弱起解決/倚音解決)に沿って決める */
function openingNextPitch(
  rng: SeededRandom,
  opening: MelodyOpeningPlan,
  prev: number,
  index: number,
  chordTones: number[],
  usable: number[],
  range: RangeSetting,
  params: GenerationParams,
): number {
  const sign = dirSign(opening.initialDirection)
  switch (opening.openingContour) {
    case "repeated-note":
      return prev
    case "leap-then-recover": {
      // index 1で跳躍、その後は逆方向へ順次で回収する
      if (index === 1) return nearestAllowedPitch(prev + (sign || 1) * rng.intBetween(4, 7), chordTones, range)
      return nearestAllowedPitch(prev - (sign || 1) * rng.intBetween(1, 2), chordTones, range)
    }
    case "suspension-entry": {
      // 開始の倚音を、隣接するコードトーンへ順次解決させる
      if (index === 1) {
        const down = nearestAllowedPitch(prev - 1, chordTones, range)
        const up = nearestAllowedPitch(prev + 1, chordTones, range)
        return sign >= 0 ? up : down
      }
      return nearestAllowedPitch(prev + (sign || -1) * rng.intBetween(1, 2), chordTones, range)
    }
    case "pickup-resolution": {
      // 弱起から強拍の主要音へ順次で吸い込まれる
      return nearestAllowedPitch(prev + (sign || 1) * rng.intBetween(1, 2), chordTones, range)
    }
    case "stepwise":
    default: {
      if (sign === 0) {
        // static: 同音とわずかな刺繍音を交える
        return rng.chance(0.5) ? prev : nearestAllowedPitch(prev + rng.jitter(), chordTones, range)
      }
      const allowed = rng.chance(params.tensionUsageTarget * 0.5) ? withKeyBias(usable, params.keyScalePitchClasses) : chordTones
      return nearestAllowedPitch(prev + sign * rng.intBetween(1, 2), allowed, range)
    }
  }
}
