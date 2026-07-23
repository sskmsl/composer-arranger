import type { ChordEvent } from "@/core/project"
import { parseChordSymbol, commonToneCount, type ParsedChord } from "@/core/chord"

export interface HarmonicMapEntry {
  chord: ChordEvent
  parsed: ParsedChord
  /** 次のコードとの共通音数(9.1) */
  commonTonesWithNext: number
  /** このコードの解決先として自然なピッチクラス(次コードのルート/コードトーン) */
  resolutionPitchClasses: number[]
}

const FALLBACK_MAJOR = parseChordSymbol("C")!

/** 9.1 Harmonic Map: 各コード区間についてトーン/テンション/近接コード関係を計算する */
export function buildHarmonicMap(chords: ChordEvent[]): HarmonicMapEntry[] {
  const parsedList = chords.map((c) => parseChordSymbol(c.symbol, c.bass ?? undefined) ?? { ...FALLBACK_MAJOR, symbol: c.symbol })

  return chords.map((chord, i) => {
    const parsed = parsedList[i]
    const next = parsedList[i + 1] ?? parsedList[0]
    return {
      chord,
      parsed,
      commonTonesWithNext: next ? commonToneCount(parsed, next) : 0,
      resolutionPitchClasses: next ? [next.rootPc, ...next.tones.map((t) => t.pitchClass)] : [parsed.rootPc],
    }
  })
}

export function chordAtBeat(map: HarmonicMapEntry[], beat: number): HarmonicMapEntry | undefined {
  return (
    map.find((e) => beat >= e.chord.startBeat && beat < e.chord.startBeat + e.chord.durationBeats) ??
    map[map.length - 1]
  )
}
