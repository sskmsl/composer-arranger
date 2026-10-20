/**
 * アレンジが感情を動かす仕組みの語彙。
 *
 * 音色やコードの表面ではなく、「何が聴き手の中で起きるか」(機能)を軸にする。
 * 仕組み(mechanism)は感情への働きと、実音から測れる署名を持つ。手段(means)は、その仕組みを
 * 作る具体的なアレンジの動きで、1つの仕組みに複数ある。型(パターン)は仕組みの手段の1つで、
 * 同じ仕組みを別の手段で出せるので、レシピの模倣にならずにパターンが増える。
 *
 * 根拠は参照録音5本の解析(docs/reviews/arrangement-emotion-mechanisms.md)。割合と中央値だけを持ち、
 * 旋律・音型・コード・曲名は持たない。
 */

/** 実音から測る4つの軸(感情の次元)。小節ごとの曲線にする。 */
export const EMOTIONAL_DIMENSIONS = {
  weight: "土台の重さ。低域の層(ベース・サブ・キック)がどれだけ鳴っているか",
  brightness: "明るさ・空気。高域の層(ハイハット・グラス・高いストリングス)がどれだけ鳴っているか",
  energy: "全体の強さ。鳴っている音の強弱と数",
  density: "同時に鳴っている層の数",
} as const
export type EmotionalDimension = keyof typeof EMOTIONAL_DIMENSIONS

export type EmotionalMechanismId =
  | "expectation-arrival"
  | "subtraction-contrast"
  | "closure-decay"
  | "accumulation"

export type EmotionalMeansId =
  | "bass-withheld"
  | "drumless-intro"
  | "silent-bar"
  | "low-end-break"
  | "level-fade"
  | "layer-thinning"

export interface EmotionalMechanism {
  id: EmotionalMechanismId
  label: string
  /** 聴き手の中で起きること */
  effect: string
  /** 実音で何が起きていれば、その仕組みが働いたと言えるか */
  signature: string
}

export const EMOTIONAL_MECHANISMS: readonly EmotionalMechanism[] = [
  {
    id: "expectation-arrival",
    label: "期待→到来",
    effect: "低域などの土台を溜めておき、一点でまとめて入れて、期待を解放する",
    signature: "低域が基準より8dB以上低い状態が2小節以上続き、その直後に+4dB以上の上がり幅で戻る（複数の層が同時に入るほど強い）",
  },
  {
    id: "subtraction-contrast",
    label: "引き算による対比",
    effect: "曲の途中で土台や空気を引いて、戻ったときの厚みを大きく感じさせる",
    signature: "曲の最初ではない場所で低域か高域が基準より8dB以上低い状態が2小節以上続き、その後に+4dB以上で戻る",
  },
  {
    id: "closure-decay",
    label: "終わりの余韻",
    effect: "終わりを突然切らず、強さが落ちていく余韻で閉じる",
    signature: "最後の数小節で全体の強さが小節ごとに下がり、6dB以上落ちる",
  },
  {
    id: "accumulation",
    label: "蓄積",
    effect: "層や強さを段階的に足して、次の到来への期待を育てる",
    signature: "区間の中で全体の強さが小節ごとに上がり、合計で3dB以上上がる",
  },
]

export interface EmotionalMeans {
  id: EmotionalMeansId
  mechanism: EmotionalMechanismId
  /** 画面に出す名前 */
  label: string
  /** 画面に出すひと言 */
  description: string
  /** 生成条件の意図(directive.intention)に入れる文。1文で、句点を含まない。 */
  phrase: string
  /** 自由記述から、この手段を読み取る表現。 */
  textPattern: RegExp
  /** 参照録音5本のうち、この手段が使う動きが観察できた本数(根拠の強さ)。0は手法の提案で未観察。 */
  observedIn: number
}

