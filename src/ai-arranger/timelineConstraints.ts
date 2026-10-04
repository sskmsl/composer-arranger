import type {
  ArrangementBarRange,
  ArrangementGenerationDirective,
  ArrangementTimelineConstraints,
} from "@/core/arrangementGeneration"
import { SECTION_ROLE_LABELS, type Section } from "@/core/section"

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
  sections: readonly Section[] = [],
): ArrangementTimelineConstraints {
  const text = asciiDigits(source)
  const fullSilenceRanges: ArrangementBarRange[] = []
  const melodySilenceRanges: ArrangementBarRange[] = []
  const rangeList = String.raw`\d+(?:\s*[〜～~\-–—]\s*\d+)?(?:\s*(?:\/|／|、|,|・)\s*\d+(?:\s*[〜～~\-–—]\s*\d+)?)*`
  const clauseAt = (index: number) => {
    const start = Math.max(text.lastIndexOf("。", index), text.lastIndexOf("\n", index), text.lastIndexOf(";", index)) + 1
    const ends = [text.indexOf("。", index), text.indexOf("\n", index), text.indexOf(";", index)].filter((value) => value >= 0)
    return text.slice(start, ends.length > 0 ? Math.min(...ends) : text.length)
  }
  const isRelativeCountClause = (value: string) => /(?:最初|冒頭|曲の始まり|イントロ|ラスト|最後|終わり)(?:の)?\s*\d+\s*小節/i.test(value)

  const silenceKind = (clause: string) => {
    const melody = /メロディ(?:ー)?|主旋律/i.test(clause)
    const full = /完全(?:に)?無音|何も鳴らさ|全(?:パート|トラック|楽器)[^。\n]{0,16}(?:休|止|消)|音を(?:全部|すべて)?[^。\n]{0,8}(?:消|抜|止)|全休止|一瞬(?:止|休)/i.test(clause)
    const melodyOnly = melody && /なし|無音|鳴らさ|休ませ|入れない|消す|抜く|止める|伴奏だけ/i.test(clause)
    return { full, melody: melodyOnly || /伴奏だけ/i.test(clause) }
  }

  for (const clause of text.split(/[。\n；;]/).map((value) => value.trim()).filter(Boolean)) {
    const kind = silenceKind(clause)
    const first = clause.match(/(?:最初|冒頭|曲の始まり|イントロ)(?:の)?\s*(\d+)\s*小節/i)
    if (first && (kind.full || kind.melody)) {
      const endBar = clampBar(Number(first[1]), totalBars)
      ;(kind.full ? fullSilenceRanges : melodySilenceRanges).push({ startBar: 1, endBar })
      continue
    }
    const last = clause.match(/(?:ラスト|最後|終わり)(?:の)?\s*(\d+)\s*小節/i)
    if (last && totalBars && (kind.full || kind.melody)) {
      const count = Math.max(1, Math.round(Number(last[1])))
      ;(kind.full ? fullSilenceRanges : melodySilenceRanges).push({
        startBar: Math.max(1, totalBars - count + 1),
        endBar: totalBars,
      })
      continue
    }
    const named = [...sections]
      .sort((left, right) => Math.max(right.name.length, SECTION_ROLE_LABELS[right.role].length) - Math.max(left.name.length, SECTION_ROLE_LABELS[left.role].length))
      .find((section) => [section.name, SECTION_ROLE_LABELS[section.role]].some((label) => label && clause.includes(label)))
    if (named) {
      const before = /(?:直前|前)[^。\n]{0,10}(?:全休止|一瞬(?:止|休)|何も鳴らさ)/i.test(clause)
      if (before && named.startBar > 1) {
        fullSilenceRanges.push({ startBar: named.startBar - 1, endBar: named.startBar - 1 })
        continue
      }
      const countMatch = clause.match(/(\d+)\s*小節/i)
      if (countMatch && (kind.full || kind.melody)) {
        const endBar = Math.min(named.startBar + named.lengthBars - 1, named.startBar + Number(countMatch[1]) - 1)
        ;(kind.full ? fullSilenceRanges : melodySilenceRanges).push({ startBar: named.startBar, endBar })
        continue
      }
    }
  }

  for (const match of text.matchAll(new RegExp(`(${rangeList})\\s*小節(?:目)?(?:\\s*(?:は|を|で|に))?\\s*(?:完全(?:に)?)?\\s*(?:無音|鳴らさない|音を出さない)`, "gi"))) {
    if (isRelativeCountClause(clauseAt(match.index ?? 0))) continue
    fullSilenceRanges.push(...rangesFromList(match[1], totalBars))
  }
  for (const match of text.matchAll(new RegExp(`(${rangeList})\\s*小節(?:目)?[^。\\n]{0,18}(?:メロディ(?:ー)?|主旋律)[^。\\n]{0,10}(?:なし|無音|鳴らさない|入れない)`, "gi"))) {
    if (isRelativeCountClause(clauseAt(match.index ?? 0))) continue
    melodySilenceRanges.push(...rangesFromList(match[1], totalBars))
  }

  // 同じ指示でも表現が変わるため、文単位でも「全体の無音」と「主旋律だけの休み」を拾う。
  for (const clause of text.split(/[。\n；;]/).map((value) => value.trim()).filter(Boolean)) {
    if (isRelativeCountClause(clause)) continue
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
  sections: readonly Section[] = [],
): ArrangementGenerationDirective {
  return {
    ...directive,
    timelineConstraints: parseArrangementTimelineConstraints(source, totalBars, sections),
  }
}
