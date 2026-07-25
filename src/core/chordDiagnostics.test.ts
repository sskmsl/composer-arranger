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

  // PR #35 Codexレビュー(P1): ALTER_TOKENに存在しないadd/括弧トークンが、restからの
  // 正規表現ストリップだけで消えてしまい unrecognized が空になっていた(C majorへ黙って
  // フォールバックする典型例)。実際に解決できたトークンだけを除外することを確認する。
  it("ALTER_TOKENに存在しないaddトークン(add99)は unrecognized に残る", () => {
    const p = parseChordSymbol("Cadd99")
    expect(p?.unrecognized).toBe("add99")
    expect(p?.interpretedSymbol).toBe("C")
  })

  it("ALTER_TOKENに存在しない括弧内トークン(foo)は unrecognized に残る", () => {
    const p = parseChordSymbol("C(foo)")
    expect(p?.unrecognized).toBe("foo")
    expect(p?.interpretedSymbol).toBe("C")
  })

  it("解決できたトークンと未解決トークンが混在する場合、未解決分だけが残る", () => {
    const p = parseChordSymbol("F#m(add9)zzz")
    expect(p?.unrecognized).toBe("zzz")
    expect(p?.interpretedSymbol).toBe("F#m(add9)")
  })

  // PR #35 Codexレビュー2巡目(P2): 括弧内に解決済み・未解決トークンが混在する場合、
  // 従来はグループごと削除していたため「add9は採用しているのにC」と表示が実態と食い違っていた。
  // 解決済みトークンだけを残して "C(add9)" と表示する。
  it("括弧内に解決済み(add9)と未解決(foo)が混在する場合、解決済みトークンだけを残す", () => {
    const p = parseChordSymbol("C(add9,foo)")
    expect(p?.unrecognized).toBe("foo")
    expect(p?.interpretedSymbol).toBe("C(add9)")
    expect(p?.tensions.map((t) => t.interval)).toContain(14) // add9はテンションとして採用されている
  })
})

describe("interpretedSymbol: 実際に生成へ渡る表記(末尾以外の未解決トークンにも対応)", () => {
  it("分数コード + 未解決addトークンでも interpretedSymbol が破綻しない(スライスに依存しない)", () => {
    const p = parseChordSymbol("Cadd99/E")
    expect(p?.unrecognized).toBe("add99")
    // "/E" (分数ベース) は解決済み情報のためinterpretedSymbolにも残ってよいが、
    // 少なくとも文字化け(部分文字だけ欠けた表記)にならないことを確認する
    expect(p?.interpretedSymbol.startsWith("C")).toBe(true)
    expect(p?.interpretedSymbol).not.toContain("99")
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

  // PR #35 Codexレビュー2巡目(P2): 直前のイベントとだけ比較すると、間に短いイベントが
  // 挟まる入れ子状の重複(A=0〜10拍の中にB=2〜3拍、C=4〜5拍)でCとAの重複を見逃していた。
  // そこまでの最大終端位置と比較するよう修正し、両方検出されることを確認する。
  it("入れ子状の重複(A=0〜10, B=2〜3, C=4〜5)をどちらも検出する", () => {
    const es: ChordEvent[] = [
      { id: "a", sectionId: "s1", startBeat: 0, durationBeats: 10, symbol: "C", bass: null },
      { id: "b", sectionId: "s1", startBeat: 2, durationBeats: 1, symbol: "G", bass: null },
      { id: "c", sectionId: "s1", startBeat: 4, durationBeats: 1, symbol: "Am", bass: null },
    ]
    const r = diagnoseChordInput(es, 10)
    expect(r.coverage.overlaps).toEqual([1, 2])
  })

  it("error があれば hasError=true", () => {
    const r = diagnoseChordInput(events("Am | Zap | C | G"), 16)
    expect(r.hasError).toBe(true)
    expect(r.chords[1].status).toBe("error")
  })

  // PR #35 Codexレビュー(P2): 終端拍だけを見ていたため、4〜8拍にしか和音が無い8拍セクションを
  // "exact"と誤判定していた(0〜4拍の先頭空白が無視される)。和集合ベースで空白を検出する。
  it("先頭に空白がある場合、終端が一致していてもunderと空白区間を返す(インポート等の非連続データ)", () => {
    const es: ChordEvent[] = [{ id: "a", sectionId: "s1", startBeat: 4, durationBeats: 4, symbol: "C", bass: null }]
    const r = diagnoseChordInput(es, 8)
    expect(r.coverage.status).toBe("under")
    expect(r.coverage.gapBeats).toBe(4)
    expect(r.coverage.gaps).toEqual([{ startBeat: 0, endBeat: 4 }])
  })

  it("中間に空白がある場合も検出する", () => {
    const es: ChordEvent[] = [
      { id: "a", sectionId: "s1", startBeat: 0, durationBeats: 2, symbol: "C", bass: null },
      { id: "b", sectionId: "s1", startBeat: 6, durationBeats: 2, symbol: "G", bass: null },
    ]
    const r = diagnoseChordInput(es, 8)
    expect(r.coverage.status).toBe("under")
    expect(r.coverage.gaps).toEqual([{ startBeat: 2, endBeat: 6 }])
    expect(r.coverage.gapBeats).toBe(4)
  })

  it("連続配置(通常のセクション編集)は従来どおりexact/under/overを正しく判定する", () => {
    expect(diagnoseChordInput(events("Am | F | C | G"), 16).coverage).toMatchObject({ status: "exact", gapBeats: 0, gaps: [] })
    expect(diagnoseChordInput(events("Am | F"), 16).coverage).toMatchObject({ status: "under", gapBeats: 8 })
    expect(diagnoseChordInput(events("Am | F | C | G | Em"), 16).coverage).toMatchObject({ status: "over", overflowBeats: 4, gapBeats: 0 })
  })
})
