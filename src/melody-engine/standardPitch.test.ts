import { describe, expect, it } from "vitest"
import { allUsablePitchClasses } from "@/core/chord"
import type { ChordEvent } from "@/core/project"
import { pitchClass } from "@/core/note"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { buildHarmonicMap, chordAtBeat } from "./harmonicMap"

const chords: ChordEvent[] = [
  { id: "a", sectionId: "s", startBeat: 0, durationBeats: 4, symbol: "Am(add9)", bass: null },
  { id: "d", sectionId: "s", startBeat: 4, durationBeats: 4, symbol: "D#dim", bass: null },
  { id: "f", sectionId: "s", startBeat: 8, durationBeats: 4, symbol: "Fmaj7", bass: null },
  { id: "e", sectionId: "s", startBeat: 12, durationBeats: 4, symbol: "E7", bass: null },
]
const harmonicMap = buildHarmonicMap(chords)

describe("Standardの音程整合性", () => {
  it("音域trajectoryとpeak headroom適用後も、説明不能なコード外音を作らない", () => {
    const unexplained: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const result = generateFromChordsWithProfiles({
        chords,
        sectionId: "s",
        sectionRole: "verse",
        songProfile: "original-custom",
        density: "balanced",
        range: { low: 60, high: 79 },
        drama: "growing",
        totalBeats: 16,
        seed,
        profiles: ["standard"],
        key: "Am",
      })
      for (const candidate of result.candidates) {
        candidate.notes.forEach((note) => {
          const entry = chordAtBeat(harmonicMap, note.startBeat)
          const usable = entry ? allUsablePitchClasses(entry.parsed) : []
          if (
            entry &&
            !usable.includes(pitchClass(note.pitch)) &&
            !note.plannedResolution
          ) {
            unexplained.push(
              `seed=${seed} pattern=${candidate.patternIndex} beat=${note.startBeat} pitch=${note.pitch} role=${note.plannedToneRole} chord=${entry.chord.symbol} usable=${usable.join(",")}`,
            )
          }
        })
      }
    }
    expect(unexplained.slice(0, 10)).toEqual([])
  })
})
