import { parseChordSymbol } from "@/core/chord"
import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import { keyScalePitchClasses } from "@/core/scale"
import { SeededRandom } from "@/core/rng"

/**
 * 主旋律の後ろで流れ続ける対旋律(カウンターライン)。
 * 既存の対旋律エンジンは主旋律の隙間に短く答える作りなので、こちらは「ずっと鳴っている、もう一本の線」を作る。
 *
 * - コードの3度・7度(無ければ根音・5度)を骨組みにし、前の音から一番近い音へ滑らかにつなぐ
 * - 主旋律が細かく動いている所では伸ばし、主旋律が伸ばしている・休んでいる所で動く(リズムの補い合い)
 * - 主旋律と同じ音(オクターブ違いを含む)で重ねない、主旋律と交差しない、5度・8度の平行を避ける
 * - 主旋律と逆向きに動くことを少し好む
 */

export type FlowingCounterPlacement = "below" | "above"

export interface FlowingCounterInput {
  melody: MelodyNote[]
  /** セクション先頭からの拍位置で並んだコード */
  chords: ChordEvent[]
  key: string
  totalBeats: number
  beatsPerBar: number
  seed: number
  placement: FlowingCounterPlacement
}

interface Slot {
  start: number
  duration: number
  /** この区間に重なるコード */
  chordPcs: number[]
  guidePcs: number[]
  /** この区間での主旋律の動きの多さ(発音数) */
  melodyOnsets: number
  /** 前の区間と同じコードか(コードの変わり目では、骨組みの音へ動く) */
  sameChordAsPrevious: boolean
}

const MIN_PITCH = 45
const MAX_PITCH = 88

/** 指定の拍で鳴っている主旋律の音 */
function melodyAt(melody: MelodyNote[], beat: number): MelodyNote | undefined {
  return melody.find((note) => beat >= note.startBeat - 1e-6 && beat < note.startBeat + note.durationBeats - 1e-6)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 64
}

/** 半小節ごとの区間。コードの変わり目では必ず区切る */
function buildSlots(input: FlowingCounterInput): Slot[] {
  const half = input.beatsPerBar / 2
  const boundaries = new Set<number>([0, input.totalBeats])
  for (let beat = half; beat < input.totalBeats; beat += half) boundaries.add(Math.round(beat * 1000) / 1000)
  for (const chord of input.chords) {
    if (chord.startBeat > 0 && chord.startBeat < input.totalBeats) boundaries.add(Math.round(chord.startBeat * 1000) / 1000)
  }
  const points = [...boundaries].sort((a, b) => a - b)
  const slots: Slot[] = []
  let lastChordIndex = -1
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const duration = points[index + 1] - start
    if (duration < 0.49) continue
    const chordIndex = input.chords.findIndex((candidate) => start >= candidate.startBeat - 1e-6 && start < candidate.startBeat + candidate.durationBeats - 1e-6)
    const chord = input.chords[chordIndex]
    const parsed = chord ? parseChordSymbol(chord.symbol) : null
    if (!parsed) continue
    const chordPcs = [...new Set(parsed.tones.filter((tone) => tone.role !== "tension").map((tone) => tone.pitchClass))]
    const guide = parsed.tones.filter((tone) => tone.role === "third" || tone.role === "seventh" || tone.role === "sixth").map((tone) => tone.pitchClass)
    slots.push({
      start,
      duration,
      chordPcs,
      guidePcs: guide.length > 0 ? guide : chordPcs,
      melodyOnsets: input.melody.filter((note) => note.startBeat >= start - 1e-6 && note.startBeat < start + duration - 1e-6).length,
      sameChordAsPrevious: slots.length > 0 && lastChordIndex === chordIndex,
    })
    lastChordIndex = chordIndex
  }
  return slots
}

/** 中心の音域に近い、あるピッチクラスの音の候補(上下1オクターブずつ) */
function pitchesFor(pc: number, center: number): number[] {
  const base = center - ((((center - pc) % 12) + 12) % 12)
  return [base - 12, base, base + 12, base + 24].filter((pitch) => pitch >= MIN_PITCH && pitch <= MAX_PITCH)
}

