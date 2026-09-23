import { describe, expect, it } from "vitest"
import { parseChordSymbol } from "./chord"
import {
  COMPOSER_SONG_EXCHANGE_FORMAT,
  composerSongExchangeToProject,
  isComposerSongExchange,
  prepareImportedProject,
} from "./composerSongExchange"

function exchange() {
  return {
    format: COMPOSER_SONG_EXCHANGE_FORMAT,
    version: 1,
    source: {
      app: "composer-os-chord-generator",
      folderId: "folder-1",
      exportedAt: "2026-07-25T00:00:00.000Z",
    },
    title: "Dark Song",
    tempo: 88,
    timeSignature: "4/4",
    memo: "静かな導入から大サビへ",
    sections: [
      {
        sourceId: "verse-1",
        name: "Verse 1",
        role: "verse",
        key: "Am",
        repeatCount: 2,
        chords: [
          { symbol: "Am(add9)", startBeat: 0, durationBeats: 4 },
          { symbol: "Fmaj7/A", startBeat: 4, durationBeats: 4 },
        ],
        sourceIntent: {
          style: "romanticDark",
          mood: "melancholic",
          scores: { melancholy: 9 },
        },
      },
      {
        sourceId: "c-melody",
        name: "Cメロ",
        role: "c-melody",
        key: "Am",
        repeatCount: 1,
        chords: [{ symbol: "D#dim", startBeat: 0, durationBeats: 4 }],
      },
      {
        sourceId: "breakdown-chorus",
        name: "落ちサビ",
        role: "breakdown-chorus",
        key: "Am",
        repeatCount: 1,
        chords: [{ symbol: "Fmaj7", startBeat: 0, durationBeats: 4 }],
      },
      {
        sourceId: "final-chorus",
        name: "大サビ",
        role: "grand-chorus",
        key: "Bm",
        repeatCount: 1,
        chords: [{ symbol: "Bm", startBeat: 0, durationBeats: 4 }],
        sourceIntent: {
          style: "finale",
          mood: "dramatic",
          scores: { cinematic: 9 },
        },
      },
    ],
  }
}

describe("Composer Song Exchange v1 import", () => {
  it("Exchange形式を識別し、通常のProject JSONはそのまま通す", () => {
    const rawProject = { projectId: "existing-project" }
    expect(isComposerSongExchange(exchange())).toBe(true)
    expect(isComposerSongExchange(rawProject)).toBe(false)
    expect(prepareImportedProject(rawProject)).toBe(rawProject)
  })

  it("曲情報とSection Roleを新規Composer Projectへ変換する", () => {
    const project = composerSongExchangeToProject(exchange())
    expect(project.title).toBe("Dark Song")
    expect(project.song).toMatchObject({
      key: "Am",
      tempo: 88,
      timeSignature: "4/4",
      songProfile: "original-custom",
    })
    expect(project.notes).toBe("静かな導入から大サビへ")
    expect(project.sections.map((section) => section.role)).toEqual([
      "verse",
      "c-melody",
      "breakdown-chorus",
      "grand-chorus",
    ])
    expect(project.sections.map((section) => section.startBar)).toEqual([1, 5, 6, 7])
  })

  it("repeatCount分コードを展開し、分数コードのBassも保持する", () => {
    const project = composerSongExchangeToProject(exchange())
    const verse = project.sections[0]
    const verseChords = project.chords.filter((chord) => chord.sectionId === verse.id)
    expect(verse.lengthBars).toBe(4)
    expect(verseChords.map((chord) => chord.symbol)).toEqual([
      "Am(add9)",
      "Fmaj7/A",
      "Am(add9)",
      "Fmaj7/A",
    ])
    expect(verseChords.map((chord) => chord.startBeat)).toEqual([0, 4, 8, 12])
    expect(verseChords[1].bass).toBe("A")
  })

  it("未対応versionと空Sectionを拒否する", () => {
    // Arrangerより新しい形式は「Arrangerを最新版に」と次の手順を案内する
    expect(() =>
      composerSongExchangeToProject({ ...exchange(), version: 3 }),
    ).toThrow("Arrangerを最新版に")
    expect(() =>
      composerSongExchangeToProject({ ...exchange(), version: 0 }),
    ).toThrow("未対応")
    expect(() =>
      composerSongExchangeToProject({ ...exchange(), sections: [] }),
    ).toThrow("セクション")
  })
})

