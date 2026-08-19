import { describe, expect, it } from "vitest"
import type { AiRhythmPatternProposal } from "./types"
import {
  AI_DRUM_MIDI_PITCH,
  exportAiRhythmMidi,
  rhythmNotesForPlan,
} from "./rhythmMidi"

function plan(
  patch: Partial<AiRhythmPatternProposal> = {},
): AiRhythmPatternProposal {
  return {
    enabled: true,
    subdivision: "sixteenth",
    feel: "laid-back",
    kickPattern: "1拍目と2拍目裏",
    snarePattern: "4拍目裏",
    hatPattern: "隙間を残す",
    percussionPattern: "2小節目だけ",
    variation: "2周目の最後を抜く",
    bars: 2,
    events: [
      { instrument: "kick", onsetBeat: 0, durationBeats: 0.25, velocity: 104 },
      { instrument: "snare", onsetBeat: 3.5, durationBeats: 0.2, velocity: 82 },
      { instrument: "closed-hat", onsetBeat: 4.5, durationBeats: 0.12, velocity: 54 },
    ],
    ...patch,
  }
}

describe("AI Rhythm MIDI", () => {
  it("2小節の構造化パターンをセクション末尾まで正確に反復する", () => {
    const notes = rhythmNotesForPlan(plan(), "4/4", 5)
    expect(notes.filter((note) => note.pitch === AI_DRUM_MIDI_PITCH.kick)).toHaveLength(3)
    expect(notes.map((note) => note.start)).toContain(0)
    expect(notes.map((note) => note.start)).toContain(8 * 480)
    expect(notes.every((note) => note.channel === 0)).toBe(true)
    expect(Math.max(...notes.map((note) => note.start))).toBeLessThan(5 * 4 * 480)
  })

  it("ループ外・不正velocityのイベントをMIDIへ混入させない", () => {
    const notes = rhythmNotesForPlan(
      plan({
        bars: 1,
        events: [
          { instrument: "kick", onsetBeat: 0, durationBeats: 0.25, velocity: 100 },
          { instrument: "snare", onsetBeat: 4, durationBeats: 0.25, velocity: 100 },
          { instrument: "rim", onsetBeat: 1, durationBeats: 0.25, velocity: 0 },
        ],
      }),
      "4/4",
      1,
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]?.pitch).toBe(36)
  })

  it("Logic Proへ読み込めるSMF Type 1を書き出す", () => {
    const bytes = exportAiRhythmMidi({
      title: "Test",
      sectionName: "Intro",
      tempo: 96,
      timeSignature: "4/4",
      sectionLengthBars: 4,
      rhythmPlan: plan(),
    })
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("MThd")
    expect(bytes.length).toBeGreaterThan(100)
  })

  it("Orchestrationのpulse演奏意図をDrum MIDIにも適用する", () => {
    const original = rhythmNotesForPlan(plan(), "4/4", 2)
    const performed = rhythmNotesForPlan(plan(), "4/4", 2, {
      role: "pulse-foundation",
      velocityRange: [44, 66],
      articulation: "detached",
      timing: "slightly-behind",
    })
    expect(performed.map((note) => note.pitch)).toEqual(original.map((note) => note.pitch))
    expect(performed.every((note) => note.velocity >= 44 && note.velocity <= 66)).toBe(true)
    expect(performed[0].start).toBe(0)
    expect(performed[1].start).toBeGreaterThan(original[1].start)
  })
})
