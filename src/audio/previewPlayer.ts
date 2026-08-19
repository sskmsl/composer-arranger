import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import { parseChordSymbol } from "@/core/chord"
import { midiToFreq } from "@/core/note"
import { voiceChord } from "./chordVoicing"

export type PreviewMode =
  | "melody-only"
  | "chords-melody"
  | "chords-only"
  | "accompaniment-only"
  | "reactive-only"
  | "chords-reactive"
  | "melody-reactive"
  | "chords-melody-reactive"
  | "active-context-reactive"

export interface PreviewLayers {
  chords: boolean
  melody: boolean
  accompaniment: boolean
  reactive: boolean
}

export type LeadPreviewStyle =
  | "neutral"
  | "atmospheric"
  | "obsessive"
  | "kinetic"

export function previewTailSeconds(style: LeadPreviewStyle): number {
  return style === "atmospheric" ? 1.15 : 0.15
}

/** 再生モードを実際に鳴らすレイヤーへ一元変換する。 */
export function previewLayersForMode(mode: PreviewMode): PreviewLayers {
  return {
    chords:
      mode === "chords-melody" ||
      mode === "chords-only" ||
      mode === "chords-reactive" ||
      mode === "chords-melody-reactive" ||
      mode === "active-context-reactive",
    melody:
      mode === "chords-melody" ||
      mode === "melody-only" ||
      mode === "melody-reactive" ||
      mode === "chords-melody-reactive" ||
      mode === "active-context-reactive",
    accompaniment:
      mode === "chords-melody" ||
      mode === "accompaniment-only" ||
      mode === "active-context-reactive",
    reactive:
      mode === "reactive-only" ||
      mode === "chords-reactive" ||
      mode === "melody-reactive" ||
      mode === "chords-melody-reactive" ||
      mode === "active-context-reactive",
  }
}

export interface PlayOptions {
  bpm: number
  chords: ChordEvent[]
  melody: MelodyNote[]
  /** Issue #45: コードパッドとは独立したPattern伴奏。 */
  accompaniment?: MelodyNote[]
  /** Issue #42: Counter / Decoration共通の独立試聴レイヤー。 */
  reactive?: MelodyNote[]
  mode: PreviewMode
  /** Signature Phraseの演出意図を比較試聴へ反映する。MIDI音符自体は変えない。 */
  leadStyle?: LeadPreviewStyle
  loop?: boolean
  /** 比較試聴用。startBeatは今回の再生開始位置、rangeは共通ループ範囲。 */
  startBeat?: number
  range?: { startBeat: number; endBeat: number }
  onEnded?: () => void
}

/**
 * Counter / Decorationの比較試聴範囲。
 * 候補の直前・直後だけを残し、候補が鳴り終わったあとSection末まで待たせない。
 */
