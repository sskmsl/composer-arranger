import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { composerSongExchangeToProject } from "./composerSongExchange"
import { effectiveSectionKey } from "./project"

/**
 * Chord Generator と共有する契約見本。Chord Generator 側(contracts/ 同名ファイル)は
 * 「固定の入力から書き出した結果がこの見本と一致する」ことをテストしている。
 * 交換形式が変わったら、両リポジトリの見本を同じ内容に更新すること。
 */
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/composer-song-exchange.v2.example.json"), "utf8"),
)

describe("Composer Song Exchange 契約見本(Chord Generatorの書き出し)の読み込み", () => {
  const project = composerSongExchangeToProject(fixture)

  it("曲情報(曲名・テンポ・曲の調・メモ)を引き継ぐ", () => {
    expect(project.title).toBe("Contract Song")
    expect(project.song.tempo).toBe(84)
    expect(project.song.key).toBe("Am")
    expect(project.notes).toBe(fixture.memo)
  })

  it("セクションの並び・長さ・転調を引き継ぐ", () => {
    expect(project.sections.map((s) => [s.role, s.startBar, s.lengthBars])).toEqual([
      ["verse", 1, 8], // 16拍 × 2回
      ["chorus", 9, 4],
      ["grand-chorus", 13, 4],
    ])
    const grand = project.sections[2]
    expect(grand.key).toBe("Bm")
    expect(effectiveSectionKey(project, project.sections[0].id)).toBe("Am")
  })

  it("コードの拍位置・長さ・スラッシュのベースをそのまま引き継ぐ(1小節2コードを含む)", () => {
    const verse = project.sections[0]
    const verseChords = project.chords.filter((c) => c.sectionId === verse.id)
    expect(verseChords.slice(0, 5).map((c) => [c.symbol, c.startBeat, c.durationBeats])).toEqual([
      ["Am", 0, 2],
      ["E7/G#", 2, 2],
      ["Am", 4, 4],
      ["Dm6", 8, 4],
      ["E7", 12, 4],
    ])
    expect(verseChords[1].bass).toBe("G#")
    expect(verseChords[5].startBeat).toBe(16)
    const grandChords = project.chords.filter((c) => c.sectionId === project.sections[2].id)
    expect(grandChords.map((c) => c.durationBeats)).toEqual([4, 2, 2, 8])
  })

  it("スタイルを Song Profile として引き継ぐ(歌謡曲→Dark Romantic、French Pop/Cinematic→Cinematic French Pop)", () => {
    expect(project.song.songProfile).toBe("dark-romantic")
    expect(project.song.sectionProfileOverrides.map((o) => o.songProfile)).toEqual([
      "cinematic-french-pop",
      "cinematic-french-pop",
    ])
  })
})
