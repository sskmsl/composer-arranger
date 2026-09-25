import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import { keyScalePitchClasses } from "@/core/scale"
import { generateFlowingCounterLine } from "./flowingCounterLine"

const chords = parseChordInputText("C | Am | F | G | C | Am | Dm G | C", "s1", 4, "c")

/** 前半は細かく動き、後半は長く伸ばす主旋律(C4〜A4あたり) */
function melody(): MelodyNote[] {
  const pitches = [72, 71, 69, 67, 69, 72, 74, 72]
  const notes: MelodyNote[] = []
  for (let bar = 0; bar < 8; bar += 1) {
    if (bar % 2 === 0) {
      pitches.slice(0, 4).forEach((pitch, index) => notes.push(n(bar * 4 + index, 1, pitch + (bar % 4 === 2 ? 2 : 0))))
    } else {
      notes.push(n(bar * 4, 3, pitches[4 + (bar % 4)]))
    }
  }
  return notes
}

function n(startBeat: number, durationBeats: number, pitch: number): MelodyNote {
  return { id: `${startBeat}`, startBeat, durationBeats, pitch, velocity: 90, locks: [] }
}

function sounding(notes: MelodyNote[], beat: number) {
  return notes.find((note) => beat >= note.startBeat && beat < note.startBeat + note.durationBeats)
}

describe("流れる対旋律", () => {
  for (const placement of ["below", "above"] as const) {
    it(`主旋律の${placement === "below" ? "下" : "上"}で、途切れずに滑らかに動く線を作る`, () => {
      for (let seed = 1; seed <= 16; seed += 1) {
        const lead = melody()
        const line = generateFlowingCounterLine({ melody: lead, chords, key: "C", totalBeats: 32, beatsPerBar: 4, seed, placement })
        // 曲の大半を鳴らし続ける(隙間に答えるだけの線ではない)
        const covered = line.reduce((sum, note) => sum + note.durationBeats, 0)
        expect(covered).toBeGreaterThan(32 * 0.8)
        // コードが変わるたびに、ほとんど新しい音へ動く(同じ音を何小節も伸ばし続けない)
        const chordStarts = chords.filter((chord) => chord.startBeat > 0).map((chord) => chord.startBeat)
        const movedAtChange = chordStarts.filter((beat) => line.some((note) => Math.abs(note.startBeat - beat) < 1e-6)).length
        expect(movedAtChange).toBeGreaterThanOrEqual(Math.ceil(chordStarts.length * 0.75))
        // 大きく跳ばず、滑らかにつながる
        const leaps = line.slice(1).map((note, index) => Math.abs(note.pitch - line[index].pitch))
        expect(leaps.reduce((a, b) => a + b, 0) / leaps.length).toBeLessThanOrEqual(3.5)
        expect(Math.max(...leaps)).toBeLessThanOrEqual(7)

        const scale = keyScalePitchClasses("C")
        for (const note of line) {
          const lead = sounding(melody(), note.startBeat)
          // 主旋律と交差せず、同じ音や半音でぶつからない
          if (lead) {
            if (placement === "below") expect(note.pitch).toBeLessThan(lead.pitch - 2)
            else expect(note.pitch).toBeGreaterThan(lead.pitch + 2)
            expect([0, 1, 11]).not.toContain(Math.abs(note.pitch - lead.pitch) % 12)
          }
          // 拍頭はコードの音、経過音は音階の音
          const chord = chords.find((c) => note.startBeat >= c.startBeat && note.startBeat < c.startBeat + c.durationBeats)!
          const pcs = parseChordSymbol(chord.symbol)!.tones.map((tone) => tone.pitchClass)
          if (note.plannedToneRole === "passing-tone") expect(scale).toContain(note.pitch % 12)
          else expect(pcs).toContain(note.pitch % 12)
      }
      }
    })
  }

  it("主旋律が伸ばしている所で動き、細かく動いている所では伸ばす", () => {
    const line = generateFlowingCounterLine({ melody: melody(), chords, key: "C", totalBeats: 32, beatsPerBar: 4, seed: 3, placement: "below" })
    const onsetsIn = (start: number, end: number) => line.filter((note) => note.startBeat >= start && note.startBeat < end).length
    // 主旋律が伸ばす小節(奇数小節)の方が、対旋律の発音が多い
    const busyBars = [0, 2, 4, 6].reduce((sum, bar) => sum + onsetsIn(bar * 4, bar * 4 + 4), 0)
    const calmBars = [1, 3, 5, 7].reduce((sum, bar) => sum + onsetsIn(bar * 4, bar * 4 + 4), 0)
    expect(calmBars).toBeGreaterThan(busyBars)
  })

  it("主旋律やコードがなければ作らない", () => {
    expect(generateFlowingCounterLine({ melody: [], chords, key: "C", totalBeats: 32, beatsPerBar: 4, seed: 1, placement: "below" })).toEqual([])
  })
})
