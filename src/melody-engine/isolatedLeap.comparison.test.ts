import { it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import type { SectionRole } from "@/core/section"
import { resolvePublicComposerRules } from "@/composer-intelligence"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { isIsolatedLeap, measureMelodyCraft } from "./melodyCraftMetrics"
import { classicalLikeness } from "./classicalLikeness"
import { CLASSICAL_MODELS } from "./classicalModels"

/**
 * 1音だけ飛び出す音(docs/isolated-leap-refinement.md)の確認用の条件(記録専用。ISOLATED_LEAP_OUT を指定したときだけ動く)。
 * 調べるのに使っていない6進行 × seed 71・83・97 × Aメロ・サビ × 8・16小節 × 曲の雰囲気2つ。アプリの既定と同じく標準の作り方と公開ルールを使う。
 * 変更の前後で同じテストを動かし、書き出した JSON を比べる。
 */
const SONGS = [
  { key: "A", chords: "A | F#m | D | E | A | F#m | Bm E | A" },
  { key: "Bb", chords: "Bb | F | Gm | Eb | Bb | F | Eb F | Bb" },
  { key: "Cm", chords: "Cm | Ab | Eb | Bb | Cm | Fm | G7 | Cm" },
  { key: "E", chords: "E | C#m | A | B | E | G#m | A B | E" },
  { key: "F#m", chords: "F#m | D | A | E | F#m | Bm | C#7 | F#m" },
  { key: "Ab", chords: "Ab | Fm | Db | Eb | Ab | Cm | Db Eb | Ab" },
]

it.runIf(Boolean(process.env.ISOLATED_LEAP_OUT))("1音だけ飛び出す音の割合と古典らしさを、固定した条件で記録する(記録専用)", () => {
  const cells: Record<string, { melodies: number; notes: number; isolated: number; classicalTotal: number }> = {}
  for (const song of SONGS) for (const role of ["verse", "chorus"] as SectionRole[]) for (const songProfile of ["original-custom", "dark-romantic"] as const)
    for (const seed of [71, 83, 97]) for (const bars of [8, 16]) {
      const text = bars === 16 ? `${song.chords} | ${song.chords}` : song.chords
      const chords = parseChordInputText(text, "s1", 4, "c")
      const { candidates } = generateFromChordsWithProfiles({
        chords, sectionId: "s1", sectionRole: role, songProfile, density: "balanced", range: RANGE_PRESETS.middle,
        drama: "growing", totalBeats: bars * 4, seed, profiles: ["standard"], key: song.key,
        composerRules: resolvePublicComposerRules({ generatorTarget: "melody", sectionRole: role }),
      })
      const cell = (cells[`${role} ${bars}小節`] ??= { melodies: 0, notes: 0, isolated: 0, classicalTotal: 0 })
      for (const candidate of candidates) {
        const notes = [...candidate.notes].sort((a, b) => a.startBeat - b.startBeat)
        cell.melodies += 1
        cell.notes += notes.length
        cell.isolated += notes.filter((_, index) => isIsolatedLeap(notes, index)).length
        cell.classicalTotal += classicalLikeness(measureMelodyCraft(notes, chords, song.key), CLASSICAL_MODELS).score
      }
    }
  const report = Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name, {
    melodies: cell.melodies,
    isolatedPer100Notes: Math.round(cell.isolated / cell.notes * 10000) / 100,
    classicalMean: Math.round(cell.classicalTotal / cell.melodies * 100) / 100,
  }]))
  writeFileSync(process.env.ISOLATED_LEAP_OUT!, JSON.stringify(report, null, 1))
}, 900000)
