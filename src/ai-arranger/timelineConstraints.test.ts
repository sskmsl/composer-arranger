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

  it("自然な言い換えでも主旋律開始と完全無音を抽出する", () => {
    expect(parseArrangementTimelineConstraints(
      "メロディは9小節目から。25小節から28小節までは何も鳴らさない",
      80,
    )).toMatchObject({
      fullSilenceRanges: [{ startBar: 25, endBar: 28 }],
      melodyStartBar: 9,
    })
  })

  it("主旋律だけ休む指定と、全パートを止める指定を区別する", () => {
    expect(parseArrangementTimelineConstraints(
      "冒頭1〜8小節は主旋律を入れない。45～48小節は音を全部消す",
      80,
    )).toMatchObject({
      fullSilenceRanges: [{ startBar: 45, endBar: 48 }],
      melodySilenceRanges: [{ startBar: 1, endBar: 8 }],
    })
  })

  it("ラスト・冒頭・Section直前を実際の曲位置へ解決する", () => {
    const sections = [
      { id: "intro", name: "Intro", role: "intro" as const, startBar: 1, lengthBars: 8 },
      { id: "verse", name: "Verse 1", role: "verse" as const, startBar: 9, lengthBars: 8 },
      { id: "chorus", name: "Chorus 2", role: "chorus" as const, startBar: 17, lengthBars: 8 },
    ]
    expect(parseArrangementTimelineConstraints(
      "Intro は8小節メロディなし。Chorus 2の直前で全休止。ラスト2小節は完全無音",
      24,
      sections,
    )).toMatchObject({
      fullSilenceRanges: [{ startBar: 16, endBar: 16 }, { startBar: 23, endBar: 24 }],
      melodySilenceRanges: [{ startBar: 1, endBar: 8 }],
    })
  })

  it("最初の数小節を伴奏だけにする指示を主旋律休止へ変換する", () => {
    expect(parseArrangementTimelineConstraints("最初の4小節は伴奏だけ", 32)).toMatchObject({
      fullSilenceRanges: [],
      melodySilenceRanges: [{ startBar: 1, endBar: 4 }],
    })
  })

  it("Section名を伴う最初・最後の指定を曲頭や曲末ではなくSection内へ解決する", () => {
    const sections = [
      { id: "intro", name: "INTRO", role: "intro" as const, startBar: 1, lengthBars: 8 },
      { id: "final", name: "FINAL CHORUS", role: "chorus" as const, startBar: 89, lengthBars: 8 },
    ]
    expect(parseArrangementTimelineConstraints(
      "FINAL CHORUSの最初の2小節は主旋律なし",
      96,
      sections,
    ).melodySilenceRanges).toEqual([{ startBar: 89, endBar: 90 }])
    expect(parseArrangementTimelineConstraints(
      "FINAL CHORUSの最後の2小節は完全無音",
      96,
      sections,
    ).fullSilenceRanges).toEqual([{ startBar: 95, endBar: 96 }])
  })
})
