import { supabase } from "@/lib/supabase"
import { aiContextFingerprint } from "./context"
import type {
  AiArrangementRequest,
  AiArrangementResponse,
} from "./types"

const FUNCTION_NAME = "composer-arranger-ai"
const CACHE_PREFIX = "composer-arranger:ai-advice:v4:"
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
  const conversationFingerprint = JSON.stringify(request.conversation ?? null)
  return `${CACHE_PREFIX}${aiContextFingerprint(`${request.prompt}\n${audioFingerprint}\n${conversationFingerprint}`, request.context)}`
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
    typeof candidate.partnerReply === "string" &&
    Array.isArray(candidate.confirmedConstraints) &&
    Boolean(candidate.diagnosis) &&
    Boolean(candidate.usage)
  )
}

/** 中継処理(Edge Function)が返した英語の理由を、次に何をすればよいか分かる日本語へ直す */
const SERVER_ERROR_MESSAGES: Record<string, string> = {
  "AI secret is not configured":
    "AI相談用のOpenAIキーがSupabaseに設定されていません。SupabaseのEdge Function Secretsへ COMPOSER_ARRANGER_OPENAI_API_KEY を登録してください。",
  "Authentication required": "AI相談にはログインが必要です。いったんログアウトして、もう一度ログインしてください。",
  "Invalid session": "ログインの有効期限が切れています。いったんログアウトして、もう一度ログインしてください。",
  "Request is too large": "送る内容が大きすぎます。音源を外すか、相談内容を短くしてください。",
  "AI response was incomplete": "AIの応答が途中で終わりました。もう一度お試しください。",
  "AI response could not be parsed": "AIの応答を読み取れませんでした。もう一度お試しください。",
}

export function describeServerError(status: number | undefined, serverMessage: string | undefined): string {
  if (serverMessage && SERVER_ERROR_MESSAGES[serverMessage]) return SERVER_ERROR_MESSAGES[serverMessage]
  if (serverMessage) return `AI相談に失敗しました: ${serverMessage}`
  if (status === 404) {
    return "AI相談の処理(composer-arranger-ai)がSupabaseに公開されていません。Edge Functionをデプロイしてください。"
  }
  return status
    ? `AI相談に失敗しました(応答コード ${status})。少し時間を置いて再試行してください。`
    : "AI相談の処理に接続できませんでした。通信状態を確認して再試行してください。"
}

async function describeInvokeError(error: unknown): Promise<string> {
  // 2xx以外の応答では、本文の { error } が data ではなく error.context(Response)に入る
  const context = (error as { context?: unknown }).context
  if (context instanceof Response) {
    let serverMessage: string | undefined
    try {
      const body = await context.clone().json() as { error?: unknown }
      if (typeof body?.error === "string") serverMessage = body.error
    } catch {
      // 本文がJSONでない(関数が存在しない等)ときは応答コードだけで判断する
    }
    return describeServerError(context.status, serverMessage)
  }
  return describeServerError(undefined, undefined)
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
  if (error) throw new Error(await describeInvokeError(error))
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
