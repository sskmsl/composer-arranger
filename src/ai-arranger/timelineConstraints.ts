import type {
  ArrangementBarRange,
  ArrangementGenerationDirective,
  ArrangementTimelineConstraints,
} from "@/core/arrangementGeneration"

function asciiDigits(value: string): string {
  return value.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
}

function clampBar(value: number, totalBars?: number): number {
  const rounded = Math.max(1, Math.round(value))
  return totalBars ? Math.min(totalBars, rounded) : rounded
}

function mergeRanges(ranges: ArrangementBarRange[]): ArrangementBarRange[] {
  const sorted = [...ranges].sort((left, right) => left.startBar - right.startBar || left.endBar - right.endBar)
  const result: ArrangementBarRange[] = []
  for (const range of sorted) {
    const previous = result[result.length - 1]
    if (previous && range.startBar <= previous.endBar + 1) previous.endBar = Math.max(previous.endBar, range.endBar)
    else result.push({ ...range })
  }
  return result
}

function rangesFromList(value: string, totalBars?: number): ArrangementBarRange[] {
  const normalized = asciiDigits(value)
  const ranges: ArrangementBarRange[] = []
  const matcher = /(\d+)\s*(?:[〜～~\-–—]\s*(\d+))?/g
  for (const match of normalized.matchAll(matcher)) {
    const first = clampBar(Number(match[1]), totalBars)
    const second = clampBar(Number(match[2] ?? match[1]), totalBars)
    ranges.push({ startBar: Math.min(first, second), endBar: Math.max(first, second) })
  }
  return mergeRanges(ranges)
}

function rangesFromClause(value: string, totalBars?: number): ArrangementBarRange[] {
  const normalized = asciiDigits(value).replace(
    /(\d+)\s*小節(?:目)?\s*から\s*(\d+)\s*小節(?:目)?\s*まで/g,
    "$1〜$2小節",
  )
  const rangeList = String.raw`\d+(?:\s*[〜～~\-–—]\s*\d+)?(?:\s*(?:\/|／|、|,|・)\s*\d+(?:\s*[〜～~\-–—]\s*\d+)?)*`
  const matches = [...normalized.matchAll(new RegExp(`(${rangeList})\\s*小節(?:目)?`, "gi"))]
  return mergeRanges(matches.flatMap((match) => rangesFromList(match[1], totalBars)))
}

/** 日本語の制作指示から、実音へ必ず反映する小節位置指定だけを決定論的に抽出する。 */
export function parseArrangementTimelineConstraints(
  source: string,
  totalBars?: number,
): ArrangementTimelineConstraints {
  const text = asciiDigits(source)
  const fullSilenceRanges: ArrangementBarRange[] = []
  const melodySilenceRanges: ArrangementBarRange[] = []
  const rangeList = String.raw`\d+(?:\s*[〜～~\-–—]\s*\d+)?(?:\s*(?:\/|／|、|,|・)\s*\d+(?:\s*[〜～~\-–—]\s*\d+)?)*`

  for (const match of text.matchAll(new RegExp(`(${rangeList})\\s*小節(?:目)?(?:\\s*(?:は|を|で|に))?\\s*(?:完全(?:に)?)?\\s*(?:無音|鳴らさない|音を出さない)`, "gi"))) {
    fullSilenceRanges.push(...rangesFromList(match[1], totalBars))
  }
  for (const match of text.matchAll(new RegExp(`(${rangeList})\\s*小節(?:目)?[^。\\n]{0,18}(?:メロディ(?:ー)?|主旋律)[^。\\n]{0,10}(?:なし|無音|鳴らさない|入れない)`, "gi"))) {
    melodySilenceRanges.push(...rangesFromList(match[1], totalBars))
  }

  // 同じ指示でも表現が変わるため、文単位でも「全体の無音」と「主旋律だけの休み」を拾う。
  for (const clause of text.split(/[。\n；;]/).map((value) => value.trim()).filter(Boolean)) {
    const ranges = rangesFromClause(clause, totalBars)
    if (ranges.length === 0) continue
    const mentionsMelody = /メロディ(?:ー)?|主旋律/i.test(clause)
    const completeSilence = /完全(?:に)?無音|何も鳴らさ|全(?:パート|トラック|楽器)[^。\n]{0,16}(?:休|止|消)|音を(?:全部|すべて)?[^。\n]{0,8}(?:消|抜|止)|全休止/i.test(clause)
    const melodySilence = mentionsMelody && /なし|無音|鳴らさ|休ませ|入れない|消す|抜く|止める/i.test(clause)
    if (completeSilence) fullSilenceRanges.push(...ranges)
    else if (melodySilence) melodySilenceRanges.push(...ranges)
  }

  const melodyStartPatterns = [
    /(?:メロディ(?:ー)?|主旋律)[^。\n]{0,24}(?:始まり|開始|登場|入り)[^。\n\d]{0,12}(\d+)\s*小節(?:目)?(?:から)?/i,
    /(?:メロディ(?:ー)?|主旋律)[^。\n\d]{0,20}(\d+)\s*小節(?:目)?(?:から|で)(?:始|入|鳴)?/i,
    /(\d+)\s*小節(?:目)?から[^。\n]{0,18}(?:メロディ(?:ー)?|主旋律)/i,
    /(\d+)\s*小節(?:目)?(?:から|で)[^。\n]{0,18}(?:メロディ(?:ー)?|主旋律)[^。\n]{0,12}(?:始|入|鳴)/i,
  ]
  const melodyStartMatch = melodyStartPatterns.map((pattern) => text.match(pattern)).find(Boolean)
  const melodyStartBar = melodyStartMatch
    ? clampBar(Number(melodyStartMatch[1]), totalBars)
    : undefined

  return {
    preserveMelody: true,
    fullSilenceRanges: mergeRanges(fullSilenceRanges),
    melodySilenceRanges: mergeRanges(melodySilenceRanges),
    ...(melodyStartBar ? { melodyStartBar } : {}),
  }
}

export function directiveWithTimelineConstraints(
  directive: ArrangementGenerationDirective,
  source: string,
  totalBars?: number,
): ArrangementGenerationDirective {
  return {
    ...directive,
    timelineConstraints: parseArrangementTimelineConstraints(source, totalBars),
  }
}
