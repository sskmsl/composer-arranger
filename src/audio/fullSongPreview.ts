export interface PreviewBeatRange {
  startBeat: number
  endBeat: number
}

export function formatPlaybackTime(beat: number, bpm: number): string {
  const seconds = Math.max(0, beat) * 60 / Math.max(1, bpm)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`
}

/**
 * 長い全曲ArrangementをWeb Audioへ一括予約すると、数千Oscillatorが同時に
 * 作られてブラウザーが再生を早期停止する。短い連続区間へ分けて順番に予約する。
 */
export function fullSongPreviewRanges(
  totalBeats: number,
  chunkBeats = 32,
  startBeat = 0,
): PreviewBeatRange[] {
  if (!Number.isFinite(totalBeats) || totalBeats <= 0) return []
  const size = Number.isFinite(chunkBeats) && chunkBeats > 0
    ? chunkBeats
    : 32
  const firstBeat = Number.isFinite(startBeat)
    ? Math.max(0, Math.min(totalBeats, startBeat))
    : 0
  const ranges: PreviewBeatRange[] = []
  for (let rangeStart = firstBeat; rangeStart < totalBeats; rangeStart += size) {
    ranges.push({
      startBeat: rangeStart,
      endBeat: Math.min(totalBeats, rangeStart + size),
    })
  }
  return ranges
}
