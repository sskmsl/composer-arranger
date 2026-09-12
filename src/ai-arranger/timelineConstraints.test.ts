import { describe, expect, it } from "vitest"
import { parseArrangementTimelineConstraints } from "./timelineConstraints"

describe("AI arrangement timeline constraints", () => {
  it("複数の完全無音範囲と主旋律の開始小節を日本語指示から抽出する", () => {
    expect(parseArrangementTimelineConstraints(
      "25〜28 / 45〜48 / 65〜68小節は完全無音。メロディーの始まりは9小節目からにしたい",
      156,
    )).toEqual({
      preserveMelody: true,
      fullSilenceRanges: [
        { startBar: 25, endBar: 28 },
        { startBar: 45, endBar: 48 },
        { startBar: 65, endBar: 68 },
      ],
      melodySilenceRanges: [],
      melodyStartBar: 9,
    })
  })

  it("全角数字を扱い、曲長の外側は末尾へ収める", () => {
    expect(parseArrangementTimelineConstraints(
      "９９〜１２０小節を完全に無音。９小節目から主旋律",
      100,
    )).toMatchObject({
      fullSilenceRanges: [{ startBar: 99, endBar: 100 }],
      melodyStartBar: 9,
    })
  })
})
