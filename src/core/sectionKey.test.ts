import { describe, expect, it } from "vitest"
import { exportSongMidi } from "@/midi/exportMelody"
import { composerSongExchangeToProject } from "./composerSongExchange"
import { effectiveSectionKey } from "./project"
import { keySignatureOf } from "./scale"

function modulatingExchange() {
  return {
    format: "composer-os/song-exchange",
    version: 2,
    source: { app: "composer-os-chord-generator", folderId: "f", exportedAt: "2026-09-23T00:00:00.000Z" },
    title: "Modulating Song",
    tempo: 84,
    timeSignature: "4/4",
    sections: [
      { sourceId: "v", name: "Aメロ", role: "verse", key: "Am", repeatCount: 1, chords: [{ symbol: "Am", startBeat: 0, durationBeats: 4 }, { symbol: "E7", startBeat: 4, durationBeats: 4 }] },
      { sourceId: "c", name: "サビ", role: "chorus", key: "Am", repeatCount: 1, chords: [{ symbol: "F", startBeat: 0, durationBeats: 4 }, { symbol: "E7", startBeat: 4, durationBeats: 4 }] },
      { sourceId: "g", name: "大サビ", role: "grand-chorus", key: "Bm", repeatCount: 1, chords: [{ symbol: "G", startBeat: 0, durationBeats: 4 }, { symbol: "F#7", startBeat: 4, durationBeats: 4 }] },
    ],
  }
}

/** SMF内の Key Signature メタイベント(FF 59 02 sf mi)を順に取り出す */
function keySignatureEvents(bytes: Uint8Array): { sf: number; minor: boolean }[] {
  const events: { sf: number; minor: boolean }[] = []
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x02) {
      const raw = bytes[i + 3]
      events.push({ sf: raw > 127 ? raw - 256 : raw, minor: bytes[i + 4] === 1 })
    }
  }
  return events
}

describe("セクションごとの調", () => {
  it("取り込み時、曲の調と違うセクションだけに調を持たせる", () => {
    const project = composerSongExchangeToProject(modulatingExchange())
    expect(project.song.key).toBe("Am")
    expect(project.sections.map((s) => s.key)).toEqual([undefined, undefined, "Bm"])
  })

  it("effectiveSectionKey はセクションの調を優先し、無ければ曲の調を返す", () => {
    const project = composerSongExchangeToProject(modulatingExchange())
    const [verse, , grand] = project.sections
    expect(effectiveSectionKey(project, verse.id)).toBe("Am")
    expect(effectiveSectionKey(project, grand.id)).toBe("Bm")
    expect(effectiveSectionKey(project, "missing")).toBe("Am")
  })

  it("Key表記をMIDIの調号へ変換する(短調は平行長調の調号)", () => {
    expect(keySignatureOf("C")).toEqual({ sharpsFlats: 0, minor: false })
    expect(keySignatureOf("Am")).toEqual({ sharpsFlats: 0, minor: true })
    expect(keySignatureOf("Bm")).toEqual({ sharpsFlats: 2, minor: true })
    expect(keySignatureOf("F#m")).toEqual({ sharpsFlats: 3, minor: true })
    expect(keySignatureOf("Eb")).toEqual({ sharpsFlats: -3, minor: false })
    expect(keySignatureOf("Bbm")).toEqual({ sharpsFlats: -5, minor: true })
    expect(keySignatureOf("F#")).toEqual({ sharpsFlats: 6, minor: false })
    expect(keySignatureOf("Gb")).toEqual({ sharpsFlats: -6, minor: false })
    expect(keySignatureOf("D#m")).toEqual({ sharpsFlats: 6, minor: true })
    expect(keySignatureOf("Ebm")).toEqual({ sharpsFlats: -6, minor: true })
    expect(keySignatureOf("C#")).toEqual({ sharpsFlats: 7, minor: false })
    expect(keySignatureOf("A#m")).toEqual({ sharpsFlats: 7, minor: true })
    expect(keySignatureOf("Db")).toEqual({ sharpsFlats: -5, minor: false })
    expect(keySignatureOf("???")).toBeNull()
  })

  it("曲のMIDIに、曲頭の調号と、転調したセクション頭の調号変更を書き出す", () => {
    const project = composerSongExchangeToProject(modulatingExchange())
    expect(keySignatureEvents(exportSongMidi(project))).toEqual([
      { sf: 0, minor: true }, // 曲頭: Am
      { sf: 2, minor: true }, // 大サビ: Bm
    ])
  })
})
