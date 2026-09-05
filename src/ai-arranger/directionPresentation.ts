import type { AiArrangementIntent } from "./types"

export interface AudibleDirectionPresentation {
  title: string
  summary: string
  changes: [string, string, string]
}

const DENSITY_TEXT = {
  sparse: "音数を絞り、主旋律の周りに余白を残す",
  balanced: "必要な場所だけ音を足し、主旋律を前に残す",
  active: "動きを増やし、曲の前進感をはっきりさせる",
} as const

const REGISTER_TEXT = {
  low: "低い音域を使い、重さと土台を加える",
  middle: "中音域を使い、主旋律とぶつからない隙間を埋める",
  high: "高い音域を要所だけ使い、明るさや緊張を加える",
} as const

const RHYTHM_TEXT = {
  spacious: "長い音と休みを使い、ゆっくり広がる",
  flowing: "音を滑らかにつなぎ、流れを止めない",
  syncopated: "拍の表から少しずらし、揺れと推進力を作る",
  pulsed: "短い反復音で、一定の歩みを作る",
  fragmented: "短い音を断続的に置き、切迫感を作る",
} as const

const SILENCE_TEXT = {
  minimal: "休みは少なめにし、動きを途切れさせない",
  breathing: "主旋律の区切りでは一緒に休み、呼吸を残す",
  structural: "曲の節目ではあえて鳴らさず、次の始まりを目立たせる",
} as const

const PRESENTATION_BY_GENERATOR: Record<
  AiArrangementIntent["generator"],
  Pick<AudibleDirectionPresentation, "title" | "summary">
> = {
  melody: {
    title: "主旋律の表情を変える",
    summary: "旋律の骨格を保ちながら、音の長さと間の取り方を変えます。",
  },
  phrase: {
    title: "主旋律の隙間に短い返答を置く",
    summary: "歌や主旋律が休む場所だけに、短いフレーズを加えます。",
  },
  signature: {
    title: "短い目印で曲の顔を作る",
    summary: "覚えやすい短い音型を要所だけに置き、曲を識別しやすくします。",
  },
  counter: {
    title: "主旋律の後ろに第二の旋律を置く",
    summary: "主旋律を邪魔しない音域と休符を選び、別の旋律で応答します。",
  },
  decoration: {
    title: "要所だけに印象的な一音を足す",
    summary: "曲の節目や主旋律の休符に、ベルや短い上昇音を加えます。",
  },
  accompaniment: {
    title: "伴奏の反復で曲を前へ進める",
    summary: "コードを鳴らし続けず、低音や短い反復で一定の歩みを作ります。",
  },
  rhythm: {
    title: "ドラムの位置と休符で流れを変える",
    summary: "音数ではなく、キックやスネアを置く場所の違いで推進力を作ります。",
  },
  none: {
    title: "音を足さず、余白を残す",
    summary: "新しい音を加えず、次のセクションが始まる瞬間を目立たせます。",
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
      `${RHYTHM_TEXT[intent.rhythmCharacter]}。${SILENCE_TEXT[intent.silenceStrategy]}`,
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
