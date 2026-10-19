import type { MelodyCharacterPlan } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import { parseChordSymbol } from "@/core/chord"
import { keyScalePitchClasses } from "@/core/scale"
import type { GenerationParams, RangeSetting } from "./generationParams"
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
function unit(text: string) {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) / 4294967296
}

/** 音型を目標音域へ配置する。発音・音価はそのまま、強拍は和音から選ぶ。 */
export function placeCharacterRegister(notes: readonly MelodyNote[], plan: MelodyCharacterPlan, chords: readonly ChordEvent[], key?: string): MelodyNote[] {
  if (!notes.length) return []
  const low = Math.min(...notes.map((n) => n.pitch)), high = Math.max(...notes.map((n) => n.pitch))
  const scale = key ? keyScalePitchClasses(key) : Array.from({ length: 12 }, (_, i) => i)
  const expand = high - low < plan.rangeSpan - 1 && plan.rangeSpan >= 15
  const bottom = notes.findIndex((n) => n.pitch === low)
  const summit = notes.findLastIndex((n) => n.pitch === high)
  return notes.map((note, index) => {
    const chord = chords.find((c) => note.startBeat >= c.startBeat && note.startBeat < c.startBeat + c.durationBeats)
    const parsed = chord && parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    const strong = Math.abs(note.startBeat - Math.round(note.startBeat / 4) * 4) <= .06
    if (!strong && (!expand || index !== bottom && index !== summit)) return { ...note }
    const allowed = strong && parsed ? parsed.tones.map((t) => t.pitchClass) : scale
    const target = expand && index === bottom ? plan.range.low : expand && index === summit ? plan.range.high : note.pitch
    const choices = Array.from({ length: plan.range.high - plan.range.low + 1 }, (_, i) => plan.range.low + i).filter((p) => allowed.includes(p % 12))
    const pitch = choices.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? note.pitch
    return { ...note, pitch }
  })
}
/** 曲のseed・和声・テンポ・曲調から決める。UUIDや生成順の乱数は消費しない。 */
export function planMelodyCharacter(input: {
  seed: number; chords: readonly ChordEvent[]; tempo: number; style: string; role: SectionRole; range: RangeSetting; space?: number
}): MelodyCharacterPlan {
  const key = JSON.stringify([input.seed, input.chords.map((c) => [c.symbol, c.bass, c.startBeat, c.durationBeats]), input.tempo, input.style])
  const a = unit(key + "duration"), b = unit(key + "register"), c = unit(key + "rhythm")
  const quietBias = clamp((112 - input.tempo) / 60 + ((input.space ?? .5) - .5) * .3)
  const sustained = a < .38 + quietBias * .55
  const chorus = ["chorus", "grand-chorus", "breakdown-chorus"].includes(input.role)
  const requestedSpan = chorus ? 16 + Math.round(b) : input.role === "bridge" ? 12 + Math.round(b * 5)
    : input.role === "intro" || input.role === "outro" ? 8 + Math.round(b * 4) : 8 + Math.round(b * 2)
  const rangeSpan = Math.min(input.range.high - input.range.low, requestedSpan)
  const high = chorus ? input.range.high : Math.min(input.range.high, Math.round((input.range.low + input.range.high + rangeSpan) / 2))
  return { version: 1, seed: input.seed, quietBias, rangeSpan, range: { low: high - rangeSpan, high },
    longNoteRatio: clamp((sustained ? .64 + b * .13 : .10 + b * .09) + (chorus ? .03 : 0), .10, .80),
    offbeatRatio: sustained ? .05 + c * .10 : .45 + c * .20,
    notesPerBeat: sustained ? .55 + c * .16 : 1.30 + c * .10 }
}

export function applyMelodyCharacter(params: GenerationParams, plan?: MelodyCharacterPlan): GenerationParams {
  if (!plan) return params
  return { ...params, melodyCharacter: plan, peakHeadroomSemitones: 0,
    syncopationAmount: plan.offbeatRatio, densityNoteMultiplier: plan.notesPerBeat < 1 ? .4 : 2.6,
    restRatioTarget: plan.notesPerBeat < 1 ? .22 : .10 }
}

/** 既存の候補プール内で、高さと幅を別々に計画する。基準の音域目標は変更しない。 */
export function candidateMelodyRegister(plan: MelodyCharacterPlan, poolIndex: number): MelodyCharacterPlan {
  const width = unit(`${plan.seed}:${poolIndex}:width`)
  const height = unit(`${plan.seed}:${poolIndex}:height`)
  const available = plan.range.high - plan.range.low
  const rangeSpan = Math.min(available, width < .5 ? 8 : 16)
  const high = height < .5 ? plan.range.high : Math.max(plan.range.low + rangeSpan, plan.range.high - 4)
  return { ...plan, rangeSpan, range: { low: high - rangeSpan, high } }
}
