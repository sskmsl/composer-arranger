import { describe, expect, it } from "vitest"
import { describeServerError } from "./client"

describe("AI相談の失敗理由", () => {
  it("中継処理の英語の理由を、次の操作が分かる日本語へ直す", () => {
    expect(describeServerError(503, "AI secret is not configured")).toContain("COMPOSER_ARRANGER_OPENAI_API_KEY")
    expect(describeServerError(401, "Invalid session")).toContain("もう一度ログイン")
  })

  it("日本語の理由はそのまま伝える", () => {
    expect(describeServerError(429, "相談回数が一時上限に達しました。10分後に再試行してください。")).toContain("10分後")
  })

  it("本文がないときは応答コードから判断する", () => {
    expect(describeServerError(404, undefined)).toContain("デプロイ")
    expect(describeServerError(500, undefined)).toContain("500")
    expect(describeServerError(undefined, undefined)).toContain("接続できませんでした")
  })
})
