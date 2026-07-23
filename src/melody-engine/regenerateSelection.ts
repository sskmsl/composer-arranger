import { SeededRandom } from "@/core/rng"
import type { MelodyNote } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import type { GenerationParams, RangeSetting, Density } from "./generationParams"
import { assemblePhrase } from "./phraseAssembler"
import { parseTimeSignature } from "@/core/section"

/**
 * 選択範囲のみを再生成する(10.4)。Lock(pitch/rhythm/startPosition/ending)が
 * 付いたノート、およびlockedBarsに含まれるノートは変更しない。
 */
export function regenerateSelection(
  notes: MelodyNote[],
  lockedBars: number[],
  timeSignature: string,
  startBeat: number,
  endBeat: number,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  params: GenerationParams,
  density: Density,
  seed: number,
): MelodyNote[] {
  const { beatsPerBar } = parseTimeSignature(timeSignature)
  const lockedBarSet = new Set(lockedBars)
  const barOf = (beat: number) => Math.floor(beat / beatsPerBar) + 1

  const isProtected = (n: MelodyNote) => n.locks.length > 0 || lockedBarSet.has(barOf(n.startBeat))

  const outside = notes.filter((n) => n.startBeat < startBeat || n.startBeat >= endBeat)
  const inside = notes.filter((n) => n.startBeat >= startBeat && n.startBeat < endBeat)
  const protectedInside = inside.filter(isProtected).sort((a, b) => a.startBeat - b.startBeat)

  const gaps: { start: number; end: number }[] = []
  let cursor = startBeat
  for (const n of protectedInside) {
    if (n.startBeat - cursor >= 0.25) gaps.push({ start: cursor, end: n.startBeat })
    cursor = Math.max(cursor, n.startBeat + n.durationBeats)
  }
  if (endBeat - cursor >= 0.25) gaps.push({ start: cursor, end: endBeat })

  const rng = new SeededRandom(seed)
  const generated: MelodyNote[] = []
  for (const gap of gaps) {
    const result = assemblePhrase(rng, harmonicMap, gap.start, gap.end - gap.start, range, params, density)
    generated.push(...result.notes)
  }

  return [...outside, ...protectedInside, ...generated].sort((a, b) => a.startBeat - b.startBeat)
}
