import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import { parseChordSymbol } from "@/core/chord"
import { midiToFreq } from "@/core/note"
import { voiceChord } from "./chordVoicing"

export type PreviewMode = "melody-only" | "chords-melody" | "chords-only"

export interface PlayOptions {
  bpm: number
  chords: ChordEvent[]
  melody: MelodyNote[]
  mode: PreviewMode
  loop?: boolean
  /** 比較試聴用。startBeatは今回の再生開始位置、rangeは共通ループ範囲。 */
  startBeat?: number
  range?: { startBeat: number; endBeat: number }
  onEnded?: () => void
}

export function resolveComparisonSwitchBeat(currentBeat: number, rangeStart: number, rangeEnd: number): number {
  if (!Number.isFinite(currentBeat)) return rangeStart
  if (currentBeat < rangeStart || currentBeat >= rangeEnd) return rangeStart
  return currentBeat
}

/**
 * Web Audio APIによる簡易プレビュー再生。3.8「判断の主軸は音」を実質化するための
 * 確認用シンセ(最終音色はLogic Proで決定する、12章)。
 */
class PreviewPlayer {
  private ctx: AudioContext | null = null
  private endTimer: number | null = null
  private startTime = 0
  private secondsPerBeat = 0.5
  private playbackStartBeat = 0

