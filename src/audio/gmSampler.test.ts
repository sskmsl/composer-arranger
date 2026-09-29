import { describe, expect, it } from "vitest"
import { gmNoteName, gmSampleFor, parseSoundfontScript } from "./gmSampler"

describe("GM音源のサンプル", () => {
  it("音名はフラットで書き、中央のドは C4", () => {
    expect(gmNoteName(60)).toBe("C4")
    expect(gmNoteName(61)).toBe("Db4")
    expect(gmNoteName(21)).toBe("A0")
    expect(gmNoteName(108)).toBe("C8")
  })

  it("音域(A0〜C8)の外の音は、端のサンプルの再生速度を変えて鳴らす", () => {
    expect(gmSampleFor(60)).toEqual({ sampleMidi: 60, playbackRate: 1 })
    const high = gmSampleFor(110)
    expect(high.sampleMidi).toBe(108)
    expect(high.playbackRate).toBeCloseTo(Math.pow(2, 2 / 12), 6)
  })

  it("楽器ファイル(JS)から音名と data URL を取り出す", () => {
    const text = `if (typeof(MIDI) === 'undefined') var MIDI = {};
MIDI.Soundfont.acoustic_grand_piano = {
"A0": "data:audio/mp3;base64,AAAA",
"Bb0": "data:audio/mp3;base64,BBBB",
"C8": "data:audio/mp3;base64,CCCC"
}`
    const notes = parseSoundfontScript(text)
    expect([...notes.keys()]).toEqual(["A0", "Bb0", "C8"])
    expect(notes.get("Bb0")).toBe("data:audio/mp3;base64,BBBB")
  })
})
