/**
 * 全曲アレンジの「展開の型」。方向(余白を生かす・壮大に盛り上げる…)とは別に、曲の流れの
 * 一場面だけを決める。選んだ型の文言が、方向の意図の文に続けて生成へ渡る。
 * 生成側(arrangementGenerator)は、生成条件の directive.intention にあるこの文言を読む。
 * 型の文言は brief(曲全体の相談文)には入れない。brief は音の指示として別に解釈され、
 * ドラムやイントロの語で全曲の入退場の計画が止まる。
 */
export type ArrangementPatternId = "drumless-intro-drop" | "low-end-break" | "fade-out-ending"

export interface ArrangementPattern {
  id: ArrangementPatternId
  /** 画面に出す名前 */
  label: string
  /** 画面に出すひと言 */
  description: string
  /** 生成へ渡す意図の文。1文で、句点を含まない */
  phrase: string
}

export const ARRANGEMENT_PATTERNS: readonly ArrangementPattern[] = [
  {
    id: "drumless-intro-drop",
    label: "ドラムレスのイントロ→頭で一斉に入る",
    description: "イントロはキックと低域を抜いて広く鳴らし、次の区間の頭でまとめて入れる",
    phrase: "ドラムレスで広がるイントロから、頭でキックと低域が一斉に入る",
  },
  {
    id: "low-end-break",
    label: "低域とキックを抜く区間→戻りで大きく",
    description: "ブレイクダウン（なければブリッジ）で低域とキックを抜き、戻りの頭で一斉に大きく入れる",
    phrase: "低域とキックを抜いた区間を作り、戻りで一斉に大きく入れる",
  },
  {
    id: "fade-out-ending",
    label: "フェードアウトで終える",
    description: "最後の4小節で、音量を段階的に下げ切って終わる",
    phrase: "終わりはフェードアウトで終える",
  },
]

/** 選んだ型の文言を、方向の意図の文に続ける。選ばなければ元の文のまま。 */
export function intentionWithPatterns(intention: string, patternIds: readonly ArrangementPatternId[]): string {
  const phrases = ARRANGEMENT_PATTERNS.filter((pattern) => patternIds.includes(pattern.id)).map((pattern) => pattern.phrase)
  return phrases.length ? [intention.replace(/。+$/, ""), ...phrases].join("。") : intention
}
