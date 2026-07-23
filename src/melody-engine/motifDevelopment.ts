import type { SeededRandom } from "@/core/rng"
import type { MotifEvent } from "./motifCore"

export type DevelopmentOp =
  | "repeat"
  | "sequence"
  | "inversion"
  | "rhythmicVariation"
  | "intervalExpansion"
  | "intervalCompression"
  | "truncation"
  | "answerPhrase"
  | "registerShift"

export interface DevelopedSegment {
  events: MotifEvent[]
  pitches: number[]
  op: DevelopmentOp
}

function scaleIntervals(pitches: number[], factor: number): number[] {
  if (pitches.length === 0) return []
  const first = pitches[0]
  return pitches.map((p) => Math.round(first + (p - first) * factor))
}

export function applyDevelopmentOp(
  op: DevelopmentOp,
  source: { events: MotifEvent[]; pitches: number[] },
  rng: SeededRandom,
  arg?: number,
): DevelopedSegment {
  switch (op) {
    case "repeat":
      return { events: source.events, pitches: [...source.pitches], op }

    case "sequence": {
      const shift = arg ?? rng.pick([-3, -2, 2, 3, 5])
      return { events: source.events, pitches: source.pitches.map((p) => p + shift), op }
    }

    case "inversion": {
      const first = source.pitches[0] ?? 60
      return { events: source.events, pitches: source.pitches.map((p) => first - (p - first)), op }
    }

    case "rhythmicVariation": {
      const events = source.events.map((e) => ({ ...e }))
      if (events.length > 1) {
        const idx = rng.intBetween(0, events.length - 1)
        const target = events[idx]
        if (!target.isRest && target.durationBeats >= 1) {
          // ロングトーンを2つに分割してシンコペーションを作る
          const half = target.durationBeats / 2
          events[idx] = { ...target, durationBeats: half }
          events.splice(idx + 1, 0, { offsetBeats: target.offsetBeats + half, durationBeats: half, isRest: false })
          // 後続のoffsetを再計算
          let cursor = events[idx + 1].offsetBeats + half
          for (let i = idx + 2; i < events.length; i++) {
            events[i] = { ...events[i], offsetBeats: cursor }
            cursor += events[i].durationBeats
          }
          const pitches = [...source.pitches]
          const pitchIdx = source.events.slice(0, idx).filter((e) => !e.isRest).length
          pitches.splice(pitchIdx, 0, pitches[pitchIdx])
          return { events, pitches, op }
        }
      }
      return { events: source.events, pitches: [...source.pitches], op }
    }

    case "intervalExpansion":
      return { events: source.events, pitches: scaleIntervals(source.pitches, arg ?? 1.5), op }

    case "intervalCompression":
      return { events: source.events, pitches: scaleIntervals(source.pitches, arg ?? 0.6), op }

    case "truncation": {
      // arg===0(0音まで切り詰める)を意図的に指定できるよう、Math.maxで1音を強制しない
      const keep = arg ?? Math.ceil(source.pitches.length / 2)
      let pitchCount = 0
      const events: MotifEvent[] = []
      for (const e of source.events) {
        if (!e.isRest) {
          if (pitchCount >= keep) break
          pitchCount++
        }
        events.push(e)
      }
      return { events, pitches: source.pitches.slice(0, keep), op }
    }

    case "answerPhrase": {
      const first = source.pitches[0] ?? 60
      const inverted = source.pitches.map((p) => first - (p - first))
      return { events: source.events, pitches: inverted, op }
    }

    case "registerShift": {
      const shift = arg ?? (rng.chance(0.5) ? 12 : -12)
      return { events: source.events, pitches: source.pitches.map((p) => p + shift), op }
    }

    default:
      return { events: source.events, pitches: [...source.pitches], op: "repeat" }
  }
}

export function weightedDevelopmentOp(
  rng: SeededRandom,
  motifRepeatTarget: number,
  noveltyWeight: number,
  isAnswerSlot: boolean,
): DevelopmentOp {
  if (isAnswerSlot && rng.chance(0.6)) return "answerPhrase"
  const ops: DevelopmentOp[] = ["repeat", "sequence", "rhythmicVariation", "intervalExpansion", "intervalCompression", "inversion"]
  const weights = [
    motifRepeatTarget * 2,
    motifRepeatTarget * 1.4,
    0.6 + noveltyWeight,
    0.4 + noveltyWeight * 0.6,
    0.3 + noveltyWeight * 0.4,
    0.3 + noveltyWeight * 0.6,
  ]
  return rng.weightedPick(ops, weights)
}
