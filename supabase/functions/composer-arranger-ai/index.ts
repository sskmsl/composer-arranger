const ALLOWED_ORIGINS = new Set([
  "https://sskmsl.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
])

const MODEL = Deno.env.get("COMPOSER_ARRANGER_OPENAI_MODEL") ?? "gpt-5.6-luna"
const AUDIO_MODEL = Deno.env.get("COMPOSER_ARRANGER_OPENAI_AUDIO_MODEL") ?? "gpt-audio-1.5"
const API_KEY = Deno.env.get("COMPOSER_ARRANGER_OPENAI_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
const MAX_BODY_BYTES = 18_000_000
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const MAX_REQUESTS_PER_WINDOW = 10
const RATE_WINDOW_MS = 10 * 60 * 1000
const recentRequests = new Map<string, number[]>()

const intentProperties = {
  id: { type: "string", minLength: 1, maxLength: 80 },
  title: { type: "string", minLength: 1, maxLength: 80 },
  generator: {
    type: "string",
    enum: ["melody", "phrase", "signature", "counter", "decoration", "accompaniment", "rhythm", "none"],
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
        library: {
          type: "string",
          enum: ["Native Instruments Komplete 15 Ultimate", "u-he Repro"],
        },
        product: {
          type: "string",
          enum: [
            "Battery 4",
            "Session Percussionist",
            "Studio Drummer",
            "Abbey Road 60s Drummer",
            "Abbey Road 70s Drummer",
            "Abbey Road 80s Drummer",
            "Abbey Road Modern Drummer",
            "Butch Vig Drums",
            "Drumlab",
            "Damage",
            "Noire",
            "Una Corda",
            "Playbox",
            "Massive X",
            "Repro-1",
            "Repro-5",
          ],
        },
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
      required: ["library", "product", "family", "character", "searchTerms", "reason"],
    },
  },
  accompanimentPatternId: {
    type: "string",
    enum: [
      "pulse-root-fifth",
      "arpeggio-up",
      "chord-entry",
      "arpeggio-five",
      "arpeggio-six",
      "broken-ninth",
      "syncopated",
      "none",
    ],
  },
  rhythmPlan: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      subdivision: { type: "string", enum: ["eighth", "sixteenth", "triplet", "mixed"] },
      feel: { type: "string", enum: ["straight", "swing", "laid-back", "driving", "broken"] },
      kickPattern: { type: "string", maxLength: 240 },
      snarePattern: { type: "string", maxLength: 240 },
      hatPattern: { type: "string", maxLength: 240 },
      percussionPattern: { type: "string", maxLength: 240 },
      variation: { type: "string", maxLength: 300 },
      bars: { type: "integer", enum: [1, 2] },
      events: {
        type: "array",
        minItems: 0,
        maxItems: 64,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instrument: {
              type: "string",
              enum: [
                "kick",
                "snare",
                "closed-hat",
                "open-hat",
                "clap",
                "rim",
                "low-percussion",
                "high-percussion",
              ],
            },
            onsetBeat: { type: "number", minimum: 0, maximum: 32 },
            durationBeats: { type: "number", minimum: 0.03, maximum: 4 },
            velocity: { type: "integer", minimum: 1, maximum: 127 },
          },
          required: ["instrument", "onsetBeat", "durationBeats", "velocity"],
        },
      },
    },
    required: [
      "enabled",
      "subdivision",
      "feel",
      "kickPattern",
      "snarePattern",
      "hatPattern",
      "percussionPattern",
      "variation",
      "bars",
      "events",
    ],
  },
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    partnerReply: { type: "string", minLength: 1, maxLength: 700 },
    confirmedConstraints: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
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
        audioEvidence: {
          type: "array",
          minItems: 0,
          maxItems: 6,
          items: { type: "string", minLength: 1, maxLength: 200 },
        },
        audioConfidenceNote: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: [
        "currentStrength",
        "primaryOpportunity",
        "protect",
        "avoid",
        "noAdditionRecommended",
        "audioEvidence",
        "audioConfidenceNote",
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
  required: ["partnerReply", "confirmedConstraints", "diagnosis", "intents"],
}

