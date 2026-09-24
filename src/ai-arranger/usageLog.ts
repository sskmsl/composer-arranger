/**
 * AI相談の使用量の記録。1回の相談ごとに、推定利用料とトークン数をこの端末(ブラウザ)に残す。
 * 請求額の正確な値はOpenAIの利用状況ページで確認する(ここはアプリが受け取った概算の合計)。
 */
export interface AiUsageEntry {
  at: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  /** 同じ相談をキャッシュから返した(利用料なし) */
  cached: boolean
}

export interface AiUsageSummary {
  requests: number
  cachedRequests: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

const STORAGE_KEY = "composer-arranger:ai-usage:v1"
/** 端末に残すのは直近の分だけ(1年分あれば月ごとの確認に足りる) */
const MAX_ENTRIES = 2000

export const OPENAI_USAGE_URL = "https://platform.openai.com/usage"

export function readAiUsage(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): AiUsageEntry[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is AiUsageEntry =>
          Boolean(entry) && typeof entry === "object" && typeof (entry as AiUsageEntry).at === "string",
        )
      : []
  } catch {
    return []
  }
}

export function recordAiUsage(
  entry: AiUsageEntry,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): void {
  try {
    const entries = [...readAiUsage(storage), entry].slice(-MAX_ENTRIES)
    storage?.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // 保存できない環境(プライベートブラウズ等)では記録を諦める。相談そのものは続ける
  }
}

export function summarizeAiUsage(entries: AiUsageEntry[]): AiUsageSummary {
  return entries.reduce<AiUsageSummary>(
    (sum, entry) => ({
      requests: sum.requests + 1,
      cachedRequests: sum.cachedRequests + (entry.cached ? 1 : 0),
      costUsd: sum.costUsd + (entry.cached ? 0 : entry.costUsd),
      inputTokens: sum.inputTokens + (entry.cached ? 0 : entry.inputTokens),
      outputTokens: sum.outputTokens + (entry.cached ? 0 : entry.outputTokens),
    }),
    { requests: 0, cachedRequests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
  )
}

/** その月(端末の現地時刻)の分だけ */
export function entriesInMonth(entries: AiUsageEntry[], now = new Date()): AiUsageEntry[] {
  return entries.filter((entry) => {
    const at = new Date(entry.at)
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth()
  })
}

/** 「約$0.012」のような表示。1セント未満も読めるよう桁を変える */
export function formatUsd(value: number): string {
  if (value <= 0) return "$0"
  if (value < 0.01) return `約$${value.toFixed(4)}`
  if (value < 1) return `約$${value.toFixed(3)}`
  return `約$${value.toFixed(2)}`
}

export function formatTokens(value: number): string {
  return value >= 10000 ? `${(value / 1000).toFixed(1)}千` : value.toLocaleString("ja-JP")
}
