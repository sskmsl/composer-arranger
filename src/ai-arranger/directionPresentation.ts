import type { AiArrangementIntent } from "./types"

export interface AudibleDirectionPresentation {
  title: string
  summary: string
  changes: [string, string, string]
}

const DENSITY_TEXT = {
  sparse: "音数を絞る",
  balanced: "必要な場所だけ音を足す",
  active: "動きを増やす",
} as const

const REGISTER_TEXT = {
  low: "低い音を使う",
  middle: "中音域を使う",
  high: "高い音を要所だけ使う",
} as const

const RHYTHM_TEXT = {
  spacious: "長い音と休みを使う",
  flowing: "音を滑らかにつなぐ",
  syncopated: "拍から少しずらして鳴らす",
  pulsed: "短い音を繰り返す",
  fragmented: "短い音を断続的に置く",
} as const

const SILENCE_TEXT = {
  minimal: "休みは少なめ",
  breathing: "主旋律と一緒に休む",
  structural: "節目では鳴らさない",
} as const

const PRESENTATION_BY_GENERATOR: Record<
  AiArrangementIntent["generator"],
  Pick<AudibleDirectionPresentation, "title" | "summary">
> = {
  melody: {
    title: "主旋律の間を整える",
    summary: "音の長さと休み方を変えます。",
  },
  phrase: {
    title: "主旋律の隙間に返答を置く",
    summary: "主旋律が休む場所だけに短いフレーズを加えます。",
  },
  signature: {
    title: "曲の目印を作る",
    summary: "要所に覚えやすい短いフレーズを置きます。",
  },
  counter: {
    title: "第二の旋律を置く",
    summary: "主旋律の後ろで別の旋律を短く鳴らします。",
  },
  decoration: {
    title: "要所に一音を足す",
    summary: "曲の節目にベルなどの短い音を加えます。",
  },
  accompaniment: {
    title: "伴奏で曲を前へ進める",
    summary: "低音や短い反復で曲の流れを作ります。",
  },
  rhythm: {
    title: "ドラムの流れを変える",
    summary: "ドラムを鳴らす位置と休み方を変えます。",
  },
  none: {
    title: "余白を残す",
    summary: "音を加えず、次の始まりを目立たせます。",
  },
}

/**
 * AIの自由文をそのまま判断材料にせず、音を聴く前に分かる3点へ変換する。
 * 専門用語の説明責任はAIではなくUI側が持つ。
 */
export function audibleDirectionPresentation(
  intent: AiArrangementIntent,
): AudibleDirectionPresentation {
  const base = PRESENTATION_BY_GENERATOR[intent.generator]
  return {
    ...base,
    changes: [
      DENSITY_TEXT[intent.density],
      REGISTER_TEXT[intent.register],
      `${RHYTHM_TEXT[intent.rhythmCharacter]}／${SILENCE_TEXT[intent.silenceStrategy]}`,
    ],
  }
}

function amountDescription(value: string, subject: string): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return subject
  if (amount < 15) return `${subject}はほとんどない`
  if (amount < 40) return `${subject}は控えめに使われている`
  if (amount < 70) return `${subject}は適度に使われている`
  return `${subject}が多く使われている`
}

/**
 * APIが返すすべての説明文を、内部指標や専門語ではなく聴感の言葉へ直す。
 * 元データは生成処理のために保持し、表示時だけ変換する。
 */
