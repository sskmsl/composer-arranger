import { describe, expect, it } from "vitest"
import { requestedResponseModeForConsultation } from "./consultationFlow"

describe("アレンジ相談の確認フロー", () => {
  it.each([
    "この曲はストリングスを増やした方がいい？",
    "サビをもっと広げたい",
    "なぜドラムが多いの？",
    "こういうイントロにできる？",
    "別の案はある？",
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
})