export function resolveReactivePreviewRange(
  notes: MelodyNote[],
  totalBeats: number,
  contextBeats = 1,
): { startBeat: number; endBeat: number } {
  if (notes.length === 0 || totalBeats <= 0) {
    return { startBeat: 0, endBeat: Math.max(0, totalBeats) }
  }
  const firstBeat = Math.min(...notes.map((note) => note.startBeat))
  const lastBeat = Math.max(
    ...notes.map((note) => note.startBeat + note.durationBeats),
  )
  return {
    startBeat: Math.max(0, firstBeat - contextBeats),
    endBeat: Math.min(totalBeats, lastBeat + contextBeats * 0.5),
  }
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
    const layers = previewLayersForMode(opts.mode)
    const leadStyle = opts.leadStyle ?? "neutral"
    const leadDestination =
      layers.melody && leadStyle === "atmospheric"
        ? this.createAtmosphericLeadBus(ctx, compressor)
        : compressor

    if (layers.chords) {
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

    if (layers.melody) {
      for (const n of opts.melody) {
        const eventEnd = n.startBeat + n.durationBeats
        if (eventEnd <= playbackStart || n.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(n.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + (clippedStart - playbackStart) * this.secondsPerBeat
        const dur = (clippedEnd - clippedStart) * this.secondsPerBeat
        this.scheduleLead(ctx, leadDestination, n.pitch, n.velocity, t0, dur, leadStyle)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (layers.accompaniment) {
      for (const n of opts.accompaniment ?? []) {
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

    if (layers.reactive) {
      for (const n of opts.reactive ?? []) {
        const eventEnd = n.startBeat + n.durationBeats
        if (eventEnd <= playbackStart || n.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(n.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + (clippedStart - playbackStart) * this.secondsPerBeat
        const dur = (clippedEnd - clippedStart) * this.secondsPerBeat
        this.scheduleLead(ctx, compressor, n.pitch, Math.max(35, n.velocity - 8), t0, dur)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (Number.isFinite(rangeEnd)) totalBeats = Math.max(0, rangeEnd - playbackStart)
    const totalSeconds =
      totalBeats * this.secondsPerBeat + previewTailSeconds(leadStyle)
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

  private createAtmosphericLeadBus(
    ctx: AudioContext,
    dest: AudioNode,
  ): AudioNode {
    const input = ctx.createGain()
    const dry = ctx.createGain()
    const delay = ctx.createDelay(1.5)
    const feedback = ctx.createGain()
    const wet = ctx.createGain()
    const tone = ctx.createBiquadFilter()
    dry.gain.value = 0.82
    delay.delayTime.value = 0.31
    feedback.gain.value = 0.24
    wet.gain.value = 0.2
    tone.type = "lowpass"
    tone.frequency.value = 2800
    input.connect(dry)
    dry.connect(dest)
    input.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    delay.connect(tone)
    tone.connect(wet)
    wet.connect(dest)
    return input
  }

  /**
   * ピアノに近いリード音。ピアノらしさの要点は
   *   ①非常に速いアタック ②持続せず打鍵直後から連続的に減衰する余韻
   *   ③打鍵直後だけ倍音が明るく、その後こもる(ローパスが閉じる)
   *   ④低音ほど長く鳴る
   * を Web Audio の合成で近似する(最終音色はLogic Proで決める前提の確認用、12章)。
   */
  private scheduleLead(
    ctx: AudioContext,
    dest: AudioNode,
    pitch: number,
    velocity: number,
    t0: number,
    dur: number,
    style: LeadPreviewStyle = "neutral",
  ): void {
    const freq = midiToFreq(pitch)
    const vel = Math.min(1, Math.max(0.15, velocity / 127))
    // 柔らかめ: アタックの角(クリック感)を丸めるため立ち上がりをやや緩める
    const attack =
      style === "atmospheric" ? 0.04 : style === "kinetic" ? 0.006 : 0.012
    const peakBase =
      style === "atmospheric" ? 0.21 : style === "kinetic" ? 0.32 : 0.28
    const peak = peakBase * (0.5 + 0.5 * vel)

    // 低音ほど長く、強打ほど少し長く残す減衰時間。音価が短ければその長さで切る。
    const ringScale = style === "atmospheric" ? 1.45 : style === "obsessive" ? 0.72 : 1
    const naturalRing =
      Math.min(3.4, 3.2 - (pitch - 60) * 0.05) *
      (0.75 + 0.25 * vel) *
      ringScale
    const ring = Math.max(
      style === "atmospheric" ? 0.55 : 0.28,
      Math.min(naturalRing, dur * 0.98 + (style === "atmospheric" ? 0.7 : 0.25)),
    )
    const holdEnd = t0 + ring
    const release = style === "atmospheric" ? 0.65 : style === "obsessive" ? 0.08 : 0.12

    // 柔らかめ: 上倍音を大きく抑え、基音中心のまろやかな倍音構成にする(とがりの主因を除く)
    const wave = ctx.createPeriodicWave(
      new Float32Array([0, 0, 0, 0, 0, 0]),
      new Float32Array(
        style === "atmospheric"
          ? [0, 1, 0.2, 0.06, 0.02, 0.005]
          : style === "obsessive"
            ? [0, 1, 0.42, 0.2, 0.08, 0.03]
            : [0, 1, 0.32, 0.13, 0.05, 0.02],
      ),
      { disableNormalization: false },
    )
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(wave)
    osc.frequency.value = freq

    // 柔らかめ: 打鍵直後の明るさを控えめにし、より早くこもらせる(耳につく高域を減らす)
    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    const brightness = style === "atmospheric" ? 0.7 : style === "kinetic" ? 1.18 : 1
    const brightStart = Math.min(6200, freq * (2.6 + 2.2 * vel) * brightness)
    const brightEnd = Math.min(3000, Math.max(freq * 1.6 * brightness, 620))
    filter.frequency.setValueAtTime(brightStart, t0)
    filter.frequency.exponentialRampToValueAtTime(brightEnd, t0 + Math.min(0.35, ring))
    filter.Q.value = 0.4

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
