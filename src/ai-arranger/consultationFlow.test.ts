import { describe, expect, it } from "vitest"
import { requestedResponseModeForConsultation } from "./consultationFlow"

describe("アレンジ相談の確認フロー", () => {
  it.each([
    "この曲はストリングスを増やした方がいい？",
    "サビをもっと広げたい",
    "なぜドラムが多いの？",
    "こういうイントロにできる？",
    "別の案はある？",
    "この案はどうして必要なの？",
    "提案の理由を教えてもらえますか",
  ])("質問や希望だけでは変更案を作らない: %s", (text) => {
    expect(requestedResponseModeForConsultation(text)).toBe("discussion")
  })

  it.each([
    "この方向で3案を作って",
    "変更案を出して",
    "具体的に提案して",
    "別の案もほしい",
    "それで進めて",
  ])("案の作成を明示したときだけ進める: %s", (text) => {
    expect(requestedResponseModeForConsultation(text)).toBe("proposal")
  })

  it("確認前の『はい』は相談、確認への『はい』は案作成として扱う", () => {
    expect(requestedResponseModeForConsultation("はい")).toBe("discussion")
    expect(requestedResponseModeForConsultation("はい", true)).toBe("proposal")
  })

  it.each([
    "はい",
    "はい、お願いします",
    "いいですね、お願いします",
    "OK、進めてください",
    "はい、進めてください",
    "その方向でいいです",
    "それでいいです",
    "進めてください",
    "お願い",
    "いいね!作って",
    "うん、いいよ",
    "ありがとう、お願いします",
    "それでお願いします",
  ])("確認待ちでは短い肯定の返事から案作成へ進む: %s", (text) => {
    expect(requestedResponseModeForConsultation(text, true)).toBe("proposal")
  })

  it.each([
    "はい、でも少し違う",
    "いや、やっぱりやめて",
    "まだ待って",
    "本当にそれでいい？",
    "もう少しストリングスを増やしたい",
    "それではダメです",
    "ストリングスをうんと増やしたい",
    "サビに広がりを作って",
    "ドラムを見せてほしい",
    "好きじゃないです",
    "この案は微妙",
    "いいえ、違います",
  ])("確認待ちでも疑問・保留・修正を含む返事は相談を続ける: %s", (text) => {
    expect(requestedResponseModeForConsultation(text, true)).toBe("discussion")
  })

  it.each(["はい", "お願いします"])("確認待ちでなければ短い肯定だけで案を作らない: %s", (text) => {
    expect(requestedResponseModeForConsultation(text, false)).toBe("discussion")
  })
})