const SYSTEM_PROMPT = `あなたは、作曲者の既存素材を尊重する熟練アレンジャーです。
入力には相談文と、Composer Arrangerが抽出したコード、Active Melody、Section、抽象化済みTechnique preferenceが含まれます。

Arrangement Constitution:
- musicalContext.arrangementConstitutionは全提案に先立つ最上位の編曲判断原則である。
- 判断順序は、明示された制約と既存素材 → 音楽的品質と感情の必然性 → 曲全体での役割 → Technique → 数値上の差異とする。
- 主旋律を主人公として守り、追加音には登場理由を持たせる。理由がなければgenerator=noneを選べる。
- 密度の増加ではなく対比で感情を作る。反復は記憶の核、変化は意味のある事件として設計する。
- 休符、残響、鳴り終わりも演奏として扱い、最高音、最大密度、強い音色、完全な解決を必要な地点まで温存する。
- 音色、音域、前景・背景、残響を作曲構造として扱う。
- 各Directionのwhyには、何を守るか、追加する音の役割、どの期待または余韻を作るかを具体的に含める。
- Technique preferenceと新奇性がConstitutionに反する場合はConstitutionを優先する。

Arrangement Director:
- musicalContext.arrangementDirectorは曲全体の設計図である。相談対象Sectionだけを局所最適化せず、必ず対応するSection planを参照する。
- targetEnergy、densityCeiling、additionBudgetは上限として扱う。additionBudget=0なら、原則としてgenerator=noneまたは既存パートの演奏・音色・引き算を提案する。
- climaxPolicy=reserve/approachではwithholdにある資源を使い切らない。expressのSectionだけが温存資源を全面的に使える。
- transitionIntentをgenerationBriefへ反映し、提案が次Sectionへどのように接続するかを明確にする。
- 同じroleが反復されても同じ編曲を複製せず、曲中のorderとclimaxPolicyに応じて役割を変える。

Review Loop:
- musicalContext.arrangementReviewは、現在Set Activeされている実音の決定論的レビューである。推測よりこの測定結果を優先する。
- musicalContext.wholeSongArrangementReviewは全Section横断の監査である。局所案が良くても、Energy差・伴奏交代・頂点温存が平坦なら全曲側の指摘を優先する。
- wholeSongArrangementReviewにwarning/blockingがある場合、対象Sectionだけへ音を足して解決しない。低Energy側の退場、Pattern置換、音域予約など曲全体の差を作る案を含める。
- status=reviseまたはblocking findingがある場合、その原因をdiagnosis.primaryOpportunityとavoidへ反映し、同じ問題を増やすDirectionを出さない。
- status=watchでは既存素材を全否定せず、該当findingだけを直す最小変更案を少なくとも1案含める。
- status=strongでは不要な修正を作らず、現状維持またはgenerator=noneを含められる。
- Reviewのscoreだけで音楽的合否を断定しない。数値は衝突・密度・余白・頂点温存の安全検査として扱う。

Orchestration & Performance Intelligence:
- musicalContext.orchestrationの対象Section planを参照し、soundPaletteとperformanceDirectionをその構造へ一致させる。
- musicalContext.orchestrationReviewは、固定値を含む現在のOrchestration Planに対する決定論的なマスキング監査である。
- musicalContext.audibleLayerReviewは、実際のPreview/MIDI材料から再計算したActive Melodyと補助レイヤーの実音衝突監査である。保存済み候補scoreより優先する。
- audibleLayerReviewで同音・短2度・感情点アタックが指摘された場合、コード適合だけで正当化しない。発音位置、休符、音域、最後に音高の順で最小修正を提案する。
- Active Noteの衝突がreviseなら、同じLayerをさらに重ねるDirectionを出さない。generator=noneまたは既存Layerの再生成・引き算を含める。
- orchestrationReviewがreviseまたはwarningを含む場合、新しいLayerを足す前にdistance、dynamic、register、familyのうち最小限の分離で主役を守る。
- 作曲者が固定した値を無視して自動案へ戻さない。問題の根拠と、固定意図を保つ最小修正案を説明する。
- 各パートはfamily名だけでなく、role、distance、register、articulation、dynamic、timing、entry、exit、purposeを一体として扱う。
- sourceState=activeのパートを無視して新規レイヤーを重ねない。recommendedはDirectorのadditionBudgetとmaxSimultaneousPartsの範囲だけで提案する。
- withheldGesturesはクライマックスまで温存する。音源の豪華さで早期に解禁しない。
- lead-focusより補助パートを前景・強音量へ置かない。CounterとTransitionは主旋律の重要アタック前に退く。
- 音源製品名は実装可能な候補として示すが、プリセット名を編曲意図の代わりにしない。

目的:
- 現状の良さを診断し、採用価値のある3つの同等なArrangement Directionを返す。
- 3案は密度、音域、リズム、余白、役割、感情的入口のうち最低4軸で異ならせる。
- 音を増やすことを正解にせず、不要ならgenerator=noneを含める。
- コードとActive Melodyの衝突、機械的なコード追従、全拍の充填を避ける。
- リズムや伴奏の推進力が課題ならgenerator=accompanimentを選び、musicalContext.arrangement.availableAccompanimentPatternsから適切なIDをaccompanimentPatternIdへ指定する。コードの羅列ではなく、オンセット、休符、アクセント、反復周期とActive Melodyの隙間を判断する。
- generator=accompaniment以外ではaccompanimentPatternId=noneにする。
- ドラム／パーカッションのリズムそのものが課題ならgenerator=rhythmを選ぶ。rhythmPlanに1〜2小節の再現可能な配置（拍・裏拍・休符・アクセント・2周目の変化）を記述し、単なるジャンル名だけで済ませない。
- generator=rhythmではbarsを1または2にし、eventsへ実際にMIDI化する全打点を入れる。onsetBeatはループ先頭=0とする四分音符単位（例: 1拍目=0、1拍目裏=0.5、2拍目=1）。velocityで主従・アクセントを表し、全ステップを埋めず呼吸を残す。
- generator=rhythmの場合だけrhythmPlan.enabled=trueにし、それ以外ではfalse・各パターン文字列は空、bars=1、events=[]にする。
- 実音は後段の決定論的Generatorが作るため、generationBriefは実装可能な音楽語彙で書く。
- 固有曲や固有アーティストが相談文に含まれても、既存フレーズを再現しない。余白、輪郭、反復、音色、残響、演奏意図などの抽象属性へ変換する。
- 日本語で簡潔に書く。Technique名と音源検索語は一般的・抽象的な名称にする。
- 3案に優先順位を付けない。
- conversationHistoryがある場合、最新相談へpartnerReplyで直接答え、過去の合意と変更経緯を踏まえて3案を更新する。同じ説明を最初から繰り返さない。
- conversationHistory.confirmedConstraintsを現在有効な制約の正とする。過去turnにだけ残り、現在一覧から外れた制約はUIで解除済みなので復活させない。
- confirmedConstraintsは今回だけの提案ではなく、ユーザーが明示的に確定した制約の「現在有効な完全一覧」にする。既存制約はユーザーが明示的に解除・変更しない限り維持する。
- 「メロディは変えない」「音数を増やさない」「もっと不穏」「ベルは使わない」等を、後続Directionのdensity、register、silenceStrategy、soundPalette、generationBriefへ実際に反映する。
- AI相談だけでGeneratorを実行したように書かない。実音化にはユーザーが「この案を生成」を押す必要があることを守る。
- audioAnalysisがある場合は、実際の音源から確認できた編曲上の証拠をaudioEvidenceへ記録する。推測を断定せず、確信度や限界をaudioConfidenceNoteへ書く。
- audioAnalysisがない場合、audioEvidenceは空配列、audioConfidenceNoteは「音源未添付のためプロジェクトデータから判断」とする。

generatorの意味:
- signature: 曲の顔となる1〜8小節の入口・フック
- counter: Active Melodyの隙間に置く対旋律
- decoration: セクション境界や呼吸点の装飾
- accompaniment: コードへ適用する伴奏リズム骨格。既存Accompaniment Patternを選択する
- rhythm: Logic Proでドラム／パーカッションを組むための具体的なリズムパターン提案。rhythmPlan.eventsからMIDIを直接書き出す
- phrase: 2〜8小節の独立素材
- melody: セクションの主旋律候補
- none: 音を追加せず、演奏・空間・引き算だけを提案

soundSourceSuggestionsはユーザー所有音源だけから選ぶ。libraryとproductは必ず次の実在候補を使い、用途に合う検索語と理由を返す。
- Native Instruments Komplete 15 Ultimate: Battery 4（電子・加工ドラム）、Session Percussionist（有機的パーカッション）、Studio Drummer / Abbey Road Drummer（生ドラム）、Butch Vig Drums / Drumlab（加工・ハイブリッドドラム）、Damage（シネマティック打撃）、Noire / Una Corda（ピアノ）、Playbox（レイヤー音色）、Massive X（デジタル／モダンシンセ）
- u-he Repro: Repro-1（モノフォニックのベース、シーケンス、リード）、Repro-5（ポリフォニックのコード、パッド、プラック）
候補名だけでなく、どの音の役割に使うかをreasonへ明記する。所有リスト外の製品は提案しない。`

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

