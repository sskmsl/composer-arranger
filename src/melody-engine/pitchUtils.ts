import { pitchClass, clampToRange, type Midi } from "@/core/note"

/**
 * candidateに最も近い、許可ピッチクラス集合に属するMIDIノートを探す。
 * 輪郭(上行/下行)をなるべく保つため、まずcandidate自身を試し、
 * その後は半音単位で外側へ探索する。
 */
export function nearestAllowedPitch(
  candidate: Midi,
  allowedPitchClasses: readonly number[],
  range: { low: Midi; high: Midi },
): Midi {
  const c = clampToRange(Math.round(candidate), range.low, range.high)
  if (allowedPitchClasses.includes(pitchClass(c))) return c

  for (let d = 1; d <= 12; d++) {
    const up = c + d
    const down = c - d
    if (up <= range.high && allowedPitchClasses.includes(pitchClass(up))) return up
    if (down >= range.low && allowedPitchClasses.includes(pitchClass(down))) return down
  }
  return c
}

/**
 * Issue #13: テンション/経過音候補をKeyのScaleへ軽く寄せる。Scaleとの共通部分が
 * 存在する場合だけそちらへ絞り、共通部分が無ければ元の候補集合(コードのUsable Tone)
 * をそのまま使う(和声的な妥当性を壊さない範囲でのみKeyを反映する)。
 */
export function withKeyBias(usable: readonly number[], keyScalePitchClasses?: number[]): readonly number[] {
  if (!keyScalePitchClasses || keyScalePitchClasses.length === 0) return usable
  const inScale = usable.filter((pc) => keyScalePitchClasses.includes(pc))
  return inScale.length > 0 ? inScale : usable
}

export function nearestPitchClassAbove(pc: number, from: Midi): Midi {
  let m = from
  while (pitchClass(m) !== ((pc % 12) + 12) % 12) m++
  return m
}
