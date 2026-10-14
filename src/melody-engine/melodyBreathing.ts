import type { MelodyNote } from "@/core/melody"

/** 新規生成の後段だけで使う。音を消さず、フレーズ末尾の音価に息継ぎを作る。 */
export function shapeMelodyBreathing(notes: readonly MelodyNote[], totalBeats: number, beatsPerBar = 4): MelodyNote[] {
  const result = notes.map((n) => ({ ...n })).sort((a, b) => a.startBeat - b.startBeat)
  const block = beatsPerBar * 4
  for (let start = 0; start < totalBeats; start += block) {
    const end = Math.min(totalBeats, start + block)
    const hasRest = result.some((n, i) => i > 0 && Math.min(n.startBeat, end)
      - Math.max(result[i - 1].startBeat + result[i - 1].durationBeats, start) >= 1 - 1e-6)
    if (hasRest) continue
    const pairs = result.flatMap((n, i) => {
      const next = result[i + 1]
      if (!next || n.startBeat < start || next.startBeat > end || next.startBeat - n.startBeat < 1.125) return []
      // 終止音自体は短くせず、区間内の後半にあるフレーズの切れ目を優先する。
      return [{ index: i, cost: Math.abs(next.startBeat - (end - beatsPerBar / 2)) }]
    }).sort((a, b) => a.cost - b.cost)
    if (pairs[0]) {
      const index = pairs[0].index
      result[index].durationBeats = Math.min(result[index].durationBeats, result[index + 1].startBeat - result[index].startBeat - 1)
    }
  }
  return result
}
