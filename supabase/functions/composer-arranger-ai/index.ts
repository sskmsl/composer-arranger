const ALLOWED_ORIGINS = new Set([
  "https://sskmsl.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
])

const MODEL = Deno.env.get("COMPOSER_ARRANGER_OPENAI_MODEL") ?? "gpt-5.6-luna"
const API_KEY = Deno.env.get("COMPOSER_ARRANGER_OPENAI_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
const MAX_BODY_BYTES = 120_000
const MAX_REQUESTS_PER_WINDOW = 10
const RATE_WINDOW_MS = 10 * 60 * 1000
const recentRequests = new Map<string, number[]>()

const intentProperties = {
  id: { type: "string", minLength: 1, maxLength: 80 },
  title: { type: "string", minLength: 1, maxLength: 80 },
  generator: {
    type: "string",
    enum: ["melody", "phrase", "signature", "counter", "decoration", "none"],
  },
  emotionalFunction: { type: "string", minLength: 1, maxLength: 240 },
  density: { type: "string", enum: ["sparse", "balanced", "active"] },
  register: { type: "string", enum: ["low", "middle", "high"] },
  drama: { type: "string", enum: ["restrained", "growing", "open"] },
  motion: { type: "string", enum: ["ascending", "descending", "wave", "static"] },
  rhythmCharacter: {
    type: "string",
    enum: ["spacious", "flowing", "syncopated", "pulsed", "fragmented"],
  },
  silenceStrategy: {
    type: "string",
    enum: ["minimal", "breathing", "structural"],
  },
  creativeRisk: { type: "string", enum: ["focused", "bold", "radical"] },
  lengthBars: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7, 8] },
  techniques: {
    type: "array",
    minItems: 1,
    maxItems: 5,
    items: { type: "string", minLength: 1, maxLength: 80 },
  },
  soundPalette: { type: "string", minLength: 1, maxLength: 300 },
  performanceDirection: { type: "string", minLength: 1, maxLength: 300 },
  why: { type: "string", minLength: 1, maxLength: 400 },
  generationBrief: { type: "string", minLength: 1, maxLength: 500 },
  soundSourceSuggestions: {
    type: "array",
    minItems: 1,
    maxItems: 3,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        family: { type: "string", minLength: 1, maxLength: 80 },
        character: { type: "string", minLength: 1, maxLength: 120 },
        searchTerms: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: { type: "string", minLength: 1, maxLength: 60 },
        },
        reason: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["family", "character", "searchTerms", "reason"],
    },
  },
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    diagnosis: {
      type: "object",
      additionalProperties: false,
      properties: {
        currentStrength: { type: "string", minLength: 1, maxLength: 400 },
        primaryOpportunity: { type: "string", minLength: 1, maxLength: 400 },
        protect: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: { type: "string", minLength: 1, maxLength: 160 },
        },
        avoid: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: { type: "string", minLength: 1, maxLength: 160 },
        },
        noAdditionRecommended: { type: "boolean" },
      },
      required: [
        "currentStrength",
        "primaryOpportunity",
        "protect",
        "avoid",
        "noAdditionRecommended",
      ],
    },
    intents: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: intentProperties,
        required: Object.keys(intentProperties),
      },
    },
  },
  required: ["diagnosis", "intents"],
}