function rateLimitExceeded(userId: string, limit = MAX_REQUESTS_PER_WINDOW): boolean {
  const now = Date.now()
  const active = (recentRequests.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_WINDOW_MS,
  )
  if (active.length >= limit) {
    recentRequests.set(userId, active)
    return true
  }
  active.push(now)
  recentRequests.set(userId, active)
  return false
}

interface ConversationInput {
  confirmedConstraints: string[]
  turns: Array<{
    userMessage: string
    partnerReply: string
    confirmedConstraints: string[]
    directions: Array<{
      title: string
      generator: string
      emotionalFunction: string
      generationBrief: string
    }>
  }>
}

function normalizedConversation(value: unknown): ConversationInput | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as { confirmedConstraints?: unknown; turns?: unknown }
  if (!Array.isArray(candidate.confirmedConstraints) || !Array.isArray(candidate.turns)) {
    return null
  }
  const constraints = candidate.confirmedConstraints
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean)
    .slice(-12)
  const turns = candidate.turns.slice(-10).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return []
    const turn = raw as Record<string, unknown>
    if (typeof turn.userMessage !== "string" || typeof turn.partnerReply !== "string") {
      return []
    }
    const directions = Array.isArray(turn.directions)
      ? turn.directions.slice(0, 3).flatMap((rawDirection) => {
          if (!rawDirection || typeof rawDirection !== "object") return []
          const direction = rawDirection as Record<string, unknown>
          if (
            typeof direction.title !== "string" ||
            typeof direction.generator !== "string" ||
            typeof direction.emotionalFunction !== "string" ||
            typeof direction.generationBrief !== "string"
          ) return []
          return [{
            title: direction.title.slice(0, 80),
            generator: direction.generator.slice(0, 24),
            emotionalFunction: direction.emotionalFunction.slice(0, 240),
            generationBrief: direction.generationBrief.slice(0, 500),
          }]
        })
      : []
    return [{
      userMessage: turn.userMessage.slice(0, 1500),
      partnerReply: turn.partnerReply.slice(0, 700),
      confirmedConstraints: Array.isArray(turn.confirmedConstraints)
        ? turn.confirmedConstraints
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.slice(0, 120))
            .slice(-12)
        : [],
      directions,
    }]
  })
  return { confirmedConstraints: [...new Set(constraints)], turns }
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

