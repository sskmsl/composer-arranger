import { describe, expect, it } from "vitest"
import {
  arrangementSoundInstructionFromText,
  requestsPercussiveChordRiff,
  unsupportedArrangementInstructionNotice,
} from "./arrangementIntent"

describe("arrangement intent", () => {
  it("和音・短い打撃・反復の三要素がある要望だけを和音リフとして扱う", () => {
    expect(requestsPercussiveChordRiff("和音を打撃として使う反復したリフを生成")).toBe(true)
    expect(requestsPercussiveChordRiff("コードを短く刻むイントロにしたい")).toBe(true)
    expect(requestsPercussiveChordRiff("和音を長く伸ばすPad")).toBe(false)
    expect(requestsPercussiveChordRiff("単音の反復リフ")).toBe(false)
  })

  it.each([
    ["イントロで高い単音を少しずつ変えながら反復", { target: "intro", role: "pulse", material: "single-note", repetition: "evolving", register: "high" }],
    ["Aメロに低い分散和音を8分音符で入れる", { target: "verse", role: "pulse", material: "arpeggio", register: "low", rhythmSteps: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] }],
    ["最後のサビでストリングスを長く伸ばして徐々に大きくする", { target: "final", role: "strings", behavior: "swell", articulation: "long" }],
    ["間奏の終わりにベル1音で次へつなぐ", { target: "interlude", role: "bell", behavior: "fill" }],
  ])("特定の例に限らず自然文を演奏指示へ変換する: %s", (source, expected) => {
    expect(arrangementSoundInstructionFromText(source)).toMatchObject(expected)
  })

  it("最終サビ・大サビ・最後のサビを最後のサビだけの指示として読む", () => {
    for (const source of ["最終サビだけストリングスを足して", "大サビで弦を長く伸ばす", "最後のサビでシンセを反復"]) {
      expect(arrangementSoundInstructionFromText(source)?.target).toBe("final")
    }
  })

  it("未対応のギター追加指示は無言で成功扱いにしない", () => {
    expect(unsupportedArrangementInstructionNotice("後半だけギターを追加する"))
      .toBe("この指示は反映できませんでした。ギターパートの新規追加にはまだ対応していません。")
    expect(unsupportedArrangementInstructionNotice("後半だけ弦を追加する")).toBeNull()
  })
})
