import { describe, expect, it } from "vitest"
import { diagnoseChordInput, diagnoseChord } from "./chordDiagnostics"
import { parseChordInputText } from "./chordInput"
import { parseChordSymbol } from "./chord"
import type { ChordEvent } from "./project"

function events(text: string, beatsPerBar = 4): ChordEvent[] {
  return parseChordInputText(text, "s1", beatsPerBar, "s1")
}

describe("parseChordSymbol.unrecognized(未対応末尾の露出)", () => {
  it("完全に解釈できる記法は unrecognized が空", () => {
    for (const s of ["F#m(add9)", "B7sus4", "Cmaj7", "Am7b5", "Dsus2", "C/E", "G6/9", "Aadd9"]) {
      expect(parseChordSymbol(s)?.unrecognized, s).toBe("")
    }
  })
  it("未対応の末尾文字を unrecognized として残す", () => {
    expect(parseChordSymbol("Cmaj7xyz")?.unrecognized).toBe("xyz")
    expect(parseChordSymbol("Gzzz")?.unrecognized).toBe("zzz")
  })
})

describe("diagnoseChord: 対応記法は正常表示(受け入れ条件)", () => {
  it("F#m(add9) の Root/構成音/テンションをプレビューする", () => {
    const [d] = events("F#m(add9)").map((e, i) => diagnoseChord(e, i))
    expect(d.status).toBe("ok")
    expect(d.rootName).toBe("F#")
    expect(d.toneNames).toEqual(expect.arrayContaining(["F#", "A", "C#"]))
    expect(d.tensionNames).toEqual(expect.arrayContaining(["G#"]))
  })

  it("B7sus4 が正常(sus4=E, dominant7=A)", () => {
    const [d] = events("B7sus4").map((e, i) => diagnoseChord(e, i))
    expect(d.status).toBe("ok")
    expect(d.rootName).toBe("B")
    expect(d.toneNames).toEqual(expect.arrayContaining(["E", "A"]))
  })

  it("分数コード C/E は bass を表示する", () => {
    const [d] = events("C/E").map((e, i) => diagnoseChord(e, i))
    expect(d.status).toBe("ok")
    expect(d.rootName).toBe("C")
    expect(d.bassName).toBe("E")
  })

  it("duration 指定 :2 は長さへ反映され警告にならない", () => {
    const es = events("C:2 | G:6")
    expect(es[0].durationBeats).toBe(2)
    expect(es[1].durationBeats).toBe(6)
    expect(es.map((e, i) => diagnoseChord(e, i).status)).toEqual(["ok", "ok"])
  })
})

describe("diagnoseChord: 未対応記法・不正な長さの検出", () => {
  it("未対応の末尾文字は warning(無視した解釈を明示)", () => {
    const [d] = events("Cmaj7xyz").map((e, i) => diagnoseChord(e, i))
    expect(d.status).toBe("warning")
    expect(d.reason).toContain("xyz")
    expect(d.interpretedSymbol).toBe("Cmaj7")
    expect(d.rootName).toBe("C") // 解釈自体は提示される
  })

  it("ルート音で始まらないコードは error(暗黙のC major変換を警告)", () => {
    const d = diagnoseChord({ id: "x", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "Zap", bass: null }, 0)
    expect(d.status).toBe("error")
    expect(d.reason).toContain("C major")
  })

  it("不正な長さ(0以下)は warning", () => {
    const d = diagnoseChord({ id: "x", sectionId: "s1", startBeat: 0, durationBeats: 0, symbol: "C", bass: null }, 0)
    expect(d.status).toBe("warning")
    expect(d.reason).toContain("長さ")
  })
})

describe("diagnoseChordInput: セクション充足状況", () => {
  it("ちょうど埋まっていれば exact", () => {
    const r = diagnoseChordInput(events("Am | F | C | G"), 16)
    expect(r.coverage.status).toBe("exact")
    expect(r.hasError).toBe(false)
  })

  it("不足していれば under と不足拍を返す", () => {
    const r = diagnoseChordInput(events("Am | F"), 16)
    expect(r.coverage.status).toBe("under")
    expect(r.coverage.gapBeats).toBe(8)
    expect(r.hasWarning).toBe(true)
  })

  it("超過していれば over と超過拍を返す", () => {
    const r = diagnoseChordInput(events("Am | F | C | G | Em"), 16)
    expect(r.coverage.status).toBe("over")
    expect(r.coverage.overflowBeats).toBe(4)
  })

  it("重なりを検出する", () => {
    const es: ChordEvent[] = [
      { id: "a", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "C", bass: null },
      { id: "b", sectionId: "s1", startBeat: 2, durationBeats: 4, symbol: "G", bass: null },
    ]
    const r = diagnoseChordInput(es, 8)
    expect(r.coverage.overlaps).toEqual([1])
    expect(r.hasWarning).toBe(true)
  })

  it("error があれば hasError=true", () => {
    const r = diagnoseChordInput(events("Am | Zap | C | G"), 16)
    expect(r.hasError).toBe(true)
    expect(r.chords[1].status).toBe("error")
  })
})