  play(opts: PlayOptions): void {
    this.stop()
    const ctx = new AudioContext()
    this.ctx = ctx
    void ctx.resume()

    const master = ctx.createGain()
    master.gain.value = 0.85
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.ratio.value = 6
    compressor.connect(master)
    master.connect(ctx.destination)

    this.secondsPerBeat = 60 / opts.bpm
    const start = ctx.currentTime + 0.05
    this.startTime = start
    const rangeStart = opts.range?.startBeat ?? 0
    const rangeEnd = opts.range?.endBeat ?? Number.POSITIVE_INFINITY
    const playbackStart = Math.max(rangeStart, opts.startBeat ?? rangeStart)
    this.playbackStartBeat = playbackStart

    let totalBeats = 0

    if (opts.mode !== "melody-only") {
      for (const c of opts.chords) {
        const parsed = parseChordSymbol(c.symbol, c.bass ?? undefined)
        if (!parsed) continue
        const voicing = voiceChord(parsed)
        const eventEnd = c.startBeat + c.durationBeats
        if (eventEnd <= playbackStart || c.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(c.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + (clippedStart - playbackStart) * this.secondsPerBeat
        const dur = (clippedEnd - clippedStart) * this.secondsPerBeat
        this.schedulePad(ctx, compressor, voicing.bassMidi, voicing.upperMidi, t0, dur)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (opts.mode !== "chords-only") {
      for (const n of opts.melody) {
        const eventEnd = n.startBeat + n.durationBeats
        if (eventEnd <= playbackStart || n.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(n.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + (clippedStart - playbackStart) * this.secondsPerBeat
        const dur = (clippedEnd - clippedStart) * this.secondsPerBeat
        this.scheduleLead(ctx, compressor, n.pitch, n.velocity, t0, dur)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (Number.isFinite(rangeEnd)) totalBeats = Math.max(0, rangeEnd - playbackStart)
    const totalSeconds = totalBeats * this.secondsPerBeat + 0.15
    this.endTimer = window.setTimeout(() => {
      if (opts.loop) {
        this.play({ ...opts, startBeat: rangeStart })
      } else {
        this.dispose()
        opts.onEnded?.()
      }
    }, totalSeconds * 1000)
  }

  getElapsedBeats(): number {
    if (!this.ctx) return 0
    return (this.ctx.currentTime - this.startTime) / this.secondsPerBeat
  }

  getCurrentBeat(): number {
    return this.playbackStartBeat + Math.max(0, this.getElapsedBeats())
  }

  /** 再生ヘッドを維持したまま、比較対象のイベントだけを置き換える。 */
  switch(opts: PlayOptions): void {
    const currentBeat = this.getCurrentBeat()
    const rangeStart = opts.range?.startBeat ?? 0
    const rangeEnd = opts.range?.endBeat ?? Number.POSITIVE_INFINITY
    const nextBeat = resolveComparisonSwitchBeat(currentBeat, rangeStart, rangeEnd)
    this.play({ ...opts, startBeat: nextBeat })
  }

  isPlaying(): boolean {
    return this.ctx !== null
  }

  stop(): void {
    if (this.endTimer != null) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.dispose()
  }

  private schedulePad(ctx: AudioContext, dest: AudioNode, bassMidi: number, upperMidi: number[], t0: number, dur: number): void {
    const attack = 0.05
    const release = 0.5
    const holdEnd = t0 + dur - 0.08

    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(650, t0)
    filter.frequency.linearRampToValueAtTime(1200, t0 + dur * 0.5)
    filter.frequency.linearRampToValueAtTime(750, holdEnd)
    filter.Q.value = 0.7
    filter.connect(dest)

    for (const midi of upperMidi) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator()
        osc.type = "sawtooth"
        osc.frequency.value = midiToFreq(midi)
        osc.detune.value = detune
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, t0)
        gain.gain.linearRampToValueAtTime(0.045, t0 + attack)
        gain.gain.setValueAtTime(0.045, holdEnd)
        gain.gain.linearRampToValueAtTime(0, holdEnd + release)
        osc.connect(gain)
        gain.connect(filter)
        osc.start(t0)
        osc.stop(holdEnd + release + 0.05)
      }
    }

    const bassOsc = ctx.createOscillator()
    bassOsc.type = "sine"
    bassOsc.frequency.value = midiToFreq(bassMidi)
    const bassGain = ctx.createGain()
    bassGain.gain.setValueAtTime(0, t0)
    bassGain.gain.linearRampToValueAtTime(0.2, t0 + attack)
    bassGain.gain.setValueAtTime(0.2, holdEnd)
    bassGain.gain.linearRampToValueAtTime(0, holdEnd + release)
    bassOsc.connect(bassGain)
    bassGain.connect(dest)
    bassOsc.start(t0)
    bassOsc.stop(holdEnd + release + 0.05)
  }

  /**
   * ピアノに近いリード音。ピアノらしさの要点は
   *   ①非常に速いアタック ②持続せず打鍵直後から連続的に減衰する余韻
   *   ③打鍵直後だけ倍音が明るく、その後こもる(ローパスが閉じる)
   *   ④低音ほど長く鳴る
   * を Web Audio の合成で近似する(最終音色はLogic Proで決める前提の確認用、12章)。
   */
  private scheduleLead(ctx: AudioContext, dest: AudioNode, pitch: number, velocity: number, t0: number, dur: number): void {
    const freq = midiToFreq(pitch)
    const vel = Math.min(1, Math.max(0.15, velocity / 127))
    const attack = 0.004
    const peak = 0.3 * (0.45 + 0.55 * vel)

    // 低音ほど長く、強打ほど少し長く残す減衰時間。音価が短ければその長さで切る。
    const naturalRing = Math.min(3.4, 3.2 - (pitch - 60) * 0.05) * (0.75 + 0.25 * vel)
    const ring = Math.max(0.28, Math.min(naturalRing, dur * 0.98 + 0.25))
    const holdEnd = t0 + ring
    const release = 0.09

    // 弦の非整数倍音を含むピアノ寄りの倍音構成(基音+上倍音を漸減)
    const wave = ctx.createPeriodicWave(
      new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]),
      new Float32Array([0, 1, 0.62, 0.4, 0.26, 0.17, 0.11, 0.07, 0.04]),
      { disableNormalization: false },
    )
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(wave)
    osc.frequency.value = freq

    // 打鍵直後だけ明るく、その後こもる = ハンマー打弦後の音色変化
    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    const brightStart = Math.min(11000, freq * (5 + 6 * vel))
    const brightEnd = Math.min(4200, Math.max(freq * 2.2, 900))
    filter.frequency.setValueAtTime(brightStart, t0)
    filter.frequency.exponentialRampToValueAtTime(brightEnd, t0 + Math.min(0.6, ring))
    filter.Q.value = 0.6

    // 打鍵→連続減衰のエンベロープ(持続プラトーを持たない)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0008, peak * 0.06), holdEnd)
    gain.gain.exponentialRampToValueAtTime(0.0001, holdEnd + release)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(dest)
    osc.start(t0)
    osc.stop(holdEnd + release + 0.05)
  }

  private dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
    }
  }
}

export const previewPlayer = new PreviewPlayer()
