import { composerSongExchangeToProject } from "@/core/composerSongExchange"

const major = ["I V vi IV", "vi IV I V", "I vi IV V", "I iii IV V", "ii7 V7 I vi", "IV I V vi", "I IV vi V", "I V IV I"]
const minor = ["i VI III VII", "i iv VII III", "i VII VI V", "i iv v i", "VI VII i i", "i III VII VI", "i v VI iv", "i VI iv V"]
const keys = ["C", "D", "E", "F", "G", "A", "Bb", "Eb", "F#", "B"]
const tempos = [66, 72, 84, 96, 108, 118, 126, 138, 150, 90]
const roots: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, Bb: 10, Eb: 3, "F#": 6, B: 11 }
const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
const degrees = ["I", "II", "III", "IV", "V", "VI", "VII"]

/** 指定の8進行を循環して各調性12曲。サビは3つ先の異なる進行。実在旋律は使用しない。 */
export function melodyCharacterReviewSong(index: number) {
  const isMinor = index >= 12, slot = index % 12, rootName = keys[index % keys.length]
  const key = rootName + (isMinor ? "m" : ""), tempo = tempos[index % tempos.length]
  const style = ["kayokyoku", "frenchPop", "cinematic"][index % 3]
  const steps = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
  const patterns = isMinor ? minor : major
  const progression = (offset: number) => patterns[(slot + offset) % patterns.length].split(" ").map((token) => {
    const roman = token.replace("7", ""), degree = degrees.indexOf(roman.toUpperCase())
    return names[(roots[rootName] + steps[degree]) % 12] + (roman === roman.toLowerCase() ? "m" : "") + (token.endsWith("7") ? "7" : "")
  })
  const verse = progression(0), chorus = progression(3)
  const project = composerSongExchangeToProject({ format: "composer-os/song-exchange", version: 2,
    source: { app: "character-review", folderId: "character-review", exportedAt: "2026-10-18T00:00:00.000Z" },
    title: `Character ${index + 1}`, tempo, timeSignature: "4/4",
    sections: (["verse", "chorus"] as const).map((role, i) => ({ sourceId: `character-${index}-${role}`, name: role, role, key, repeatCount: 1,
      sourceIntent: { style }, chords: [...(i ? chorus : verse), ...(i ? chorus : verse)].map((symbol, bar) => ({ symbol, startBeat: bar * 4, durationBeats: 4 })) })),
  })
  return { project, seed: 5000 + index, key, tempo, style, verse, chorus }
}
