export interface PreviewBeatRange {
  startBeat: number
  endBeat: number
}

/**
 * 長い全曲ArrangementをWeb Audioへ一括予約すると、数千Oscillatorが同時に
 * 作られてブラウザーが再生を早期停止する。短い連続区間へ分けて順番に予約する。
 */
export function fullSongPreviewRanges(
  totalBeats: number,
  chunkBeats = 32,
): PreviewBeatRange[] {
  if (!Number.isFinite(totalBeats) || totalBeats <= 0) return []
  const size = Number.isFinite(chunkBeats) && chunkBeats > 0
    ? chunkBeats
    : 32
  const ranges: PreviewBeatRange[] = []
  for (let startBeat = 0; startBeat < totalBeats; startBeat += size) {
    ranges.push({
      startBeat,
      endBeat: Math.min(totalBeats, startBeat + size),
    })
  }
  return ranges
}