/** Chord Generatorが現在書き出す形(v2): 和声のリズムが可変で、1小節に2コード入ることがある */
function exchangeV2() {
  return {
    ...exchange(),
    version: 2,
    sections: [
      {
        sourceId: "verse-1",
        name: "Aメロ",
        role: "verse",
        key: "C",
        repeatCount: 2,
        chords: [
          { symbol: "Cmaj7", startBeat: 0, durationBeats: 4 },
          { symbol: "A7", startBeat: 4, durationBeats: 4 },
          { symbol: "Dm7", startBeat: 8, durationBeats: 2 },
          { symbol: "G7/D", startBeat: 10, durationBeats: 2 },
          { symbol: "Cmaj7", startBeat: 12, durationBeats: 8 },
        ],
        sourceIntent: { style: "frenchPop", mood: "melancholic", scores: { boutonnat: 6 } },
      },
      {
        sourceId: "outro",
        name: "アウトロ",
        role: "outro",
        key: "C",
        repeatCount: 1,
        chords: [
          { symbol: "C", startBeat: 0, durationBeats: 4 },
          { symbol: "Am/C", startBeat: 4, durationBeats: 4 },
        ],
        sourceIntent: { style: "slowcore", mood: "melancholic", scores: { boutonnat: 5 } },
      },
    ],
  }
}

describe("Composer Song Exchange v2 import(可変長のコード)", () => {
  it("v2を受け付け、2拍・8拍のコードを拍位置どおりに取り込む", () => {
    const project = composerSongExchangeToProject(exchangeV2())
    const verse = project.sections[0]
    const verseChords = project.chords.filter((chord) => chord.sectionId === verse.id)
    // 20拍 = 5小節 × 2回
    expect(verse.lengthBars).toBe(10)
    expect(verseChords.slice(0, 5).map((c) => [c.symbol, c.startBeat, c.durationBeats])).toEqual([
      ["Cmaj7", 0, 4],
      ["A7", 4, 4],
      ["Dm7", 8, 2],
      ["G7/D", 10, 2],
      ["Cmaj7", 12, 8],
    ])
    // 2回目は小節頭(20拍目)から
    expect(verseChords[5].startBeat).toBe(20)
    expect(verseChords[0].bass).toBe(null)
    expect(verseChords[3].bass).toBe("D")
    expect(project.sections.map((s) => s.startBar)).toEqual([1, 11])
  })

  it("小節の途中で終わるセクション(整列前のv2)は、最後のコードを小節末まで伸ばして小節単位にそろえる", () => {
    const raw = exchangeV2()
    // 4 + 2 + 4 + 4 = 14拍(小節単位にそろえる前のChord Generatorが書き出しうる形)
    raw.sections[0].chords = [
      { symbol: "C", startBeat: 0, durationBeats: 4 },
      { symbol: "G/B", startBeat: 4, durationBeats: 2 },
      { symbol: "Am", startBeat: 6, durationBeats: 4 },
      { symbol: "F", startBeat: 10, durationBeats: 4 },
    ]
    const project = composerSongExchangeToProject(raw)
    const verse = project.sections[0]
    const chords = project.chords.filter((chord) => chord.sectionId === verse.id)
    expect(verse.lengthBars).toBe(8)
    expect(chords[3].durationBeats).toBe(6)
    // 繰り返しの2回目も小節頭から始まる
    expect(chords[4].startBeat).toBe(16)
    expect(project.sections[1].startBar).toBe(9)
  })

  it("startBeatが省略されたコードは、直前までの長さの合計から位置を補う", () => {
    const raw = exchangeV2()
    raw.sections[1].chords = [
      { symbol: "C", durationBeats: 2 },
      { symbol: "G/B", durationBeats: 2 },
      { symbol: "Am", durationBeats: 4 },
    ] as never
    const project = composerSongExchangeToProject(raw)
    const outro = project.sections[1]
    const chords = project.chords.filter((chord) => chord.sectionId === outro.id)
    expect(chords.map((c) => c.startBeat)).toEqual([0, 2, 4])
  })

  it("Chord Generatorが出すコード表記(♭表記・mMaj7・m7b5・7sus4・m(add9)・11・6th等)を未解釈なしで読める", () => {
    const symbols = [
      "Bbmaj7", "Ebmaj7/Bb", "Ab", "AmMaj7", "Bm7b5", "E7sus4", "Am(add9)", "Cadd9",
      "Am9", "Am11", "C11", "C6", "Am6", "Caug", "Bdim", "Csus2", "Csus4", "Em7",
      "A7", "Dmaj7/F#", "Am/G", "F#dim",
    ]
    for (const symbol of symbols) {
      const parsed = parseChordSymbol(symbol)
      expect(parsed, symbol).not.toBeNull()
      expect(parsed?.unrecognized, symbol).toBe("")
    }
    expect(parseChordSymbol("Bbmaj7")?.rootPc).toBe(10)
    expect(parseChordSymbol("AmMaj7")?.tones.map((t) => t.interval)).toEqual([0, 3, 7, 11])
    expect(parseChordSymbol("Bm7b5")?.isDiminished).toBe(true)
  })
})
