import type { ComposerProject } from "./project"
import { parseTimeSignature } from "./section"

/** テンポの指定1つ。beat は四分音符=1拍の位置、bpm はそこから次の指定までのテンポ */
export interface TempoChange {
  beat: number
  bpm: number
}

export interface TempoMap {
  /** 開始位置(0拍)から指定の拍までの秒数 */
  seconds(beat: number): number
  /** 開始位置から指定の秒数だけ進んだ所の拍 */
  beatAt(seconds: number): number
  /** 指定の拍で鳴っているテンポ */
  bpmAt(beat: number): number
}

const MIN_BPM = 20
const MAX_BPM = 300

function clampBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm))
}

/**
 * テンポの変化を含む時間の換算。changes が空なら baseBpm 一定。
 * 0拍より前に指定がなければ baseBpm から始まる。同じ拍の指定は後のものを使う。
 */
export function createTempoMap(baseBpm: number, changes: readonly TempoChange[] = []): TempoMap {
  const points: TempoChange[] = [{ beat: 0, bpm: clampBpm(baseBpm) }]
  for (const change of [...changes].filter((c) => Number.isFinite(c.beat) && Number.isFinite(c.bpm)).sort((a, b) => a.beat - b.beat)) {
    const beat = Math.max(0, change.beat)
    const bpm = clampBpm(change.bpm)
    if (Math.abs(points[points.length - 1].beat - beat) < 1e-9) points[points.length - 1] = { beat, bpm }
    else points.push({ beat, bpm })
  }
  // 各指定の開始秒を前もって積算する
  const startSeconds = [0]
  for (let i = 1; i < points.length; i += 1) {
    startSeconds.push(startSeconds[i - 1] + (points[i].beat - points[i - 1].beat) * 60 / points[i - 1].bpm)
  }
  const segmentForBeat = (beat: number) => {
    let index = 0
    while (index + 1 < points.length && points[index + 1].beat <= beat) index += 1
    return index
  }
  return {
    seconds(beat) {
      if (beat <= 0) return beat * 60 / points[0].bpm
      const index = segmentForBeat(beat)
      return startSeconds[index] + (beat - points[index].beat) * 60 / points[index].bpm
    },
    beatAt(seconds) {
      if (seconds <= 0) return seconds * points[0].bpm / 60
      let index = 0
      while (index + 1 < points.length && startSeconds[index + 1] <= seconds) index += 1
      return points[index].beat + (seconds - startSeconds[index]) * points[index].bpm / 60
    },
    bpmAt(beat) {
      return points[segmentForBeat(Math.max(0, beat))].bpm
    },
  }
}

/** 曲にテンポの変化があるか(どこかのセクションがテンポ指定を持つか) */
export function hasTempoChanges(project: ComposerProject): boolean {
  return project.sections.some((section) => (section.tempoChanges?.length ?? 0) > 0)
}

/**
 * 曲頭からの拍で表した、曲全体のテンポの指定。
 * セクションごとのテンポ指定(セクション頭からの拍)を、並び順どおりに曲の位置へ直す。
 * 指定を持たないセクションは、直前のテンポをそのまま引き継ぐ。
 */
export function songTempoChanges(project: ComposerProject): TempoChange[] {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const changes: TempoChange[] = []
  // 直前と同じテンポの指定(並べ替えに備えて各セクション頭に置いた指定など)は省く
  let current = project.song.tempo
  for (const section of [...project.sections].sort((a, b) => a.startBar - b.startBar)) {
    const sectionStart = (section.startBar - 1) * beatsPerBar
    for (const change of [...(section.tempoChanges ?? [])].sort((a, b) => a.beat - b.beat)) {
      if (change.beat < 0 || change.beat >= section.lengthBars * beatsPerBar) continue
      if (Math.abs(change.bpm - current) < 0.05) continue
      changes.push({ beat: sectionStart + change.beat, bpm: change.bpm })
      current = change.bpm
    }
  }
  return changes
}

/** 曲全体の再生・書き出しに使うテンポの換算 */
export function songTempoMap(project: ComposerProject): TempoMap {
  return createTempoMap(project.song.tempo, songTempoChanges(project))
}

/**
 * 1つのセクションだけを鳴らすときのテンポの指定(セクション頭からの拍)。
 * セクション頭で有効なテンポ(前のセクションから引き継いだものを含む)を0拍目に置く。
 */
export function sectionTempoChanges(project: ComposerProject, sectionId: string): TempoChange[] {
  if (!hasTempoChanges(project)) return []
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return []
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const sectionStart = (section.startBar - 1) * beatsPerBar
  const map = songTempoMap(project)
  const sectionEnd = sectionStart + section.lengthBars * beatsPerBar
  return [
    { beat: 0, bpm: map.bpmAt(sectionStart) },
    ...songTempoChanges(project)
      .filter((change) => change.beat > sectionStart && change.beat < sectionEnd)
      .map((change) => ({ beat: change.beat - sectionStart, bpm: change.bpm })),
  ]
}

/** 曲全体のテンポ(song.tempo)を変えたとき、各セクションのテンポ指定も同じ比率で変える */
export function scaleSectionTempoChanges(
  sections: ComposerProject["sections"],
  ratio: number,
): ComposerProject["sections"] {
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-9) return sections
  return sections.map((section) =>
    section.tempoChanges && section.tempoChanges.length > 0
      ? {
          ...section,
          tempoChanges: section.tempoChanges.map((change) => ({
            ...change,
            bpm: Math.round(clampBpm(change.bpm * ratio) * 10) / 10,
          })),
        }
      : section,
  )
}