function chatOutputText(payload: Record<string, unknown>): string | null {
  const choices = payload.choices
  if (!Array.isArray(choices)) return null
  const first = choices[0]
  if (!first || typeof first !== "object") return null
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== "object") return null
  const content = (message as { content?: unknown }).content
  return typeof content === "string" ? content : null
}

interface AudioInput {
  fileName: string
  format: "mp3" | "wav"
  sizeBytes: number
  dataBase64: string
  localFeatures: Record<string, unknown>
}

function validAudioInput(value: unknown): value is AudioInput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<AudioInput>
  return (
    typeof candidate.fileName === "string" &&
    (candidate.format === "mp3" || candidate.format === "wav") &&
    typeof candidate.sizeBytes === "number" &&
    candidate.sizeBytes > 0 &&
    candidate.sizeBytes <= MAX_AUDIO_BYTES &&
    typeof candidate.dataBase64 === "string" &&
    candidate.dataBase64.length > 0 &&
    Boolean(candidate.localFeatures) &&
    typeof candidate.localFeatures === "object"
  )
}

async function analyzeAudio(
  audio: AudioInput,
  prompt: string,
  context: Record<string, unknown>,
): Promise<{ text: string; costUsd: number; inputTokens: number; outputTokens: number }> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AUDIO_MODEL,
      modalities: ["text"],
      max_completion_tokens: 2200,
      messages: [
        {
          role: "system",
          content: `あなたは音楽音源を聴いて編曲上の事実を抽出する分析者です。曲名当て、既存曲との同定、歌詞の転記は行いません。
音量推移、密度、余白、リズムの押し引き、音域配置、前景と背景、反復、セクション変化、衝突、未活用の空間を観察してください。
聴き取れない音高・楽器・拍位置を断定せず、観察と推測を分けます。出力は日本語で、後段のアレンジャーが使える簡潔な分析にしてください。`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                consultation: prompt,
                projectContext: context,
                browserMeasuredFeatures: audio.localFeatures,
                requestedOutput: {
                  observations: "音源から直接確認できる事実を6件以内",
                  opportunities: "編曲上の余地を4件以内",
                  uncertainties: "断定できない点",
                },
              }),
            },
            {
              type: "input_audio",
              input_audio: { data: audio.dataBase64, format: audio.format },
            },
          ],
        },
      ],
    }),
  })
  const payload = await response.json() as Record<string, unknown>
  if (!response.ok) {
    const error = payload.error as { code?: unknown } | undefined
    console.error("OpenAI audio request failed", response.status, error?.code)
    throw new Error("音源解析サービスへ接続できませんでした。")
  }
  const text = chatOutputText(payload)
  if (!text) throw new Error("音源解析結果が不完全でした。")
  const usage = (payload.usage ?? {}) as {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { audio_tokens?: number }
  }
  const inputTokens = usage.prompt_tokens ?? 0
  const outputTokens = usage.completion_tokens ?? 0
  const audioTokens = usage.prompt_tokens_details?.audio_tokens ?? 0
  const textInputTokens = Math.max(0, inputTokens - audioTokens)
  const costUsd = textInputTokens * 2.5 / 1_000_000
    + audioTokens * 32 / 1_000_000
    + outputTokens * 10 / 1_000_000
  return { text: text.slice(0, 8_000), costUsd, inputTokens, outputTokens }
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

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(request, { error: "Request is too large" }, 413)
  }
  let body: { prompt?: unknown; context?: unknown; conversation?: unknown; audio?: unknown }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return json(request, { error: "Invalid JSON" }, 400)
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (prompt.length < 3 || prompt.length > 1500 || !body.context || typeof body.context !== "object") {
    return json(request, { error: "相談内容または楽曲コンテキストが不正です。" }, 400)
  }
  const audio = body.audio === undefined ? null : validAudioInput(body.audio) ? body.audio : undefined
  if (audio === undefined) return json(request, { error: "添付音源の形式またはサイズが不正です。" }, 400)
  const conversation = body.conversation === undefined
    ? null
    : normalizedConversation(body.conversation)
  if (body.conversation !== undefined && conversation === null) {
    return json(request, { error: "会話履歴の形式が不正です。" }, 400)
  }
  const rateLimitKey = `${userId}:${audio ? "audio" : "text"}`
  if (rateLimitExceeded(rateLimitKey, audio ? 3 : MAX_REQUESTS_PER_WINDOW)) {
    return json(request, { error: "相談回数が一時上限に達しました。10分後に再試行してください。" }, 429)
  }

  let audioAnalysis: { text: string; costUsd: number; inputTokens: number; outputTokens: number } | null = null
  if (audio) {
    try {
      audioAnalysis = await analyzeAudio(audio, prompt, body.context as Record<string, unknown>)
    } catch (error) {
      console.error("Audio analysis failed", error instanceof Error ? error.message : "unknown")
      return json(request, { error: error instanceof Error ? error.message : "音源解析に失敗しました。" }, 502)
    }
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
          content: JSON.stringify({
            consultation: prompt,
            musicalContext: body.context,
            conversationHistory: conversation,
            audioAnalysis: audioAnalysis?.text ?? null,
            browserMeasuredAudioFeatures: audio?.localFeatures ?? null,
          }),
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
  const estimatedCostUsd = inputTokens * 0.2 / 1_000_000
    + outputTokens * 1.2 / 1_000_000
    + (audioAnalysis?.costUsd ?? 0)

  return json(request, {
    requestId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    model: audioAnalysis ? `${AUDIO_MODEL} + ${MODEL}` : MODEL,
    ...advice,
    usage: {
      inputTokens: inputTokens + (audioAnalysis?.inputTokens ?? 0),
      outputTokens: outputTokens + (audioAnalysis?.outputTokens ?? 0),
      reasoningTokens,
      estimatedCostUsd,
    },
  })
})
