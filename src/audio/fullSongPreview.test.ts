import { describe, expect, it } from "vitest"
import { fullSongPreviewRanges } from "./fullSongPreview"

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
})
