import { describe, expect, it } from "vitest"
import { formatPlaybackTime, fullSongPreviewRanges } from "./fullSongPreview"

describe("full song arrangement preview", () => {
  it("長い曲をWeb Audioへ一括予約せず32拍単位へ分割する", () => {
    const ranges = fullSongPreviewRanges(660)
    expect(ranges).toHaveLength(21)
    expect(ranges[0]).toEqual({ startBeat: 0, endBeat: 32 })
    expect(ranges.at(-1)).toEqual({ startBeat: 640, endBeat: 660 })
  })

  it("端数のない曲と無効な長さを安全に扱う", () => {
    expect(fullSongPreviewRanges(64)).toEqual([
      { startBeat: 0, endBeat: 32 },
      { startBeat: 32, endBeat: 64 },
    ])
    expect(fullSongPreviewRanges(0)).toEqual([])
  })

  it("再生バーで指定した途中位置から曲末まで分割する", () => {
    expect(fullSongPreviewRanges(100, 32, 45)).toEqual([
      { startBeat: 45, endBeat: 77 },
      { startBeat: 77, endBeat: 100 },
    ])
    expect(fullSongPreviewRanges(100, 32, 100)).toEqual([])
  })

  it("拍位置をTempoに応じた時間表示へ変換する", () => {
    expect(formatPlaybackTime(0, 120)).toBe("0:00")
    expect(formatPlaybackTime(128, 128)).toBe("1:00")
  })
})
