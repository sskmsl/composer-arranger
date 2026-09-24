import { describe, expect, it } from "vitest"
import { entriesInMonth, formatUsd, readAiUsage, recordAiUsage, summarizeAiUsage } from "./usageLog"

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

describe("AI相談の使用量", () => {
  it("相談ごとに記録し、キャッシュ(再利用)は利用料とトークンに数えない", () => {
    const storage = memoryStorage()
    recordAiUsage({ at: "2026-09-01T10:00:00.000Z", costUsd: 0.012, inputTokens: 3000, outputTokens: 800, cached: false }, storage)
    recordAiUsage({ at: "2026-09-02T10:00:00.000Z", costUsd: 0.02, inputTokens: 4000, outputTokens: 900, cached: false }, storage)
    recordAiUsage({ at: "2026-09-02T11:00:00.000Z", costUsd: 0.02, inputTokens: 4000, outputTokens: 900, cached: true }, storage)
    const summary = summarizeAiUsage(readAiUsage(storage))
    expect(summary.requests).toBe(3)
    expect(summary.cachedRequests).toBe(1)
    expect(summary.costUsd).toBeCloseTo(0.032)
    expect(summary.inputTokens).toBe(7000)
    expect(summary.outputTokens).toBe(1700)
  })

  it("月ごとに絞り込み、壊れた記録は無視する", () => {
    const storage = memoryStorage()
    recordAiUsage({ at: "2026-08-31T10:00:00.000Z", costUsd: 1, inputTokens: 1, outputTokens: 1, cached: false }, storage)
    recordAiUsage({ at: "2026-09-15T10:00:00.000Z", costUsd: 2, inputTokens: 1, outputTokens: 1, cached: false }, storage)
    const september = entriesInMonth(readAiUsage(storage), new Date("2026-09-20T12:00:00"))
    expect(september.map((entry) => entry.costUsd)).toEqual([2])
    const broken = { getItem: () => "{not json" }
    expect(readAiUsage(broken)).toEqual([])
  })

  it("金額は桁に応じて読みやすく出す", () => {
    expect(formatUsd(0)).toBe("$0")
    expect(formatUsd(0.0042)).toBe("約$0.0042")
    expect(formatUsd(0.123)).toBe("約$0.123")
    expect(formatUsd(3.5)).toBe("約$3.50")
  })
})
