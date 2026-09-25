import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { keyScalePitchClasses } from "@/core/scale"

/**
 * 主旋律の「作りの良さ」を数える物差し。生成の改善を前後で同じ条件で比べるために使う。
 * 目安(ポップスの旋律の一般的な傾向)は、同音連打 15〜20%、跳躍の後に逆向きへ戻る 6〜7割、
 * サビはAメロより数半音高い、最後のサビは安定した音で終わる、など。
 */
export interface MelodyCraftMetrics {
  noteCount: number
  /** 隣り合う音が同じ高さの割合 */
  repeatedPitch: number
  /** 隣り合う音が1〜2半音で動く割合 */
  stepwise: number
  /** 5半音以上の跳躍の割合 */
  leapRate: number
  /** 5半音以上跳んだ後、逆向きに3半音以内で戻る割合(同じフレーズの中の跳躍のみ。1.5拍以上休んだ後はフレーズの切れ目として数えない) */
  leapRecovery: number
  distinctPitches: number
  /** 最もよく使う3つの音が全体に占める割合 */
  top3Share: number
  range: number
  meanPitch: number
  /** 強拍(1・3拍目)の音がコードの音である割合 */
  strongBeatChordTone: number
  outOfScale: number
  endsOnTonic: boolean
  endsOnChordTone: boolean
  finalDurationBeats: number
}

const pc = (pitch: number) => ((pitch % 12) + 12) % 12

export function measureMelodyCraft(
  notes: MelodyNote[],
  chords: ChordEvent[],
  key: string,
  beatsPerBar = 4,
): MelodyCraftMetrics {
  // 演奏上の細かなずれで拍の判定が揺れないよう、16分のグリッドに寄せてから数える
  const sorted = [...notes]
    .map((note) => ({ ...note, startBeat: Math.round(note.startBeat * 4) / 4 }))
    .sort((a, b) => a.startBeat - b.startBeat)
  const scale = keyScalePitchClasses(key)
  const tonic = scale[0]
  const chordAt = (beat: number) => chords.find((chord) => beat >= chord.startBeat - 1e-6 && beat < chord.startBeat + chord.durationBeats - 1e-6)
  const chordTone = (note: MelodyNote) => {
    const chord = chordAt(note.startBeat)
    const parsed = chord ? parseChordSymbol(chord.symbol) : null
    return parsed ? parsed.tones.some((tone) => tone.pitchClass === pc(note.pitch)) : false
  }
  const half = beatsPerBar / 2
  const strong = sorted.filter((note) => Math.abs(note.startBeat % half) < 1e-6)
  const intervals = sorted.slice(1).map((note, index) => note.pitch - sorted[index].pitch)
  const abs = intervals.map(Math.abs)
  const gapAfter = (index: number) => sorted[index + 1].startBeat - (sorted[index].startBeat + sorted[index].durationBeats)
  const leaps = intervals.map((interval, index) => ({ interval, index }))
    .filter(({ interval, index }) => Math.abs(interval) >= 5 && index + 1 < intervals.length && gapAfter(index + 1) <= 1.5)
  const recovered = leaps.filter(({ interval, index }) => {
    const next = intervals[index + 1]
    return Math.sign(next) === -Math.sign(interval) && Math.abs(next) <= 3
  })
  const counts = new Map<number, number>()
  for (const note of sorted) counts.set(note.pitch, (counts.get(note.pitch) ?? 0) + 1)
  const top3 = [...counts.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0)
  const last = sorted.at(-1)
  const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0)
  return {
    noteCount: sorted.length,
    repeatedPitch: ratio(abs.filter((value) => value === 0).length, abs.length),
    stepwise: ratio(abs.filter((value) => value >= 1 && value <= 2).length, abs.length),
    leapRate: ratio(abs.filter((value) => value >= 5).length, abs.length),
    leapRecovery: leaps.length > 0 ? recovered.length / leaps.length : 1,
    distinctPitches: counts.size,
    top3Share: ratio(top3, sorted.length),
    range: sorted.length > 0 ? Math.max(...sorted.map((note) => note.pitch)) - Math.min(...sorted.map((note) => note.pitch)) : 0,
    meanPitch: ratio(sorted.reduce((sum, note) => sum + note.pitch, 0), sorted.length),
    strongBeatChordTone: ratio(strong.filter(chordTone).length, strong.length),
    outOfScale: ratio(sorted.filter((note) => !scale.includes(pc(note.pitch))).length, sorted.length),
    endsOnTonic: last ? pc(last.pitch) === tonic : false,
    endsOnChordTone: last ? chordTone(last) : false,
    finalDurationBeats: last?.durationBeats ?? 0,
  }
}