export function plainDirectionText(value: string): string {
  return value
    .replace(/最後のパルスを抜いて\s*1拍目を強く感じさせる[。.]?/g, "小節の最後を休ませ、次の小節の始まりをはっきり聴かせる。")
    .replace(/モチーフ反復率(?:が|は)?(?:約)?\s*(\d+(?:\.\d+)?)%/gi, (_, amount: string) => amountDescription(amount, "短い音型の繰り返し"))
    .replace(/コードトーン使用率(?:が|は)?(?:約)?\s*(\d+(?:\.\d+)?)%/gi, (_, amount: string) => amountDescription(amount, "コードになじむ音"))
    .replace(/シンコペーション率(?:が|は)?(?:約)?\s*(\d+(?:\.\d+)?)%/gi, (_, amount: string) => amountDescription(amount, "拍を少しずらす動き"))
    .replace(/休符率(?:が|は)?(?:約)?\s*(\d+(?:\.\d+)?)%/gi, (_, amount: string) => amountDescription(amount, "休み"))
    .replace(/(?:最高音|highest[ -]?note)\s*\d+/gi, "最も高い音")
    .replace(/Energy\s*[0-9.]+/gi, "曲の盛り上がり")
    .replace(/\bDirection\b/gi, "方針")
    .replace(/\bGenerator\b/gi, "生成機能")
    .replace(/\bActive Melody\b/gi, "採用中の主旋律")
    .replace(/\bSection\b/gi, "セクション")
    .replace(/\bIntro\b/gi, "イントロ")
    .replace(/\bVerse\b/gi, "Aメロ")
    .replace(/\bPre[ -]?Chorus\b/gi, "サビ前")
    .replace(/\bChorus\b/gi, "サビ")
    .replace(/\bBridge\b/gi, "間奏")
    .replace(/\bOutro\b/gi, "アウトロ")
    .replace(/ノンコードトーン|非コードトーン/gi, "コード外の音")
    .replace(/コードトーン/gi, "コードに含まれる音")
    .replace(/半音アプローチ/gi, "次の音へ半音で近づく動き")
    .replace(/クロマチック(?:・|\s)?アプローチ/gi, "次の音へ半音ずつ近づく動き")
    .replace(/ボイスリーディング|ヴォイスリーディング/gi, "音同士の滑らかなつながり")
    .replace(/オスティナート/gi, "繰り返し続ける短い音型")
    .replace(/ペダル(?:・|\s)?トーン/gi, "同じ音を保つ低音")
    .replace(/シンコペーション/gi, "拍の表から少しずらしたリズム")
    .replace(/レジスター/gi, "音域")
    .replace(/モチーフ/gi, "短い音型")
    .replace(/アタック/gi, "音の立ち上がり")
    .replace(/構造点/gi, "曲の節目")
    .replace(/パルス/gi, "短く繰り返す伴奏")
    .replace(/シーケンス/gi, "繰り返しながら動く音型")
    .replace(/テンション(?:ノート)?/gi, "緊張感を作る音")
    .replace(/クライマックス/gi, "最も盛り上がる場所")
    .replace(/カデンツ|ケーデンス/gi, "フレーズの終わり方")
    .replace(/コンター|輪郭線/gi, "音の上がり下がり")
    .replace(/スウェル/gi, "次第に大きくなる音")
    .replace(/フィル(?!ター)/gi, "つなぎの短い演奏")
    .replace(/ダイナミクス/gi, "強弱")
    .replace(/ベロシティ/gi, "音の強さ")
    .replace(/アーティキュレーション/gi, "音の切り方・つなぎ方")
    .replace(/テクスチャ/gi, "音の重なり方")
    .replace(/レイヤー/gi, "追加パート")
    .replace(/サステイン/gi, "音を長く保つ演奏")
    .replace(/トランジェント/gi, "音の立ち上がり")
    .replace(/マスキング/gi, "音同士が重なって聴こえにくくなる状態")
    .replace(/ユニゾン/gi, "同じ高さの音")
    .replace(/短2度|長2度/gi, "隣り合う近い音")
    .replace(/密度/gi, "音の量")
    .replace(/ピーク/gi, "最も盛り上がる場所")
    .replace(/アクセント/gi, "強く鳴らす位置")
    .replace(/オンセット/gi, "音を鳴らす位置")
    .replace(/フック/gi, "耳に残る短いフレーズ")
    .replace(/アプローチ/gi, "近づき方")
    .replace(/\s{2,}/g, " ")
}

/** 初期表示用。結論を一文だけ残し、詳しい説明は折りたたみ側へ回す。 */
export function conciseDirectionText(value: string, maxChars = 64): string {
  const plain = plainDirectionText(value).trim()
  if (!plain) return plain

  const firstSentence = plain.match(/^.*?[。！？!?]/)?.[0]?.trim() ?? plain
  if (firstSentence.length <= maxChars) return firstSentence

  const clauses = firstSentence.split(/[、,，]/).map((part) => part.trim()).filter(Boolean)
  let result = ""
  for (const clause of clauses) {
    const candidate = result ? `${result}、${clause}` : clause
    if (candidate.length > maxChars - 1) break
    result = candidate
  }
  if (result) return `${result.replace(/[。！？!?]$/, "")}…`
  return `${firstSentence.slice(0, Math.max(1, maxChars - 1)).trim()}…`
}
