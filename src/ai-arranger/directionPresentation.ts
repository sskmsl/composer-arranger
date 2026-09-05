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

/** APIが返した制作メモを詳細表示する場合も、頻出する専門表現を聴感の言葉へ直す。 */
export function plainDirectionText(value: string): string {
  return value
    .replace(/最後のパルスを抜いて\s*1拍目を強く感じさせる[。.]?/g, "小節の最後を休ませ、次の小節の始まりをはっきり聴かせる。")
    .replace(/パルス/g, "短く繰り返す伴奏")
    .replace(/シンコペーション/g, "拍の表から少しずらしたリズム")
    .replace(/レジスター/g, "音域")
    .replace(/モチーフ/g, "短い音型")
    .replace(/アタック/g, "音の立ち上がり")
    .replace(/構造点/g, "曲の節目")
}
