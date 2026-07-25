import { describe, expect, it } from "vitest"
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
    expect(() =>
      composerSongExchangeToProject({ ...exchange(), version: 2 }),
    ).toThrow("未対応")
    expect(() =>
      composerSongExchangeToProject({ ...exchange(), sections: [] }),
    ).toThrow("セクション")
  })
})
