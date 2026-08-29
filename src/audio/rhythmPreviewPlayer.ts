import type { PerformanceExecutionPlan } from "@/core/performanceExecution"
import { TICKS_PER_QUARTER } from "@/midi/smf"
import type { AiRhythmPatternProposal } from "@/ai-arranger/types"
import { rhythmNotesForPlan } from "@/ai-arranger/rhythmMidi"

export type RhythmPreviewVoice = "kick" | "snare" | "hat" | "percussion"

/** MIDI書き出しと同じノートを、中立的な簡易ドラム音へ割り当てる。 */
export function rhythmPreviewVoiceForPitch(pitch: number): RhythmPreviewVoice {
  if (pitch === 36) return "kick"
  if (pitch === 37 || pitch === 38 || pitch === 39) return "snare"
  if (pitch === 42 || pitch === 46) return "hat"
  return "percussion"
}

export interface RhythmPreviewOptions {
  bpm: number
  timeSignature: string
  rhythmPlan: AiRhythmPatternProposal
  performancePlan?: PerformanceExecutionPlan
  onEnded?: () => void
}

class RhythmPreviewPlayer {
  private context: AudioContext | null = null
  private endTimer: number | null = null

  play(options: RhythmPreviewOptions): boolean {
    this.stop()
    const notes = rhythmNotesForPlan(
      options.rhythmPlan,
      options.timeSignature,
      options.rhythmPlan.bars,
      options.performancePlan,
    )
    if (notes.length === 0) return false

    const context = new AudioContext()
    this.context = context
    void context.resume()
    const master = context.createGain()
    master.gain.value = 0.72
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.ratio.value = 5
    compressor.connect(master)
    master.connect(context.destination)

    const secondsPerBeat = 60 / Math.max(30, options.bpm)
    const startTime = context.currentTime + 0.04
    let endSeconds = 0
    for (const note of notes) {
      const onsetSeconds = (note.start / TICKS_PER_QUARTER) * secondsPerBeat
      const durationSeconds = Math.max(
        0.04,
        (note.duration / TICKS_PER_QUARTER) * secondsPerBeat,
      )
      const when = startTime + onsetSeconds
      const velocity = Math.max(0.15, Math.min(1, note.velocity / 127))
      this.scheduleVoice(
        context,
        compressor,
        rhythmPreviewVoiceForPitch(note.pitch),
        when,
        durationSeconds,
        velocity,
      )
      endSeconds = Math.max(endSeconds, onsetSeconds + durationSeconds)
    }

    this.endTimer = window.setTimeout(() => {
      this.dispose()
      options.onEnded?.()
    }, (endSeconds + 0.18) * 1000)
    return true
  }

  isPlaying(): boolean {
    return this.context !== null
  }

  stop(): void {
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.dispose()
  }

  private scheduleVoice(
    context: AudioContext,
    destination: AudioNode,
    voice: RhythmPreviewVoice,
    when: number,
    duration: number,
    velocity: number,
  ): void {
    if (voice === "kick") {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = "sine"
      oscillator.frequency.setValueAtTime(115, when)
      oscillator.frequency.exponentialRampToValueAtTime(44, when + 0.12)
      gain.gain.setValueAtTime(0.75 * velocity, when)
      gain.gain.exponentialRampToValueAtTime(0.001, when + Math.min(0.32, duration + 0.16))
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start(when)
      oscillator.stop(when + Math.min(0.36, duration + 0.2))
      return
    }

    if (voice === "percussion") {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = "triangle"
      oscillator.frequency.setValueAtTime(230, when)
      oscillator.frequency.exponentialRampToValueAtTime(130, when + 0.1)
      gain.gain.setValueAtTime(0.26 * velocity, when)
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.16)
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start(when)
      oscillator.stop(when + 0.18)
      return
    }

    const noiseLength = voice === "hat" ? 0.08 : 0.2
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * noiseLength),
      context.sampleRate,
    )
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1
    }
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = voice === "hat" ? "highpass" : "bandpass"
    filter.frequency.value = voice === "hat" ? 6500 : 1700
    filter.Q.value = voice === "hat" ? 0.7 : 1.1
    gain.gain.setValueAtTime((voice === "hat" ? 0.2 : 0.42) * velocity, when)
    gain.gain.exponentialRampToValueAtTime(0.001, when + noiseLength)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(destination)
    source.start(when)
    source.stop(when + noiseLength + 0.01)
  }

  private dispose(): void {
    const context = this.context
    this.context = null
    if (context) void context.close()
  }
}

export const rhythmPreviewPlayer = new RhythmPreviewPlayer()
