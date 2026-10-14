import { composerSongExchangeToProject, type ComposerSongExchange } from "@/core/composerSongExchange"
import type { SectionRole } from "@/core/section"

/** レビュー指定の2曲。1セル1小節、カンマ区切りのセルだけ2コード。 */
export function arrangementReviewSong(which: "A" | "B") {
  const a = which === "A"
  const verse = a ? "Am|Am/G|F|Fmaj7|Dm7|E7|Am|E7" : "C|G/B|Am|Am7/G|F|C/E|Dm7|G"
  const chorus = a ? "F|G|Am|C/E|Dm7|Am/C|Bm7b5|E7" : "F|G|Em7|Am|F|G|C|C,G"
  const entries: Array<[string, SectionRole, string]> = [
    [a ? "イントロ" : "Intro", "intro", a ? "Am|Am|F|E7" : "C|G|Am|F"],
    [a ? "Aメロ" : "Verse", "verse", verse],
    [a ? "Bメロ" : "Pre-Chorus", "pre-chorus", a ? "F|G|Em|Am|F|G|C|E7sus4" : "Am|Em/G|F|G|Am|Em/G|F|G"],
    [a ? "サビ" : "Chorus", "chorus", chorus],
    [a ? "Aメロ2" : "Verse 2", "verse", verse],
    [a ? "サビ2" : "Chorus 2", "chorus", chorus],
    [a ? "間奏" : "Bridge", "bridge", a ? "Dm7|G7|Cmaj7|Fmaj7|Bm7b5|E7|Am|E7" : "Dm7|Dm7|Em7|Em7|F|G|Am|Gsus4"],
    [a ? "大サビ" : "Final Chorus", "grand-chorus", a ? "G|A|Bm|D/F#|Em7|Bm/D|C#m7b5|F#7" : "G|A|F#m7|Bm|G|A|D|D,A"],
    [a ? "アウトロ" : "Outro", "outro", a ? "Bm|G|Bm|Bm" : "D|A|G|D"],
  ]
  const exchange: ComposerSongExchange = {
    format: "composer-os/song-exchange", version: 2,
    source: { app: "review-fixture", folderId: "review", exportedAt: "2026-10-15T00:00:00.000Z" },
    title: `Review ${which}`, tempo: a ? 76 : 118, timeSignature: "4/4",
    sections: entries.map(([name, role, symbols], index) => ({
      sourceId: `review-${which}-${index}`, name, role,
      key: index >= 7 ? (a ? "Bm" : "D") : (a ? "Am" : "C"), repeatCount: 1,
      sourceIntent: { style: a ? "kayokyoku" : "cinematic" },
      chords: symbols.split("|").flatMap((cell, bar) => cell.split(",").map((symbol, subdivision, cells) => ({
        symbol, startBeat: bar * 4 + subdivision * 4 / cells.length, durationBeats: 4 / cells.length,
      }))),
    })),
  }
  return composerSongExchangeToProject(exchange)
}
