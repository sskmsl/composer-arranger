import { describe, expect, it } from "vitest"
import { isArrangementResponse } from "./client"

const base = {
  requestId: "request-1",
  createdAt: "2026-10-10T00:00:00.000Z",
  model: "test",
  partnerReply: "相談への回答です。",
  confirmedConstraints: [],
  diagnosis: {},
  usage: {},
}

describe("AI相談の対話プロトコル", () => {
  it("質問への返答は案を持たず、確認の問いを持つ", () => {
    expect(isArrangementResponse({
      ...base,
      responseMode: "discussion",
      confirmationQuestion: "この方向で具体的な3案を作ってよいですか？",
      intents: [],
    })).toBe(true)
  })

  it("確認後の返答だけが3案を持てる", () => {
    expect(isArrangementResponse({
      ...base,
      responseMode: "proposal",
      confirmationQuestion: "",
      intents: [{}, {}, {}],
    })).toBe(true)
    expect(isArrangementResponse({
      ...base,
      responseMode: "discussion",
      confirmationQuestion: "この方向でよいですか？",
      intents: [{}, {}, {}],
    })).toBe(false)
    expect(isArrangementResponse({
      ...base,
      responseMode: "proposal",
      confirmationQuestion: "",
      intents: [],
    })).toBe(false)
  })

  it("公開切り替え中の旧3案形式も読み取れる", () => {
    expect(isArrangementResponse({ ...base, intents: [{}, {}, {}] })).toBe(true)
  })
})
