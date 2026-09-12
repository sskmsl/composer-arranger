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

  const melodyStartPatterns = [
    /(?:メロディ(?:ー)?|主旋律)[^。\n]{0,24}(?:始まり|開始|登場|入り)[^。\n\d]{0,12}(\d+)\s*小節(?:目)?(?:から)?/i,
    /(\d+)\s*小節(?:目)?から[^。\n]{0,18}(?:メロディ(?:ー)?|主旋律)/i,
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
