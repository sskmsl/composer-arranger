import type { MelodyNote } from "./melody"
import type { Section } from "./section"

export interface CandidatePlacement {
  firstSectionBar: number
  lastSectionBar: number
  firstSongBar: number
  lastSongBar: number
  label: string
}

/**
 * Section相対のノート位置を、Logic Proで迷わない曲全体の小節位置へ変換する。
 * 音価が小節線で終わる音は、次小節まで使った扱いにしない。
 */
export function candidatePlacement(
  section: Section,
  notes: MelodyNote[],
  beatsPerBar: number,
): CandidatePlacement | null {
  if (notes.length === 0 || beatsPerBar <= 0) return null

  const firstBeat = Math.max(0, Math.min(...notes.map((note) => note.startBeat)))
  const lastBeat = Math.max(
    firstBeat,
    ...notes.map((note) => note.startBeat + Math.max(0, note.durationBeats)),
  )
  const firstSectionBar = Math.floor(firstBeat / beatsPerBar) + 1
  const lastSectionBar = Math.max(
    firstSectionBar,
    Math.floor(Math.max(firstBeat, lastBeat - 0.0001) / beatsPerBar) + 1,
  )
  const firstSongBar = section.startBar + firstSectionBar - 1
  const lastSongBar = section.startBar + lastSectionBar - 1
  const songRange =
    firstSongBar === lastSongBar
      ? `${firstSongBar}小節目`
      : `${firstSongBar}〜${lastSongBar}小節`
  const sectionRange =
    firstSectionBar === lastSectionBar
      ? `${firstSectionBar}小節目`
      : `${firstSectionBar}〜${lastSectionBar}小節目`

  return {
    firstSectionBar,
    lastSectionBar,
    firstSongBar,
    lastSongBar,
    label: `推奨配置：曲全体の${songRange}（${section.name}の${sectionRange}）`,
  }
}
