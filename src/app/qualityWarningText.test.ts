import { describe, expect, it } from "vitest"
import { qualityWarningText } from "./qualityWarningText"

describe("quality warning text", () => {
  it("names the main causes first, in plain words", () => {
    const text = qualityWarningText(["和音に合わない音が多い", "伴奏が主旋律と重なっている"])
    expect(text).toContain("主な原因は、和音に合わない音が多い、伴奏が主旋律と重なっていることです。")
    expect(text).toContain("品質の基準に届いていません")
    expect(text).toContain("セクションの区切り、コード、主旋律を確認")
  })

  it("keeps working for saved data without causes", () => {
    for (const reasons of [undefined, []]) {
      const text = qualityWarningText(reasons)
      expect(text).not.toContain("主な原因")
      expect(text).toContain("十分な品質の案を作れませんでした。")
    }
  })
})
