import type { MelodyNote } from "./melody"
import type {
  ArrangementBarRange,
  ArrangementTimelineConstraints,
  GeneratedArrangementTrack,
} from "./arrangementGeneration"

interface TimedEvent {
  startBeat: number
  durationBeats: number
  id?: string
}

/**
 * セクション内の相対時刻で保持されたイベントへ、全曲の小節指定を適用する。
 * 試聴やセクション単位のMIDI書き出しでも、全曲生成と同じ無音指定を使うための入口。
 */
export function applyArrangementTimelineToSectionEvents<T extends TimedEvent>(
  events: readonly T[],
  constraints: ArrangementTimelineConstraints | undefined,
  beatsPerBar: number,
  sectionStartBar: number,
  includeMelodyRules: boolean,
): T[] {
  if (!constraints) return events.map((event) => ({ ...event }))
  const sectionStartBeat = (Math.max(1, sectionStartBar) - 1) * beatsPerBar
  const startRange: ArrangementBarRange[] = includeMelodyRules
    && constraints.melodyStartBar
    && constraints.melodyStartBar > 1
    ? [{ startBar: 1, endBar: constraints.melodyStartBar - 1 }]
    : []
  const ranges = [
    ...constraints.fullSilenceRanges,
    ...(includeMelodyRules ? constraints.melodySilenceRanges : []),
    ...startRange,
  ]
  const absoluteEvents = events.map((event) => ({
    ...event,
    startBeat: event.startBeat + sectionStartBeat,
  }))
  return applySilenceRanges(absoluteEvents, ranges, beatsPerBar).map((event) => ({
    ...event,
    startBeat: event.startBeat - sectionStartBeat,
  })) as T[]
}

function normalizedRanges(
  ranges: readonly ArrangementBarRange[],
  beatsPerBar: number,
): Array<{ startBeat: number; endBeat: number }> {
  return ranges
    .map((range) => ({
      startBeat: (Math.max(1, range.startBar) - 1) * beatsPerBar,
      endBeat: Math.max(range.startBar, range.endBar) * beatsPerBar,
    }))
    .sort((left, right) => left.startBeat - right.startBeat)
}

/**
 * 無音区間を跨ぐ長いノート／コードも確実に止める。
 * 区間後の音は再開するため、保存中の元ノートは変更しない。
 */
export function applySilenceRanges<T extends TimedEvent>(
  events: readonly T[],
  ranges: readonly ArrangementBarRange[],
  beatsPerBar: number,
): T[] {
  const beatRanges = normalizedRanges(ranges, beatsPerBar)
  if (beatRanges.length === 0) return events.map((event) => ({ ...event }))
  return events.flatMap((event) => {
    let fragments: Array<{ startBeat: number; endBeat: number }> = [{
      startBeat: event.startBeat,
      endBeat: event.startBeat + event.durationBeats,
    }]
    for (const silence of beatRanges) {
      fragments = fragments.flatMap((fragment) => {
        if (fragment.endBeat <= silence.startBeat || fragment.startBeat >= silence.endBeat) {
          return [fragment]
        }
        const next: Array<{ startBeat: number; endBeat: number }> = []
        if (fragment.startBeat < silence.startBeat) {
          next.push({ startBeat: fragment.startBeat, endBeat: silence.startBeat })
        }
        if (fragment.endBeat > silence.endBeat) {
          next.push({ startBeat: silence.endBeat, endBeat: fragment.endBeat })
        }
        return next
      })
    }
    return fragments
      .filter((fragment) => fragment.endBeat - fragment.startBeat >= 0.01)
      .map((fragment, fragmentIndex) => ({
        ...event,
        ...(event.id && fragmentIndex > 0 ? { id: `${event.id}:after-silence:${fragmentIndex}` } : {}),
        startBeat: fragment.startBeat,
        durationBeats: fragment.endBeat - fragment.startBeat,
      }))
  })
}

export function applyArrangementTimelineToMelody(
  notes: readonly MelodyNote[],
  constraints: ArrangementTimelineConstraints | undefined,
  beatsPerBar: number,
): MelodyNote[] {
  if (!constraints) return notes.map((note) => ({ ...note }))
  const startRange: ArrangementBarRange[] = constraints.melodyStartBar && constraints.melodyStartBar > 1
    ? [{ startBar: 1, endBar: constraints.melodyStartBar - 1 }]
    : []
  return applySilenceRanges(
    notes,
    [
      ...constraints.fullSilenceRanges,
      ...constraints.melodySilenceRanges,
      ...startRange,
    ],
    beatsPerBar,
  )
}

export function applyArrangementTimelineToTracks(
  tracks: readonly GeneratedArrangementTrack[],
  constraints: ArrangementTimelineConstraints | undefined,
  beatsPerBar: number,
): GeneratedArrangementTrack[] {
  if (!constraints || constraints.fullSilenceRanges.length === 0) {
    return tracks.map((track) => ({ ...track, notes: track.notes.map((note) => ({ ...note })) }))
  }
  return tracks.map((track) => ({
    ...track,
    notes: applySilenceRanges(track.notes, constraints.fullSilenceRanges, beatsPerBar),
  }))
}
