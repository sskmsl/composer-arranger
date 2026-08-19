import { parseTimeSignature } from "@/core/section"
import { buildSmf, TICKS_PER_QUARTER, type MidiNote } from "@/midi/smf"
import type {
  AiRhythmInstrument,
  AiRhythmPatternProposal,
} from "./types"

/**
 * GM互換の音程配置。ただし外部GM Device化を避けるため、SMF上はMelodyと同じChannel 1へ出力する。
 * Logic Proで任意のSoftware Instrumentへ差し替えられる中立的な配置として使う。
 */
export const AI_DRUM_MIDI_PITCH: Record<AiRhythmInstrument, number> = {
  kick: 36,
  snare: 38,
  "closed-hat": 42,
  "open-hat": 46,
  clap: 39,
  rim: 37,
  "low-percussion": 45,
  "high-percussion": 50,
}

export interface ExportAiRhythmMidiOptions {
  title: string
  sectionName: string
  tempo: number
  timeSignature: string
  sectionLengthBars: number
  rhythmPlan: AiRhythmPatternProposal
}

function beatsToTicks(beats: number): number {
  return Math.round(beats * TICKS_PER_QUARTER)
}

function finiteInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum
}

export function rhythmNotesForPlan(
  rhythmPlan: AiRhythmPatternProposal,
  timeSignature: string,
  sectionLengthBars: number,
): MidiNote[] {
  if (!rhythmPlan.enabled || rhythmPlan.events.length === 0) return []
  const { beatsPerBar } = parseTimeSignature(timeSignature)
  const sectionBeats = Math.max(1, sectionLengthBars) * beatsPerBar
  const loopBeats = rhythmPlan.bars * beatsPerBar
  const validEvents = rhythmPlan.events.filter(
    (event) =>
      event.instrument in AI_DRUM_MIDI_PITCH &&
      finiteInRange(event.onsetBeat, 0, loopBeats - 0.0001) &&
      finiteInRange(event.durationBeats, 0.03, beatsPerBar) &&
      finiteInRange(event.velocity, 1, 127),
  )
  const notes: MidiNote[] = []
  for (let loopStart = 0; loopStart < sectionBeats; loopStart += loopBeats) {
    for (const event of validEvents) {
      const startBeat = loopStart + event.onsetBeat
      if (startBeat >= sectionBeats) continue
      notes.push({
        pitch: AI_DRUM_MIDI_PITCH[event.instrument],
        start: beatsToTicks(startBeat),
        duration: beatsToTicks(
          Math.min(event.durationBeats, sectionBeats - startBeat),
        ),
        velocity: Math.round(event.velocity),
        channel: 0,
      })
    }
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

export function exportAiRhythmMidi(
  options: ExportAiRhythmMidiOptions,
): Uint8Array {
  const timeSignature = parseTimeSignature(options.timeSignature)
  return buildSmf({
    name: `${options.title} - ${options.sectionName} AI Drum Rhythm`,
    tempoBpm: options.tempo,
    timeSignature,
    markers: [{ tick: 0, text: options.sectionName }],
    tracks: [
      {
        name: "AI Drum Rhythm",
        notes: rhythmNotesForPlan(
          options.rhythmPlan,
          options.timeSignature,
          options.sectionLengthBars,
        ),
      },
    ],
  })
}
