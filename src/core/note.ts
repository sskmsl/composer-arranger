/** MIDIノート番号(0-127)。Cores全体でピッチはこの整数のみで表現する。 */
export type Midi = number

export const PITCH_CLASS_NAMES_SHARP = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const

export const PITCH_CLASS_NAMES_FLAT = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
] as const

export function pitchClass(midi: Midi): number {
  return ((midi % 12) + 12) % 12
}

export function octaveOf(midi: Midi): number {
  return Math.floor(midi / 12) - 1
}

export function noteName(midi: Midi, preferFlat = false): string {
  const names = preferFlat ? PITCH_CLASS_NAMES_FLAT : PITCH_CLASS_NAMES_SHARP
  return `${names[pitchClass(midi)]}${octaveOf(midi)}`
}

export function midiToFreq(midi: Midi): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** ノート名(例: "F#4", "Bb3")をMIDI番号へ。オクターブ省略時は4とみなす */
export function parseNoteName(name: string): Midi | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)?$/.exec(name.trim())
  if (!m) return null
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let pc = base[m[1].toUpperCase()]
  if (m[2] === "#") pc += 1
  if (m[2] === "b") pc -= 1
  const octave = m[3] !== undefined ? parseInt(m[3], 10) : 4
  return (octave + 1) * 12 + ((pc + 12) % 12)
}

export function clampToRange(midi: Midi, low: Midi, high: Midi): Midi {
  let m = midi
  while (m < low) m += 12
  while (m > high) m -= 12
  // レンジ自体が1オクターブ未満などで収まらない場合は境界へクランプ
  return Math.min(high, Math.max(low, m))
}
