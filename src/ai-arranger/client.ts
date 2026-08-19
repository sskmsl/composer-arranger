import { supabase } from "@/lib/supabase"
import { aiContextFingerprint } from "./context"
import type {
  AiArrangementRequest,
  AiArrangementResponse,
} from "./types"

const FUNCTION_NAME = "composer-arranger-ai"
const CACHE_PREFIX = "composer-arranger:ai-advice:v2:"
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface CachedAdvice {
  savedAt: number
  response: AiArrangementResponse
}

function cacheKey(request: AiArrangementRequest): string {
  const audioFingerprint = request.audio
    ? JSON.stringify({
        fileName: request.audio.fileName,
        sizeBytes: request.audio.sizeBytes,
        localFeatures: request.audio.localFeatures,
      })
    : "no-audio"
  return `${CACHE_PREFIX}${aiContextFingerprint(`${request.prompt}\n${audioFingerprint}`, request.context)}`
}

function cachedAdvice(request: AiArrangementRequest): AiArrangementResponse | null {
  try {
    const raw = localStorage.getItem(cacheKey(request))
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedAdvice
    if (Date.now() - cached.savedAt > CACHE_MAX_AGE_MS) return null
    return { ...cached.response, cached: true }
  } catch {
    return null
  }
}

function saveCachedAdvice(
  request: AiArrangementRequest,
  response: AiArrangementResponse,
): void {
  try {
    const value: CachedAdvice = { savedAt: Date.now(), response }
    localStorage.setItem(cacheKey(request), JSON.stringify(value))
  } catch {
    // キャッシュ不可でもAI相談そのものは成功として扱う。
  }
}

function isArrangementResponse(value: unknown): value is AiArrangementResponse {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<AiArrangementResponse>
  return (
    typeof candidate.requestId === "string" &&
    typeof candidate.model === "string" &&
    Array.isArray(candidate.intents) &&
    candidate.intents.length === 3 &&
    Boolean(candidate.diagnosis) &&
    Boolean(candidate.usage)
  )
}

export async function requestArrangementAdvice(
  request: AiArrangementRequest,
  options: { bypassCache?: boolean } = {},
): Promise<AiArrangementResponse> {
  const prompt = request.prompt.trim()
  if (prompt.length < 3) throw new Error("相談内容を3文字以上入力してください。")
  if (prompt.length > 1500) throw new Error("相談内容は1500文字以内にしてください。")
  if (!supabase) throw new Error("Cloud設定がないためAI相談を利用できません。")

  const normalized = { ...request, prompt }
  if (!options.bypassCache) {
    const cached = cachedAdvice(normalized)
    if (cached) return cached
  }

  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: normalized,
  })
  if (error) throw new Error(`AI相談に失敗しました: ${error.message}`)
  if (!isArrangementResponse(data)) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "AIから不正な形式の応答が返りました。"
    throw new Error(message)
  }
  saveCachedAdvice(normalized, data)
  return data
}
