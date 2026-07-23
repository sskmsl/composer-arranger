import type { ChordEvent } from "./project"

/**
 * 手動コード入力のテキスト形式(6.3)をパースする。
 * "F#m(add9) | E | D | Dsus2" のように "|" 区切り。
 * 長さを変えたい場合は ":拍数" を付ける(例: "F#m(add9):2 | E:6")。省略時は1小節分。
 */
export function parseChordInputText(
  text: string,
  sectionId: string,
  beatsPerBar: number,
  idPrefix: string,
): ChordEvent[] {
  const parts = text
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)

  const events: ChordEvent[] = []
  let cursor = 0
  parts.forEach((part, i) => {
    const m = /^(.*?)(?::(\d+(?:\.\d+)?))?$/.exec(part)
    const symbol = (m?.[1] ?? part).trim()
    const duration = m?.[2] ? parseFloat(m[2]) : beatsPerBar
    const slashBass = /\/([A-Ga-g][#b]?)$/.exec(symbol)
    events.push({
      id: `${idPrefix}-${i}`,
      sectionId,
      startBeat: cursor,
      durationBeats: duration,
      symbol,
      bass: slashBass ? slashBass[1] : null,
    })
    cursor += duration
  })
  return events
}

export function chordEventsToText(chords: ChordEvent[], beatsPerBar: number): string {
  return chords
    .map((c) => (c.durationBeats === beatsPerBar ? c.symbol : `${c.symbol}:${c.durationBeats}`))
    .join(" | ")
}