export function generateFlowingCounterLine(input: FlowingCounterInput): MelodyNote[] {
  const melody = [...input.melody].sort((a, b) => a.startBeat - b.startBeat)
  if (melody.length === 0 || input.chords.length === 0) return []
  const rng = new SeededRandom(input.seed)
  const scale = keyScalePitchClasses(input.key)
  const melodyCenter = median(melody.map((note) => note.pitch))
  const center = input.placement === "below"
    ? Math.max(MIN_PITCH + 5, Math.min(72, melodyCenter - 9))
    : Math.min(MAX_PITCH - 5, melodyCenter + 8)
  const slots = buildSlots(input)
  const notes: MelodyNote[] = []
  let previous: number | null = null
  let previousMelody: number | null = null

  /** 主旋律に対して置いてよい音か(交差・重なり・半音ぶつかりを避ける) */
  const allowedAgainst = (pitch: number, melodyPitch: number | undefined): boolean => {
    if (melodyPitch === undefined) return true
    if (input.placement === "below" && pitch > melodyPitch - 3) return false
    if (input.placement === "above" && pitch < melodyPitch + 3) return false
    const interval = Math.abs(pitch - melodyPitch) % 12
    return interval !== 0 && interval !== 1 && interval !== 11
  }

  /** コードの音から選ぶ。3度・7度(guidePcs)を少し好み、前の音から近い音ほど良い */
  const choose = (chordPcs: number[], guidePcs: number[], at: number, hold = false, chordChange = false): number | null => {
    const melodyNote = melodyAt(melody, at)
    const options = chordPcs.flatMap((pc) => pitchesFor(pc, center))
      .filter((pitch) => allowedAgainst(pitch, melodyNote?.pitch))
    if (options.length === 0) return null
    const scored = options.map((pitch) => {
      const step = previous === null ? Math.abs(pitch - center) / 2 : Math.abs(pitch - previous)
      let cost = step <= 2 ? step : step * 1.6
      if (step > 7) cost += 12
      if (guidePcs.includes(((pitch % 12) + 12) % 12)) cost -= 0.9
      cost += Math.abs(pitch - center) * 0.25
      // 同じコードの中で主旋律が細かく動く所では同じ音を伸ばし、それ以外(コードの変わり目・主旋律が落ち着いている所)では動く
      if (previous !== null && step === 0) cost += hold ? -1.2 : chordChange ? 1.2 : 0.8
      if (previous !== null && previousMelody !== null && melodyNote) {
        const counterMove = Math.sign(pitch - previous)
        const melodyMove = Math.sign(melodyNote.pitch - previousMelody)
        if (counterMove !== 0 && counterMove === -melodyMove) cost -= 0.6
        // 5度・8度の平行(同じ向きに動いて、前も今も完全音程)
        const before = Math.abs(previous - previousMelody) % 12
        const now = Math.abs(pitch - melodyNote.pitch) % 12
        if (counterMove === melodyMove && counterMove !== 0 && (before === 7 || before === 0) && before === now) cost += 4
      }
      return { pitch, cost: cost + rng.next() * 0.3 }
    })
    scored.sort((a, b) => a.cost - b.cost)
    return scored[0].pitch
  }

  /** 前の音から次の骨組みの音へ、音階の上で1歩近づく音 */
  const passingToward = (from: number, to: number): number | null => {
    if (from === to) return null
    const direction = Math.sign(to - from)
    for (let pitch = from + direction; pitch !== to; pitch += direction) {
      if (scale.includes(((pitch % 12) + 12) % 12)) return pitch
    }
    return null
  }

  slots.forEach((slot, index) => {
    const target = choose(slot.chordPcs, slot.guidePcs, slot.start, slot.melodyOnsets >= 2 && slot.sameChordAsPrevious, !slot.sameChordAsPrevious)
    const melodyNote = melodyAt(melody, slot.start)
    if (target === null) {
      previous = null
      return
    }
    const next = slots[index + 1]
    // 主旋律が伸ばしている・休んでいる区間では、後半で次の音へ向かって動く
    const moves = slot.melodyOnsets <= 1 && slot.duration >= 2 && next !== undefined
    const isLast = index === slots.length - 1
    const length = isLast ? Math.max(0.5, slot.duration - 0.5) : slot.duration
    if (moves) {
      previous = target
      previousMelody = melodyNote?.pitch ?? previousMelody
      const upcoming = choose(next.chordPcs, next.guidePcs, next.start, false, !next.sameChordAsPrevious)
      const passing = upcoming !== null ? passingToward(target, upcoming) : null
      const middle = slot.start + slot.duration / 2
      const melodyInMiddle = melodyAt(melody, middle)?.pitch
      const passingPitch = passing !== null && allowedAgainst(passing, melodyInMiddle) ? passing : null
      // 次の音と同じなら、同じコードの別の近い音へ動いて戻る(分散和音のように)
      const chordStep = passingPitch === null
        ? slot.chordPcs.flatMap((pc) => pitchesFor(pc, target))
          .filter((pitch) => pitch !== target && Math.abs(pitch - target) <= 5 && allowedAgainst(pitch, melodyInMiddle))
          .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? null
        : null
      const secondPitch = passingPitch ?? chordStep
      if (secondPitch !== null) {
        notes.push(note(slot.start, slot.duration / 2, target))
        notes.push(note(middle, slot.duration / 2, secondPitch, passingPitch !== null ? "passing-tone" : "chord-tone"))
        previous = secondPitch
        return
      }
    }
    // 同じ音が続くなら、音をつなげて伸ばす(弦のレガートのように)
    const last = notes.at(-1)
    if (last && last.pitch === target && Math.abs(last.startBeat + last.durationBeats - slot.start) < 1e-6) {
      last.durationBeats += length
    } else {
      notes.push(note(slot.start, length, target))
    }
    previous = target
    previousMelody = melodyNote?.pitch ?? previousMelody
  })
  return notes
}

function note(
  startBeat: number,
  durationBeats: number,
  pitch: number,
  plannedToneRole: MelodyNote["plannedToneRole"] = "chord-tone",
): MelodyNote {
  return {
    id: `flow-${startBeat}-${pitch}`,
    startBeat,
    durationBeats,
    pitch,
    velocity: 64,
    locks: [],
    plannedToneRole,
  }
}