export const EMOTIONAL_MEANS: readonly EmotionalMeans[] = [
  {
    id: "bass-withheld",
    mechanism: "expectation-arrival",
    label: "リズムは進め、低域だけ保留して頭で入れる",
    description: "イントロはキックなどのリズムを鳴らしながら低域（ベース）を保留し、次の区間の頭で低域を一斉に入れる",
    phrase: "イントロはリズムを進めたまま低域を保留し、頭で低域が一斉に入る",
    textPattern: /(?:イントロ|導入|冒頭)[^。]*リズム[^。]*低域を保留|rhythm[^.]*bass[^.]*withheld/i,
    observedIn: 3,
  },
  {
    id: "drumless-intro",
    mechanism: "expectation-arrival",
    label: "ドラムレスのイントロ→頭で一斉に入る",
    description: "イントロはキックと低域を抜いて広く鳴らし、次の区間の頭でまとめて入れる",
    phrase: "ドラムレスで広がるイントロから、頭でキックと低域が一斉に入る",
    textPattern: /(?:イントロ|導入|冒頭)[^。]*(?:ドラムレス|キックと低域)|(?:drumless|kickless)[^.]*intro|intro[^.]*(?:drop|all at once)/i,
    observedIn: 1,
  },
  {
    id: "silent-bar",
    mechanism: "expectation-arrival",
    label: "到来の直前に1小節の静けさ",
    description: "到来する区間の直前の1小節だけ、リズムと低域を止めて間を作る",
    phrase: "到来の直前に1小節だけリズムと低域を止めて静けさを置く",
    textPattern: /直前[^。]*(?:1小節|一小節)[^。]*(?:止め|静けさ|静寂|無音)|silent.?bar/i,
    observedIn: 2,
  },
  {
    id: "low-end-break",
    mechanism: "subtraction-contrast",
    label: "低域とキックを抜く区間→戻りで大きく",
    description: "ブレイクダウン（なければブリッジ）で低域とキックを抜き、戻りの頭で一斉に大きく入れる",
    phrase: "低域とキックを抜いた区間を作り、戻りで一斉に大きく入れる",
    textPattern: /(?:低域|低音)と?キック[^。]*(?:抜いた区間|抜く区間)|(?:low.?end|bass)[^.]*kick[^.]*break/i,
    observedIn: 1,
  },
  {
    id: "level-fade",
    mechanism: "closure-decay",
    label: "フェードアウトで終える",
    description: "最後の4小節で、音量を段階的に下げ切って終わる",
    phrase: "終わりはフェードアウトで終える",
    textPattern: /フェード.?アウト|fade.?out/i,
    observedIn: 5,
  },
  {
    id: "layer-thinning",
    mechanism: "closure-decay",
    label: "層を一つずつ引いて閉じる",
    description: "最後の区間で、リズム → 動きのある層 → 弦 → 低域の順に抜けていき、パッドだけが残る",
    phrase: "終わりは層を一つずつ引いて閉じる",
    textPattern: /層を一つずつ引[^。]*閉じる|thin(?:ning)?.?out/i,
    observedIn: 2,
  },
]

export interface EmotionalMechanismRequest {
  mechanism: EmotionalMechanismId
  /** 省略すると、その仕組みの手段から曲と seed で決める */
  means?: EmotionalMeansId
}

export function meansOfMechanism(id: EmotionalMechanismId): EmotionalMeans[] {
  return EMOTIONAL_MEANS.filter((means) => means.mechanism === id)
}

export function emotionalMeansById(id: EmotionalMeansId): EmotionalMeans {
  return EMOTIONAL_MEANS.find((means) => means.id === id)!
}

/** 自由記述の意図から、含まれる手段を読み取る。型の文言をそのまま書いても同じ結果になる。 */
export function emotionalRequestsFromText(text: string): EmotionalMechanismRequest[] {
  return EMOTIONAL_MEANS.filter((means) => means.textPattern.test(text))
    .map((means) => ({ mechanism: means.mechanism, means: means.id }))
}

/**
 * 型のある指定(directive.emotionalMechanisms)と、意図の文から読み取った指定を合わせる。
 * 同じ手段は1つにまとめる。手段の指定が無い仕組みは、そのままにする(生成側が選ぶ)。
 */
export function mergeEmotionalRequests(
  typed: readonly EmotionalMechanismRequest[] | undefined,
  text: string,
): EmotionalMechanismRequest[] {
  const merged: EmotionalMechanismRequest[] = []
  for (const request of [...(typed ?? []), ...emotionalRequestsFromText(text)]) {
    const duplicate = merged.some((item) => item.mechanism === request.mechanism && item.means === request.means)
    if (!duplicate) merged.push(request)
  }
  return merged
}

/** 選んだ手段の文言を、意図の文に続ける。選ばなければ元の文のまま。 */
export function intentionWithMeans(intention: string, meansIds: readonly EmotionalMeansId[]): string {
  const phrases = EMOTIONAL_MEANS.filter((means) => meansIds.includes(means.id)).map((means) => means.phrase)
  return phrases.length ? [intention.replace(/。+$/, ""), ...phrases].join("。") : intention
}

export interface MeansRecommendation {
  means: EmotionalMeansId
  reason: string
}

/**
 * 測った仕組みの得点(0〜1)と曲の形から、足すと効きそうな手段を挙げる。
 * 参照で観察された本数が3本以上の手段だけを、おすすめにする(実験的な手段は選べるが、勧めない)。
 */
export function recommendMeans(
  scores: Partial<Record<EmotionalMechanismId, number>> | undefined,
  song: { hasIntro: boolean, endsInOutro: boolean },
): MeansRecommendation[] {
  if (!scores) return []
  const recommended: MeansRecommendation[] = []
  if ((scores["expectation-arrival"] ?? 0) < 0.5 && song.hasIntro) {
    recommended.push({ means: "bass-withheld", reason: "序盤で低域を溜めて、本編の頭で一気に入れる動きがありません" })
  }
  if ((scores["closure-decay"] ?? 0) < 0.5 && song.endsInOutro) {
    recommended.push({ means: "level-fade", reason: "終わりがフェードで閉じていません" })
  }
  return recommended.filter((item) => emotionalMeansById(item.means).observedIn >= 3)
}
