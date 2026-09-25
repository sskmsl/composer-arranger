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
  /** 拍頭(1・3拍目)どうしで、旋律とベースが同じ向きに動いて5度・8度(同度)が続いた割合 */
  parallelPerfectRate: number
  /** 属和音の上の導音が、コードが変わった次の音で主音へ上がる割合(該当がなければ1) */
  leadingToneResolution: number
  /** 属七の7度の音が、コードが変わった次の音で2半音以内に下がる割合(該当がなければ1) */
  seventhResolution: number
  /** 各小節の頭で鳴っている音(骨格)どうしが3半音以内でつながる割合 */
  skeletonSmoothness: number
  /** 前半(セクションの半分まで)の最後の音が主音以外で「開いて」終わるか(16拍未満のセクションは true) */
  antecedentOpen: boolean
  /** 拍頭のコード外の音が、1拍以内に2半音以内で下がってコードの音へ解決する「ため息」の数 */
  sighCount: number
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
  const strongNotes = sorted.filter((note) => Math.abs(note.startBeat % half) < 1e-6)
  const strong = (beat: number) => Math.abs(beat % half) < 1e-6
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
  // --- ベースとの関係・導音・骨格・前半の終わり方・ため息 ---
  const parsedAt = (beat: number) => {
    const chord = chordAt(beat)
    return chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
  }
  const soundingAt = (beat: number) => sorted.find((note) => beat >= note.startBeat - 1e-6 && beat < note.startBeat + note.durationBeats - 1e-6)
  const totalBeats = Math.max(...chords.map((chord) => chord.startBeat + chord.durationBeats), ...sorted.map((note) => note.startBeat + note.durationBeats), 0)
  const strongEvents: Array<{ melody: number; bass: number }> = []
  for (let beat = 0; beat < totalBeats; beat += half) {
    const note = soundingAt(beat)
    const parsed = parsedAt(beat)
    if (note && parsed) strongEvents.push({ melody: note.pitch, bass: parsed.bassPc })
  }
  let parallelPairs = 0
  let parallels = 0
  for (let index = 1; index < strongEvents.length; index += 1) {
    const before = strongEvents[index - 1]
    const now = strongEvents[index]
    const melodyMove = Math.sign(now.melody - before.melody)
    const bassDelta = ((now.bass - before.bass) % 12 + 12) % 12
    const bassMove = bassDelta === 0 ? 0 : bassDelta <= 6 ? 1 : -1
    if (melodyMove === 0 || bassMove === 0) continue
    parallelPairs += 1
    const intervalBefore = pc(before.melody - before.bass)
    const intervalNow = pc(now.melody - now.bass)
    if (melodyMove === bassMove && intervalBefore === intervalNow && (intervalNow === 0 || intervalNow === 7)) parallels += 1
  }
  const nextOf = (index: number) => {
    const note = sorted[index]
    const next = sorted[index + 1]
    return next && next.startBeat - (note.startBeat + note.durationBeats) <= 1.5 ? next : undefined
  }
  const dominantRoot = tonic === undefined ? -1 : (tonic + 7) % 12
  const leadingTone = tonic === undefined ? -1 : (tonic + 11) % 12
  const chordSeventh = tonic === undefined ? -1 : (tonic + 5) % 12
  let leadingCases = 0
  let leadingResolved = 0
  let seventhCases = 0
  let seventhResolved = 0
  sorted.forEach((note, index) => {
    const parsed = parsedAt(note.startBeat)
    const next = nextOf(index)
    // 同じコードの中での動きは数えず、コードが変わる所での行き先だけを見る
    if (!parsed || !next || parsed.rootPc !== dominantRoot || chordAt(next.startBeat) === chordAt(note.startBeat)) return
    if (pc(note.pitch) === leadingTone) {
      leadingCases += 1
      if (pc(next.pitch) === tonic) leadingResolved += 1
    }
    if (pc(note.pitch) === chordSeventh && parsed.tones.some((tone) => tone.pitchClass === chordSeventh)) {
      seventhCases += 1
      if (note.pitch - next.pitch >= 1 && note.pitch - next.pitch <= 2) seventhResolved += 1
    }
  })
  const skeleton: number[] = []
  for (let beat = 0; beat < totalBeats; beat += beatsPerBar) {
    const note = soundingAt(beat)
    if (note) skeleton.push(note.pitch)
  }
  const skeletonMoves = skeleton.slice(1).map((pitch, index) => Math.abs(pitch - skeleton[index]))
  const firstHalfLast = [...sorted].reverse().find((note) => note.startBeat < totalBeats / 2)
  const sighCount = sorted.filter((note, index) => {
    const next = sorted[index + 1]
    return strong(note.startBeat) === true && !chordTone(note) && next
      && next.startBeat - note.startBeat <= 1 + 1e-6 && note.pitch - next.pitch >= 1 && note.pitch - next.pitch <= 2 && chordTone(next)
  }).length
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
    strongBeatChordTone: ratio(strongNotes.filter(chordTone).length, strongNotes.length),
    outOfScale: ratio(sorted.filter((note) => !scale.includes(pc(note.pitch))).length, sorted.length),
    endsOnTonic: last ? pc(last.pitch) === tonic : false,
    endsOnChordTone: last ? chordTone(last) : false,
    finalDurationBeats: last?.durationBeats ?? 0,
    parallelPerfectRate: ratio(parallels, parallelPairs),
    leadingToneResolution: leadingCases > 0 ? leadingResolved / leadingCases : 1,
    seventhResolution: seventhCases > 0 ? seventhResolved / seventhCases : 1,
    skeletonSmoothness: skeletonMoves.length > 0 ? skeletonMoves.filter((move) => move <= 3).length / skeletonMoves.length : 1,
    antecedentOpen: totalBeats < 16 || !firstHalfLast || pc(firstHalfLast.pitch) !== tonic,
    sighCount,
  }
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * 物差しをまとめた「作りの良さ」の点数(0〜100)。候補を選ぶときの参考に使う。
 * 目安から外れるほど下がる。どれか1つが極端に悪い候補を避け、全体に整った候補を選ぶための重み付け。
 * resolving はサビ・アウトロのように主音で落ち着いて終わりたいセクション。
 */
export function scoreMelodyCraft(metrics: MelodyCraftMetrics, options: { resolving: boolean }): number {
  const parts: Array<[score: number, weight: number]> = [
    // 同じ音の連打は15%程度までは自然。それを超えるほど下げる
    [1 - clamp01((metrics.repeatedPitch - 0.15) / 0.25), 1.5],
    // 順次進行(1〜2半音)が少なすぎると跳んでばかりの旋律になる
    [clamp01(metrics.stepwise / 0.4), 1],
    [metrics.leapRecovery, 1.2],
    // 同じ数音の中を回り続けない
    [1 - clamp01((metrics.top3Share - 0.55) / 0.35), 1.2],
    [clamp01((metrics.strongBeatChordTone - 0.5) / 0.4), 1],
    [1 - clamp01(metrics.parallelPerfectRate / 0.3), 0.6],
    [(metrics.leadingToneResolution + metrics.seventhResolution) / 2, 0.6],
    [metrics.skeletonSmoothness, 0.8],
    [metrics.antecedentOpen ? 1 : 0, 0.4],
    [options.resolving ? (metrics.endsOnTonic ? 1 : 0) : metrics.endsOnChordTone ? 1 : 0, 0.8],
  ]
  const total = parts.reduce((sum, [, weight]) => sum + weight, 0)
  return (parts.reduce((sum, [score, weight]) => sum + score * weight, 0) / total) * 100
}