const SYSTEM_PROMPT = `あなたは、作曲者の既存素材を尊重する熟練アレンジャーです。
入力には相談文と、Composer Arrangerが抽出したコード、Active Melody、Section、抽象化済みTechnique preferenceが含まれます。

目的:
- 現状の良さを診断し、採用価値のある3つの同等なArrangement Directionを返す。
- 3案は密度、音域、リズム、余白、役割、感情的入口のうち最低4軸で異ならせる。
- 音を増やすことを正解にせず、不要ならgenerator=noneを含める。
- コードとActive Melodyの衝突、機械的なコード追従、全拍の充填を避ける。
- 実音は後段の決定論的Generatorが作るため、generationBriefは実装可能な音楽語彙で書く。
- 固有曲や固有アーティストが相談文に含まれても、既存フレーズを再現しない。余白、輪郭、反復、音色、残響、演奏意図などの抽象属性へ変換する。
- 日本語で簡潔に書く。Technique名と音源検索語は一般的・抽象的な名称にする。
- 3案に優先順位を付けない。

generatorの意味:
- signature: 曲の顔となる1〜8小節の入口・フック
- counter: Active Melodyの隙間に置く対旋律
- decoration: セクション境界や呼吸点の装飾
- phrase: 2〜8小節の独立素材
- melody: セクションの主旋律候補
- none: 音を追加せず、演奏・空間・引き算だけを提案

soundSourceSuggestionsは特定製品を断定せず、音源ブラウザで探せるfamily、character、searchTermsと選定理由を返してください。`

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? ""
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://sskmsl.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  }
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  })
}

async function authenticatedUserId(authorization: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: SUPABASE_ANON_KEY,
    },
  })
  if (!response.ok) return null
  const user = await response.json() as { id?: unknown }
  return typeof user.id === "string" ? user.id : null
}

function rateLimitExceeded(userId: string): boolean {
  const now = Date.now()
  const active = (recentRequests.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_WINDOW_MS,
  )
  if (active.length >= MAX_REQUESTS_PER_WINDOW) {
    recentRequests.set(userId, active)
    return true
  }
  active.push(now)
  recentRequests.set(userId, active)
  return false
}

function openAiOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") return payload.output_text
  if (!Array.isArray(payload.output)) return null
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        (block as { type: unknown }).type === "output_text" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      ) {
        return (block as { text: string }).text
      }
    }
  }
  return null
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) })
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405)
  if (!API_KEY) return json(request, { error: "AI secret is not configured" }, 503)

  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return json(request, { error: "Authentication required" }, 401)
  }
  const userId = await authenticatedUserId(authorization)
  if (!userId) return json(request, { error: "Invalid session" }, 401)
  if (rateLimitExceeded(userId)) {
    return json(request, { error: "相談回数が一時上限に達しました。10分後に再試行してください。" }, 429)
  }

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(request, { error: "Request is too large" }, 413)
  }
  let body: { prompt?: unknown; context?: unknown }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return json(request, { error: "Invalid JSON" }, 400)
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (prompt.length < 3 || prompt.length > 1500 || !body.context || typeof body.context !== "object") {
    return json(request, { error: "相談内容または楽曲コンテキストが不正です。" }, 400)
  }

  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 6000,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ consultation: prompt, musicalContext: body.context }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "composer_arranger_advice",
          strict: true,
          schema: responseSchema,
        },
      },
    }),
  })

  const openAiPayload = await openAiResponse.json() as Record<string, unknown>
  if (!openAiResponse.ok) {
    const error = openAiPayload.error as { code?: unknown; message?: unknown } | undefined
    console.error("OpenAI request failed", openAiResponse.status, error?.code)
    return json(
      request,
      { error: "AIサービスへの接続に失敗しました。少し時間を置いて再試行してください。" },
      openAiResponse.status === 429 ? 429 : 502,
    )
  }
  const outputText = openAiOutputText(openAiPayload)
  if (!outputText) return json(request, { error: "AI response was incomplete" }, 502)

  let advice: Record<string, unknown>
  try {
    advice = JSON.parse(outputText)
  } catch {
    return json(request, { error: "AI response could not be parsed" }, 502)
  }

  const usage = (openAiPayload.usage ?? {}) as {
    input_tokens?: number
    output_tokens?: number
    output_tokens_details?: { reasoning_tokens?: number }
  }
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0
  // 2026-08-18時点のGPT-5.6 Luna標準価格。UIでは必ず「概算」と表示する。
  const estimatedCostUsd = inputTokens * 0.2 / 1_000_000 + outputTokens * 1.2 / 1_000_000

  return json(request, {
    requestId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    model: MODEL,
    ...advice,
    usage: {
      inputTokens,
      outputTokens,
      reasoningTokens,
      estimatedCostUsd,
    },
  })
})
