import type { MelodyNote } from "@/core/melody"

/**
 * 「最初から最後まで口ずさめるか」を測る(0〜1)。
 *
 * judgeCoreMotif の歌いやすさは最初の1〜2小節(核)だけを見ており、音域が10半音を超えると点を下げる。
 * ここでは旋律全体を2小節ずつ見て、いちばん歌いにくい所がどれだけ歌えるかを重く見る。
 * 音域の広さは点に入れない(オクターブの跳躍も、きれいな音程なら口ずさめる)。
 *
 * 見るもの:
 *   - 音程の歌いやすさ: 同音・2度・3度・4度・5度・オクターブは歌える。6度はやや難しい。
 *     増4度(減5度)・7度・オクターブを超える跳躍は歌いにくい。ただし休みや長い音で息を継いだ後の跳躍は歌える
 *   - 息継ぎ: 2小節の中に休みか長い音があるか
 *   - 速さ: 音の高さが変わる回数が多すぎないか(同じ音の刻みは速くても歌える)
 *
 * 利用者の録音(My_Recording_3、ピアノ演奏の自動採譜)では、歌いにくい音程は2%だった。
 */
export interface Hummability {
  /** 音程ごとの歌いやすさの平均 */
  intervals: number
  /** いちばん歌いにくい2小節の点 */
  weakest: number
  /** 2小節ごとの点の平均 */
  average: number
  score: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** 1つの音程の歌いやすさ。息継ぎの後(休み・長い音の後)は跳躍でも歌える */
export function intervalSingability(semitones: number, afterBreath: boolean): number {
  const size = Math.abs(semitones)
  if (afterBreath) return 1
  if (size <= 5 || size === 7 || size === 12) return 1
  if (size === 8 || size === 9) return 0.7
  if (size === 6) return 0.2
  if (size === 10 || size === 11) return 0.15
  return 0.2
}

export function measureHummability(source: readonly MelodyNote[], totalBeats: number, windowBeats = 8): Hummability {
  const notes = [...source].sort((a, b) => a.startBeat - b.startBeat)
  if (notes.length < 2) return { intervals: 1, weakest: 1, average: 1, score: 1 }
  const singability = notes.slice(1).map((note, index) => {
    const previous = notes[index]
    const gap = note.startBeat - (previous.startBeat + previous.durationBeats)
    const afterBreath = gap >= 1 || previous.durationBeats >= 2
    return { beat: note.startBeat, value: intervalSingability(note.pitch - previous.pitch, afterBreath) }
  })
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const windows: number[] = []
  for (let start = 0; start < totalBeats - 1e-6; start += windowBeats) {
    const end = Math.min(totalBeats, start + windowBeats)
    const inside = notes.filter((note) => note.startBeat >= start && note.startBeat < end)
    if (inside.length < 2) continue
    const moves = singability.filter((item) => item.beat >= start && item.beat < end).map((item) => item.value)
    const breath = inside.some((note, index) => {
      const next = inside[index + 1]
      const gap = (next?.startBeat ?? end) - (note.startBeat + note.durationBeats)
      return gap >= 0.5 || note.durationBeats >= 1.5
    })
    const pitchChanges = inside.slice(1).filter((note, index) => note.pitch !== inside[index].pitch).length
    const pace = clamp01(1 - Math.max(0, pitchChanges / (end - start) - 1.5) * 0.3)
    windows.push(mean(moves.length ? moves : [1]) * (breath ? 1 : 0.7) * pace)
  }
  const intervals = mean(singability.map((item) => item.value))
  const weakest = windows.length ? Math.min(...windows) : intervals
  const average = windows.length ? mean(windows) : intervals
  return { intervals, weakest, average, score: clamp01(intervals * 0.45 + weakest * 0.35 + average * 0.2) }
}
