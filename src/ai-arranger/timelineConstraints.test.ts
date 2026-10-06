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

  it("各範囲に小節と書いた列挙も、すべて完全無音にする", () => {
    expect(parseArrangementTimelineConstraints(
      "25〜28小節、45〜48小節、65〜68小節は完全無音",
      80,
    ).fullSilenceRanges).toEqual([
      { startBar: 25, endBar: 28 },
      { startBar: 45, endBar: 48 },
      { startBar: 65, endBar: 68 },
    ])
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

  it("読点で続く複数の構成指示を両方反映する", () => {
    const sections = [
      { id: "pre", name: "PRE CHORUS", role: "pre-chorus" as const, startBar: 81, lengthBars: 8 },
      { id: "final", name: "FINAL CHORUS", role: "chorus" as const, startBar: 89, lengthBars: 8 },
    ]
    expect(parseArrangementTimelineConstraints(
      "FINAL CHORUSの直前で全休止、ラスト1小節も無音",
      96,
      sections,
    ).fullSilenceRanges).toEqual([
      { startBar: 88, endBar: 88 },
      { startBar: 96, endBar: 96 },
    ])
  })

  it("役割名が複数Sectionに当たる場合は同じ役割の全Sectionへ適用する", () => {
    const sections = [
      { id: "verse-1", name: "VERSE 1", role: "verse" as const, startBar: 17, lengthBars: 8 },
      { id: "chorus-1", name: "CHORUS 1", role: "chorus" as const, startBar: 25, lengthBars: 8 },
      { id: "verse-2", name: "VERSE 2", role: "verse" as const, startBar: 41, lengthBars: 8 },
      { id: "chorus-2", name: "CHORUS 2", role: "chorus" as const, startBar: 49, lengthBars: 8 },
    ]
    expect(parseArrangementTimelineConstraints(
      "Aメロの最初の2小節は無音。サビ前で一瞬止めて",
      64,
      sections,
    ).fullSilenceRanges).toEqual([
      { startBar: 17, endBar: 18 },
      { startBar: 24, endBar: 24 },
      { startBar: 41, endBar: 42 },
      { startBar: 48, endBar: 48 },
    ])
  })

  it("明示したSection名は同じ役割の他Sectionへ広げない", () => {
    const sections = [
      { id: "verse-1", name: "VERSE 1", role: "verse" as const, startBar: 17, lengthBars: 8 },
      { id: "verse-2", name: "VERSE 2", role: "verse" as const, startBar: 41, lengthBars: 8 },
    ]
    expect(parseArrangementTimelineConstraints(
      "VERSE 2の最初の2小節は無音",
      64,
      sections,
    ).fullSilenceRanges).toEqual([{ startBar: 41, endBar: 42 }])
  })

  it("大サビとFINAL CHORUSを、日本語名・英語名に関係なく最後のサビだけへ解決する", () => {
    const sections = [
      { id: "intro", name: "イントロ", role: "intro" as const, startBar: 1, lengthBars: 8 },
      { id: "chorus-1", name: "サビ", role: "chorus" as const, startBar: 25, lengthBars: 8 },
      { id: "chorus-2", name: "Chorus 2", role: "chorus" as const, startBar: 41, lengthBars: 8 },
      { id: "final", name: "Final Chorus", role: "chorus" as const, startBar: 57, lengthBars: 8 },
      { id: "outro", name: "アウトロ", role: "outro" as const, startBar: 65, lengthBars: 8 },
    ]
    expect(parseArrangementTimelineConstraints("FINAL CHORUS直前で全休止", 72, sections).fullSilenceRanges)
      .toEqual([{ startBar: 56, endBar: 56 }])
    expect(parseArrangementTimelineConstraints("大サビの直前で全休止", 72, sections).fullSilenceRanges)
      .toEqual([{ startBar: 56, endBar: 56 }])
    expect(parseArrangementTimelineConstraints("ラスト2小節は完全無音", 72, sections).fullSilenceRanges)
      .toEqual([{ startBar: 71, endBar: 72 }])
  })

  it("日本語名でも同じ役割のAメロとサビすべてへ適用する", () => {
    const sections = [
      { id: "verse-1", name: "Aメロ", role: "verse" as const, startBar: 9, lengthBars: 8 },
      { id: "chorus-1", name: "サビ", role: "chorus" as const, startBar: 17, lengthBars: 8 },
      { id: "verse-2", name: "Aメロ2", role: "verse" as const, startBar: 25, lengthBars: 8 },
      { id: "chorus-2", name: "サビ2", role: "chorus" as const, startBar: 33, lengthBars: 8 },
    ]
    expect(parseArrangementTimelineConstraints("すべてのAメロの最初の2小節は無音。サビ前で一瞬止める", 40, sections).fullSilenceRanges)
      .toEqual([
        { startBar: 9, endBar: 10 },
        { startBar: 16, endBar: 16 },
        { startBar: 25, endBar: 26 },
        { startBar: 32, endBar: 32 },
      ])
  })
})
