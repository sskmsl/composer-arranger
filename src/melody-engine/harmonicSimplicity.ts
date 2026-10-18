import { allUsablePitchClasses, parseChordSymbol } from "@/core/chord"
import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import type { RangeSetting } from "./generationParams"

/** 和声の実際の交代と非共通音を測る。同じコードの分割は変化と数えない。 */
export function harmonicMotionInBar(chords: readonly ChordEvent[], start: number, beatsPerBar: number): number {
  const entries = [...chords].sort((a, b) => a.startBeat - b.startBeat)
    .filter((c) => c.startBeat < start + beatsPerBar && c.startBeat + c.durationBeats > start)
    .flatMap((c) => {
      const parsed = parseChordSymbol(c.symbol, c.bass ?? undefined)
      return parsed ? [parsed] : []
    })
  let motion = 0
  for (let i = 1; i < entries.length; i++) {
    const before = entries[i - 1], after = entries[i]
    const a = new Set(before.tones.map((t) => t.pitchClass))
    const b = new Set(after.tones.map((t) => t.pitchClass))
    if (a.size === b.size && [...a].every((pc) => b.has(pc))) continue
    motion += 1 + [...b].filter((pc) => !a.has(pc)).length / Math.max(1, b.size)
  }
  return motion
}

/** 既存Profileの性格を保ち、和声が忙しい小節だけ弱い発音と跳躍を抑える。 */
export function simplifyAgainstHarmony(
  source: readonly MelodyNote[], chords: readonly ChordEvent[], range: RangeSetting,
  profile: MelodyGeneratorProfile, beatsPerBar = 4,
): MelodyNote[] {
  if (!["standard", "minimal", "cinematic"].includes(profile) || beatsPerBar <= 0) return [...source]
  const notes = [...source].sort((a, b) => a.startBeat - b.startBeat)
  const result: MelodyNote[] = []
  let busyIndex = 0
  let previousBar = -1
  for (const original of notes) {
    const bar = Math.floor(original.startBeat / beatsPerBar)
    if (bar !== previousBar) { busyIndex = 0; previousBar = bar }
    if (harmonicMotionInBar(chords, bar * beatsPerBar, beatsPerBar) < 2) {
      result.push(original)
      continue
    }
    busyIndex++
    const weak = Math.abs(original.startBeat - Math.round(original.startBeat)) > .06
    if (!original.locks.length && weak && busyIndex % 2 === 0 && original.durationBeats < 1) continue
    const previous = result.at(-1)
    const chord = chords.find((c) => original.startBeat >= c.startBeat && original.startBeat < c.startBeat + c.durationBeats)
    const parsed = chord && parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    if (!previous || !parsed || original.locks.length || Math.abs(original.pitch - previous.pitch) <= 2) {
      result.push(original)
      continue
    }
    const allowed = allUsablePitchClasses(parsed)
    const choices = Array.from({ length: range.high - range.low + 1 }, (_, i) => range.low + i)
      .filter((p) => allowed.includes(p % 12))
      .sort((a, b) => Math.abs(a - previous.pitch) - Math.abs(b - previous.pitch) || Math.abs(a - original.pitch) - Math.abs(b - original.pitch))
    result.push({ ...original, pitch: choices[0] ?? original.pitch, plannedResolution: undefined })
  }
  return result
}
