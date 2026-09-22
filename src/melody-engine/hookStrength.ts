import type { MelodyNote } from "@/core/melody"

/**
 * 記憶性の補助指標。冒頭の短い核が、移高や語尾の小変更を伴って戻るかを評価する。
 * 聴感の保証ではないため、既存の和声・歌唱性・多様性の評価と併用する。
 * 冒頭8箇所×3〜5音だけを候補にし、長いセクションでも探索量を抑える。
 */
export function computeHookStrength(notes: MelodyNote[]): number {
  if (notes.length < 6) return 0
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  let best = 0
  for (const length of [3, 4, 5]) {
    for (let start = 0; start < Math.min(8, sorted.length - length * 2 + 1); start++) {
      const motif = sorted.slice(start, start + length)
      const intervals = motif.slice(1).map((note, i) => note.pitch - motif[i].pitch)
      const gaps = motif.slice(1).map((note, i) => note.startBeat - motif[i].startBeat)
      if (gaps.some((gap) => gap <= 0)) continue
      const pitchIdentity = Math.min(1, new Set(intervals).size / 2) *
        (intervals.some((interval) => interval !== 0) ? 1 : 0)
      const rhythmIdentity = Math.min(1, (new Set(gaps.map((gap) => Math.round(gap * 8))).size - 1) / 2)
      // 同音・等間隔だけの反復はフックとして加点しない。リズム主体の核は残す。
      const identity = Math.max(pitchIdentity, rhythmIdentity)
      if (identity === 0) continue
      let returns = 0
      for (let next = start + length; next + length <= sorted.length; next++) {
        const candidate = sorted.slice(next, next + length)
        let pitchFit = 0
        let rhythmFit = 0
        for (let i = 0; i < length - 1; i++) {
          const interval = candidate[i + 1].pitch - candidate[i].pitch
          // 同方向でも跳躍幅が違えば別の音型。全体の移高は同じ核として扱う。
          pitchFit += Math.sign(interval) === Math.sign(intervals[i])
            ? Math.max(0, 1 - Math.abs(interval - intervals[i]) / 3) : 0
          const gap = candidate[i + 1].startBeat - candidate[i].startBeat
          rhythmFit += Math.max(0, 1 - Math.abs(gap - gaps[i]) / Math.max(gaps[i], 0.25))
        }
        pitchFit /= length - 1
        rhythmFit /= length - 1
        const durationFit = motif.reduce((sum, note, i) => sum + Math.max(0,
          1 - Math.abs(note.durationBeats - candidate[i].durationBeats) / Math.max(note.durationBeats, 0.25)), 0) / length
        if (pitchFit >= 0.65 && rhythmFit >= 0.8 && durationFit >= 0.65) {
          returns += pitchFit * rhythmFit * durationFit
          next += length - 1 // 重なる窓を別の再登場として数えない
        }
      }
      // 一度の再登場でも評価し、二度で飽和。延々と反復するほど有利にはしない。
      best = Math.max(best, identity * Math.min(1, returns / 2))
    }
  }
  return best
}
