/**
 * 決定論的な擬似乱数生成器(mulberry32)。
 * Math.random()は再現不可能なため、同一seed・同一入力から同一結果を
 * 再生成できるという受け入れ条件(18章-13)を満たすためにここへ集約する。
 */
export class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state |= 0
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0)
    let r = this.next() * total
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]
      if (r <= 0) return items[i]
    }
    return items[items.length - 1]
  }

  intBetween(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** -1 / 0 / +1 の小さな揺らぎ */
  jitter(): number {
    const r = this.next()
    return r < 0.25 ? -1 : r < 0.75 ? 0 : 1
  }
}

export function createSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}
