import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { parseChordSymbol } from "@/core/chord"
import { keyScalePitchClasses } from "@/core/scale"

/** 新しい候補の音高選択だけに使う。時刻・長さ・音数、保存済みの旋律には触れない。 */
export function selectConsonantMelodyPitches(
  source: readonly MelodyNote[], chords: readonly ChordEvent[], key: string, range: { low: number; high: number },
): MelodyNote[] {
  const scale = keyScalePitchClasses(key)
  if (!source.length || !scale.length) return source.map((n) => ({ ...n }))
  const contexts = source.map((note) => {
    const chord = chords.find((c) => note.startBeat >= c.startBeat && note.startBeat < c.startBeat + c.durationBeats)
    const parsed = chord && parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    // 明記されたadd9/b9等は和音の一部。暗黙のavailableTensionPoolは含めない。
    const tones = parsed ? [...new Set([...parsed.tones, ...parsed.tensions].map((t) => t.pitchClass).concat(parsed.bassPc))] : []
    const strong = Math.abs(note.startBeat - Math.round(note.startBeat / 2) * 2) <= .06 || note.durationBeats >= .75
    const clashes = (pitch: number) => !tones.includes(pitch % 12) && tones.some((t) => [1, 11].includes((pitch - t + 120) % 12))
    const safe = (pitch: number) => !tones.length || tones.includes(pitch % 12)
      || scale.includes(pitch % 12) && !clashes(pitch)
    const ornament = !strong && note.durationBeats <= .5 && !safe(note.pitch)
    return { tones, safe, ornament }
  })
  const options = source.map((note, i) => {
    const context = contexts[i]
    if (context.safe(note.pitch)) return [note.pitch]
    const choices = Array.from({ length: range.high - range.low + 1 }, (_, j) => range.low + j).filter(context.safe)
    const nearest = Math.min(...choices.map((p) => Math.abs(p - note.pitch)))
    const local = choices.filter((p) => Math.abs(p - note.pitch) <= nearest + 1)
    return context.ornament ? [note.pitch, ...local] : local.length ? local : [note.pitch]
  })
  type State = { pitch: number; cost: number; parent?: State }
  let states: State[] = options[0].map((pitch) => ({ pitch, cost: Math.abs(pitch - source[0].pitch) }))
  for (let i = 1; i < source.length; i++) {
    const next: State[] = []
    for (const pitch of options[i]) {
      let best: State | undefined
      for (const state of states) {
        // 残す半音階音には、実際の次の音への順次解決を要求する。
        if (!contexts[i - 1].safe(state.pitch) && !(contexts[i].tones.includes(pitch % 12)
          && Math.abs(pitch - state.pitch) >= 1 && Math.abs(pitch - state.pitch) <= 2)) continue
        const direction = Math.sign(source[i].pitch - source[i - 1].pitch)
        const cost = state.cost + Math.abs(pitch - source[i].pitch)
          + (Math.sign(pitch - state.pitch) !== direction ? 100 : 0)
        if (!best || cost < best.cost) best = { pitch, cost, parent: state }
      }
      if (best) next.push(best)
    }
    if (!next.length) return source.map((n) => ({ ...n }))
    states = next
  }
  const end = contexts.at(-1)!
  let best: State | undefined = states.filter((s) => end.safe(s.pitch)).sort((a, b) => a.cost - b.cost)[0]
  if (!best) return source.map((n) => ({ ...n }))
  const pitches = Array<number>(source.length)
  for (let i = source.length - 1; i >= 0; i--) { pitches[i] = best!.pitch; best = best!.parent }
  return source.map((note, i) => pitches[i] === note.pitch ? { ...note } : ({ ...note, pitch: pitches[i],
    plannedToneRole: contexts[i].tones.includes(pitches[i] % 12) ? "chord-tone" : "tension-hold", plannedResolution: undefined }))
}
