import type { ChordEvent } from "@/core/project"
import { createTempoMap, type TempoChange, type TempoMap } from "@/core/tempoMap"
import type { MelodyNote } from "@/core/melody"
import { parseChordSymbol } from "@/core/chord"
import { midiToFreq } from "@/core/note"
import { voiceChord } from "./chordVoicing"
import type { ArrangementTrackId, GeneratedArrangementNote } from "@/core/arrangementGeneration"
import { fullSongPreviewRanges } from "./fullSongPreview"
import { arrangementTrackProgram, gmFileForProgram, type SoundPart, type SoundSettings } from "@/core/gmInstruments"
import { gmBufferKey, gmSampleFor, loadGmBuffers, scheduleGmSample, type GmBufferKey } from "./gmSampler"
import { getSoundSettings, setGmLoadState } from "./soundSettings"

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
  /** 途中のテンポの指定(beat は chords / melody と同じ位置の基準)。省略時は bpm 一定 */
  tempoChanges?: TempoChange[]
  chords: ChordEvent[]
  melody: MelodyNote[]
  /** Issue #45: コードパッドとは独立したPattern伴奏。 */
  accompaniment?: MelodyNote[]
  /** Issue #42: Counter / Decoration共通の独立試聴レイヤー。 */
  reactive?: MelodyNote[]
  /** Arrangement Generatorの役割別トラック。ドラムは簡易打楽器、その他は役割別の確認音で鳴らす。 */
  arrangementTracks?: Array<{ id: ArrangementTrackId; notes: GeneratedArrangementNote[] }>
  mode: PreviewMode
  /** GM音源で鳴らすとき、melody に渡した音がどのパートか(短いフレーズ・イントロの試聴など)。既定は主旋律 */
  melodyPart?: SoundPart
  /** GM音源で鳴らすとき、reactive に渡した音がどのパートか。既定は対旋律 */
  reactivePart?: SoundPart
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

/** 連続再生の各先読み区間へ、発音イベントを重複なく割り当てる。 */
export function belongsToContinuousPreviewWindow(
  eventStart: number,
  eventEnd: number,
  playbackStart: number,
  windowStart: number,
  windowEnd: number,
  firstWindow: boolean,
): boolean {
  return (
    (eventStart >= windowStart && eventStart < windowEnd) ||
    (firstWindow && eventStart < playbackStart && eventEnd > playbackStart)
  )
}

/**
 * ハイハット・スネア・クラッシュなど、雑音から作る打楽器の音作り。
 * 減衰は音価ではなく楽器で決める(クローズのハイハットは短く、クラッシュは長く)。
 */
export function noisePercussionSpec(trackId: ArrangementTrackId): {
  filter: BiquadFilterType
  frequency: number
  q: number
  gain: number
  decay: number
  body?: { frequency: number; gain: number; decay: number }
} {
  if (trackId === "dr-closed-hat") return { filter: "highpass", frequency: 7500, q: 0.7, gain: 0.32, decay: 0.05 }
  if (trackId === "dr-open-hat") return { filter: "highpass", frequency: 6800, q: 0.7, gain: 0.28, decay: 0.24 }
  if (trackId === "dr-crash") return { filter: "highpass", frequency: 3800, q: 0.5, gain: 0.3, decay: 1.1 }
  if (trackId === "dr-field-drum") return { filter: "bandpass", frequency: 1200, q: 0.8, gain: 0.55, decay: 0.2, body: { frequency: 150, gain: 0.4, decay: 0.1 } }
  // スネア
  return { filter: "bandpass", frequency: 1900, q: 0.7, gain: 0.6, decay: 0.15, body: { frequency: 185, gain: 0.45, decay: 0.08 } }
}

/** 決まった種から作る白色雑音(-1〜1)。再生のたびに同じ雑音を使う */
export function whiteNoiseSamples(length: number, seed = 0x2f6b1a3d): Float32Array {
  const samples = new Float32Array(length)
  let state = seed >>> 0
  for (let index = 0; index < length; index += 1) {
    // xorshift32
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    samples[index] = state / 0x80000000 - 1
  }
  return samples
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

/** AudioContext ごとに1つだけ作る、2秒の白色雑音 */
function whiteNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx)
  if (!buffer) {
    const length = Math.round(ctx.sampleRate * 2)
    buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    buffer.getChannelData(0).set(whiteNoiseSamples(length))
    noiseBuffers.set(ctx, buffer)
  }
  return buffer
}

/** GM音源で鳴らすときに読み込む音(楽器ファイル → 音の高さ)。鳴らすレイヤーの音だけを集める */
export function gmPreviewRequests(opts: PlayOptions, programs: SoundSettings["programs"]): Map<string, Set<number>> {
  const requests = new Map<string, Set<number>>()
  const add = (program: number, pitch: number) => {
    const file = gmFileForProgram(program)
    let pitches = requests.get(file)
    if (!pitches) requests.set(file, (pitches = new Set()))
    pitches.add(pitch)
  }
  const layers = previewLayersForMode(opts.mode)
  if (layers.chords) {
    for (const chord of opts.chords) {
      const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      if (!parsed) continue
      const voicing = voiceChord(parsed)
      for (const pitch of [voicing.bassMidi, ...voicing.upperMidi]) add(programs.chords, pitch)
    }
  }
  if (layers.melody) for (const note of opts.melody) add(programs[opts.melodyPart ?? "melody"], note.pitch)
  if (layers.accompaniment) for (const note of opts.accompaniment ?? []) add(programs.accompaniment, note.pitch)
  if (layers.reactive) for (const note of opts.reactive ?? []) add(programs[opts.reactivePart ?? "counter"], note.pitch)
  for (const track of opts.arrangementTracks ?? []) {
    const program = arrangementTrackProgram(track.id)
    if (program === "drums") continue
    for (const note of track.notes) add(program, note.pitch)
  }
  return requests
}

/**
 * Web Audio APIによる簡易プレビュー再生。3.8「判断の主軸は音」を実質化するための
 * 確認用シンセ(最終音色はLogic Proで決定する、12章)。
 */
class PreviewPlayer {
  private ctx: AudioContext | null = null
  private endTimer: number | null = null
  private schedulerTimer: number | null = null
  private startTime = 0
  private secondsPerBeat = 0.5
  /** テンポの変化を含む拍→秒の換算。tempoChanges がなければ bpm 一定 */
  private tempoMap: TempoMap = createTempoMap(120)

  /** from拍からto拍までの秒数(テンポの変化を反映) */
  private span(from: number, to: number): number {
    return this.tempoMap.seconds(to) - this.tempoMap.seconds(from)
  }
  private playbackStartBeat = 0
  /** GM音源で鳴らしている間の楽器と、読み込んだサンプル。null ならこれまでの合成音 */
  private gm: { programs: SoundSettings["programs"]; buffers: Map<GmBufferKey, AudioBuffer> } | null = null
  /** GM音源の読み込み中(まだ鳴らし始めていない) */
  private pending = false
  /** stop のたびに増やし、読み込みの後で古い再生を始めないようにする */
  private generation = 0
  /** 打楽器の雑音を読み始める位置(秒)。毎回ずらす */
  private noiseOffset = 0

  play(opts: PlayOptions): void {
    this.stop()
    // AudioContext は押した操作の中で作る(iPhone の Safari は、操作の外で作ると鳴らないことがある)
    const ctx = new AudioContext()
    this.ctx = ctx
    void ctx.resume()
    this.withSamples(ctx, opts, () => this.startPlayback(ctx, opts))
  }

  /**
   * 試聴の音が GM音源なら、必要なサンプルを読み込んでから鳴らし始める。読み込めなければ合成音で鳴らす。
   * 合成音のときは、すぐに鳴らし始める。
   */
  private withSamples(ctx: AudioContext, opts: PlayOptions, start: () => void): void {
    const settings = getSoundSettings()
    if (settings.playback !== "gm") {
      this.gm = null
      start()
      return
    }
    const generation = this.generation
    const stale = () => this.ctx !== ctx || generation !== this.generation
    // 読み込みの間も、再生位置の表示は鳴らし始める位置に置く
    this.playbackStartBeat = Math.max(opts.range?.startBeat ?? 0, opts.startBeat ?? opts.range?.startBeat ?? 0)
    this.pending = true
    setGmLoadState("loading")
    loadGmBuffers(gmPreviewRequests(opts, settings.programs)).then(
      (buffers) => {
        if (stale()) return
        setGmLoadState("idle")
        this.gm = { programs: settings.programs, buffers }
        this.pending = false
        start()
      },
      () => {
        if (stale()) return
        setGmLoadState("failed")
        this.gm = null
        this.pending = false
        start()
      },
    )
  }

  private startPlayback(ctx: AudioContext, opts: PlayOptions): void {
    const master = ctx.createGain()
    master.gain.value = 0.85
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.ratio.value = 6
    compressor.connect(master)
    master.connect(ctx.destination)

    this.secondsPerBeat = 60 / opts.bpm
    this.tempoMap = createTempoMap(opts.bpm, opts.tempoChanges)
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
        const t0 = start + this.span(playbackStart, clippedStart)
        const dur = this.span(clippedStart, clippedEnd)
        this.scheduleChord(ctx, compressor, voicing.bassMidi, voicing.upperMidi, t0, dur)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (layers.melody) {
      for (const n of opts.melody) {
        const eventEnd = n.startBeat + n.durationBeats
        if (eventEnd <= playbackStart || n.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(n.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + this.span(playbackStart, clippedStart)
        const dur = this.span(clippedStart, clippedEnd)
        this.scheduleVoice(this.partProgram(opts.melodyPart ?? "melody"), ctx, leadDestination, n.pitch, n.velocity, t0, dur, leadStyle)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (layers.accompaniment) {
      for (const n of opts.accompaniment ?? []) {
        const eventEnd = n.startBeat + n.durationBeats
        if (eventEnd <= playbackStart || n.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(n.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + this.span(playbackStart, clippedStart)
        const dur = this.span(clippedStart, clippedEnd)
        this.scheduleVoice(this.partProgram("accompaniment"), ctx, compressor, n.pitch, n.velocity, t0, dur)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (layers.reactive) {
      for (const n of opts.reactive ?? []) {
        const eventEnd = n.startBeat + n.durationBeats
        if (eventEnd <= playbackStart || n.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(n.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + this.span(playbackStart, clippedStart)
        const dur = this.span(clippedStart, clippedEnd)
        this.scheduleVoice(this.partProgram(opts.reactivePart ?? "counter"), ctx, compressor, n.pitch, Math.max(35, n.velocity - 8), t0, dur)
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    for (const track of opts.arrangementTracks ?? []) {
      for (const note of track.notes) {
        const eventEnd = note.startBeat + note.durationBeats
        if (eventEnd <= playbackStart || note.startBeat >= rangeEnd) continue
        const clippedStart = Math.max(note.startBeat, playbackStart)
        const clippedEnd = Math.min(eventEnd, rangeEnd)
        const t0 = start + this.span(playbackStart, clippedStart)
        const dur = Math.max(0.04, this.span(clippedStart, clippedEnd))
        if (track.id.startsWith("dr-")) {
          this.schedulePercussion(ctx, compressor, track.id, note.velocity, t0, dur)
        } else {
          const style: LeadPreviewStyle = track.id.includes("pad") || track.id.startsWith("str-")
            ? "atmospheric"
            : track.id.includes("pulse") ? "obsessive" : "neutral"
          this.scheduleVoice(this.trackProgram(track.id), ctx, compressor, note.pitch, Math.max(25, note.velocity - 10), t0, dur, style, note.soundImage)
        }
        totalBeats = Math.max(totalBeats, clippedEnd - playbackStart)
      }
    }

    if (Number.isFinite(rangeEnd)) totalBeats = Math.max(0, rangeEnd - playbackStart)
    const totalSeconds =
      this.span(playbackStart, playbackStart + totalBeats) + previewTailSeconds(leadStyle)
    this.endTimer = window.setTimeout(() => {
      if (opts.loop) {
        this.play({ ...opts, startBeat: rangeStart })
      } else {
        this.dispose()
        opts.onEnded?.()
      }
    }, totalSeconds * 1000)
  }

  /**
   * 長い全曲を一つのAudioContextで連続再生する。
   * 音符は短い区間ごとに先読み予約し、数千Oscillatorの一括生成と
   * 区間ごとのAudioContext再作成による無音の隙間を同時に避ける。
   */
  playContinuous(opts: PlayOptions, chunkBeats = 32): void {
    this.stop()
    const rangeStart = opts.range?.startBeat ?? 0
    const rangeEnd = opts.range?.endBeat ?? 0
    if (!Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return

    const ctx = new AudioContext()
    this.ctx = ctx
    void ctx.resume()
    this.withSamples(ctx, opts, () => this.startContinuous(ctx, opts, chunkBeats))
  }

  private startContinuous(ctx: AudioContext, opts: PlayOptions, chunkBeats: number): void {
    const rangeStart = opts.range?.startBeat ?? 0
    const rangeEnd = opts.range?.endBeat ?? 0
    const master = ctx.createGain()
    master.gain.value = 0.85
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.ratio.value = 6
    compressor.connect(master)
    master.connect(ctx.destination)

    this.secondsPerBeat = 60 / opts.bpm
    this.tempoMap = createTempoMap(opts.bpm, opts.tempoChanges)
    const playbackStart = Math.max(rangeStart, opts.startBeat ?? rangeStart)
    this.playbackStartBeat = playbackStart
    this.startTime = ctx.currentTime + 0.05
    const leadStyle = opts.leadStyle ?? "neutral"
    const layers = previewLayersForMode(opts.mode)
    const leadDestination = layers.melody && leadStyle === "atmospheric"
      ? this.createAtmosphericLeadBus(ctx, compressor)
      : compressor
    const ranges = fullSongPreviewRanges(rangeEnd, chunkBeats, playbackStart)
    let nextRangeIndex = 0

    const scheduleAhead = () => {
      if (this.ctx !== ctx) return
      const currentBeat = this.getCurrentBeat()
      const lookAheadEnd = currentBeat + chunkBeats * 2
      while (
        nextRangeIndex < ranges.length &&
        ranges[nextRangeIndex].startBeat < lookAheadEnd
      ) {
        const window = ranges[nextRangeIndex]
        this.scheduleContinuousWindow(
          ctx,
          compressor,
          leadDestination,
          opts,
          layers,
          leadStyle,
          playbackStart,
          window.startBeat,
          window.endBeat,
          nextRangeIndex === 0,
          rangeEnd,
        )
        nextRangeIndex += 1
      }
    }

    scheduleAhead()
    const schedulerIntervalMs = Math.max(
      250,
      Math.min(4000, chunkBeats * this.secondsPerBeat * 250),
    )
    this.schedulerTimer = window.setInterval(scheduleAhead, schedulerIntervalMs)

    const totalSeconds = this.span(playbackStart, rangeEnd) + previewTailSeconds(leadStyle)
    this.endTimer = window.setTimeout(() => {
      this.clearScheduler()
      if (opts.loop) {
        this.playContinuous({ ...opts, startBeat: rangeStart }, chunkBeats)
      } else {
        this.dispose()
        opts.onEnded?.()
      }
    }, totalSeconds * 1000)
  }

  getElapsedBeats(): number {
    if (!this.ctx || this.pending) return 0
    const elapsedSeconds = this.ctx.currentTime - this.startTime
    return this.tempoMap.beatAt(this.tempoMap.seconds(this.playbackStartBeat) + elapsedSeconds) - this.playbackStartBeat
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
    this.generation += 1
    // 読み込みの途中で止めたら、読み込み中の表示も消す(読み込み自体は続き、次の再生で使う)
    if (this.pending) setGmLoadState("idle")
    this.pending = false
    if (this.endTimer != null) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.clearScheduler()
    this.dispose()
  }

  private scheduleContinuousWindow(
    ctx: AudioContext,
    compressor: AudioNode,
    leadDestination: AudioNode,
    opts: PlayOptions,
    layers: PreviewLayers,
    leadStyle: LeadPreviewStyle,
    playbackStart: number,
    windowStart: number,
    windowEnd: number,
    firstWindow: boolean,
    rangeEnd: number,
  ): void {
    const shouldSchedule = (eventStart: number, eventEnd: number) =>
      belongsToContinuousPreviewWindow(
        eventStart,
        eventEnd,
        playbackStart,
        windowStart,
        windowEnd,
        firstWindow,
      )
    const timing = (eventStart: number, eventEnd: number) => {
      const clippedStart = Math.max(eventStart, playbackStart)
      const clippedEnd = Math.min(eventEnd, rangeEnd)
      return {
        t0: this.startTime + this.span(playbackStart, clippedStart),
        duration: Math.max(0.04, this.span(clippedStart, clippedEnd)),
      }
    }

    if (layers.chords) {
      for (const chord of opts.chords) {
        const eventEnd = chord.startBeat + chord.durationBeats
        if (!shouldSchedule(chord.startBeat, eventEnd)) continue
        const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
        if (!parsed) continue
        const voicing = voiceChord(parsed)
        const { t0, duration } = timing(chord.startBeat, eventEnd)
        this.scheduleChord(ctx, compressor, voicing.bassMidi, voicing.upperMidi, t0, duration)
      }
    }

    const scheduleMelodyNotes = (
      notes: readonly MelodyNote[],
      part: SoundPart,
      destination: AudioNode,
      style: LeadPreviewStyle,
      velocityOffset = 0,
    ) => {
      for (const note of notes) {
        const eventEnd = note.startBeat + note.durationBeats
        if (!shouldSchedule(note.startBeat, eventEnd)) continue
        const { t0, duration } = timing(note.startBeat, eventEnd)
        this.scheduleVoice(
          this.partProgram(part),
          ctx,
          destination,
          note.pitch,
          Math.max(25, note.velocity + velocityOffset),
          t0,
          duration,
          style,
        )
      }
    }

    if (layers.melody) scheduleMelodyNotes(opts.melody, opts.melodyPart ?? "melody", leadDestination, leadStyle)
    if (layers.accompaniment) scheduleMelodyNotes(opts.accompaniment ?? [], "accompaniment", compressor, "neutral")
    if (layers.reactive) scheduleMelodyNotes(opts.reactive ?? [], opts.reactivePart ?? "counter", compressor, "neutral", -8)

    for (const track of opts.arrangementTracks ?? []) {
      for (const note of track.notes) {
        const eventEnd = note.startBeat + note.durationBeats
        if (!shouldSchedule(note.startBeat, eventEnd)) continue
        const { t0, duration } = timing(note.startBeat, eventEnd)
        if (track.id.startsWith("dr-")) {
          this.schedulePercussion(ctx, compressor, track.id, note.velocity, t0, duration)
        } else {
          const style: LeadPreviewStyle = track.id.includes("pad") || track.id.startsWith("str-")
            ? "atmospheric"
            : track.id.includes("pulse") ? "obsessive" : "neutral"
          this.scheduleVoice(this.trackProgram(track.id), ctx, compressor, note.pitch, Math.max(25, note.velocity - 10), t0, duration, style, note.soundImage)
        }
      }
    }
  }

  private clearScheduler(): void {
    if (this.schedulerTimer != null) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }
  }

  private partProgram(part: SoundPart): number | null {
    return this.gm ? this.gm.programs[part] : null
  }

  private trackProgram(trackId: ArrangementTrackId): number | null {
    const program = arrangementTrackProgram(trackId)
    return this.gm && program !== "drums" ? program : null
  }

  /** GM音源のサンプルがあればそれで、なければこれまでの合成音で1音鳴らす */
  private scheduleVoice(
    program: number | null,
    ctx: AudioContext,
    dest: AudioNode,
    pitch: number,
    velocity: number,
    t0: number,
    dur: number,
    style: LeadPreviewStyle = "neutral",
    soundImage?: { depth: number; decay: number; transientSoftness: number; stereoDiffusion: number },
  ): void {
    const buffer = program == null ? undefined : this.gm?.buffers.get(gmBufferKey(gmFileForProgram(program), gmSampleFor(pitch).sampleMidi))
    if (buffer) {
      scheduleGmSample(ctx, dest, buffer, pitch, velocity, t0, dur, style === "atmospheric" ? 0.6 : 0.25)
      return
    }
    this.scheduleLead(ctx, dest, pitch, velocity, t0, dur, style, soundImage)
  }

  /** コード: GM音源ならコードの楽器で鳴らす(ベースも同じ楽器。書き出しの Chords トラックと同じ) */
  private scheduleChord(ctx: AudioContext, dest: AudioNode, bassMidi: number, upperMidi: number[], t0: number, dur: number): void {
    const program = this.partProgram("chords")
    const file = program == null ? null : gmFileForProgram(program)
    const hasAll = file != null && [bassMidi, ...upperMidi].every((pitch) => this.gm?.buffers.has(gmBufferKey(file, gmSampleFor(pitch).sampleMidi)))
    if (!hasAll) {
      this.schedulePad(ctx, dest, bassMidi, upperMidi, t0, dur)
      return
    }
    // サンプルは合成のパッドより音が大きいので、主旋律より控えめにする
    this.scheduleVoice(program, ctx, dest, bassMidi, 62, t0, dur)
    for (const pitch of upperMidi) this.scheduleVoice(program, ctx, dest, pitch, 50, t0, dur)
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

  private schedulePercussion(
    ctx: AudioContext,
    dest: AudioNode,
    trackId: ArrangementTrackId,
    velocity: number,
    t0: number,
    dur: number,
  ): void {
    const level = Math.max(0.04, Math.min(0.45, velocity / 260))
    if (trackId === "dr-kick" || trackId === "dr-gran-cassa" || trackId.includes("tom")) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const base = trackId === "dr-gran-cassa" ? 48 : trackId === "dr-kick" ? 58 : trackId === "dr-low-tom" ? 90 : 125
      osc.type = "sine"
      osc.frequency.setValueAtTime(base * 2.2, t0)
      osc.frequency.exponentialRampToValueAtTime(base, t0 + Math.min(0.12, dur))
      gain.gain.setValueAtTime(level, t0)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.08, Math.min(0.55, dur + 0.12)))
      osc.connect(gain)
      gain.connect(dest)
      osc.start(t0)
      osc.stop(t0 + Math.max(0.1, Math.min(0.6, dur + 0.15)))
      return
    }
    const spec = noisePercussionSpec(trackId)
    const noise = ctx.createBufferSource()
    noise.buffer = whiteNoiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = spec.filter
    filter.frequency.value = spec.frequency
    filter.Q.value = spec.q
    const gain = ctx.createGain()
    const peak = level * spec.gain
    gain.gain.setValueAtTime(peak, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.decay)
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(dest)
    // 毎回同じ雑音にならないよう、読み始める位置をずらす
    noise.start(t0, (this.noiseOffset = (this.noiseOffset + 0.137) % 1))
    noise.stop(t0 + spec.decay + 0.02)
    if (spec.body) {
      // スネアの胴鳴り(短く減衰する低めの音)
      const body = ctx.createOscillator()
      const bodyGain = ctx.createGain()
      body.type = "triangle"
      body.frequency.setValueAtTime(spec.body.frequency, t0)
      bodyGain.gain.setValueAtTime(level * spec.body.gain, t0)
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.body.decay)
      body.connect(bodyGain)
      bodyGain.connect(dest)
      body.start(t0)
      body.stop(t0 + spec.body.decay + 0.02)
    }
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
    soundImage?: { depth: number; decay: number; transientSoftness: number; stereoDiffusion: number },
  ): void {
    const freq = midiToFreq(pitch)
    const vel = Math.min(1, Math.max(0.15, velocity / 127))
    // 柔らかめ: アタックの角(クリック感)を丸めるため立ち上がりをやや緩める
    const attack =
      (style === "atmospheric" ? 0.04 : style === "kinetic" ? 0.006 : 0.012)
      * (1 + Math.max(0, (soundImage?.transientSoftness ?? .5) - .5) * 1.4)
    const peakBase =
      style === "atmospheric" ? 0.21 : style === "kinetic" ? 0.32 : 0.28
    const peak = peakBase * (0.5 + 0.5 * vel) * (1 - Math.max(0, (soundImage?.depth ?? .5) - .5) * .35)

    // 低音ほど長く、強打ほど少し長く残す減衰時間。音価が短ければその長さで切る。
    const ringScale = (style === "atmospheric" ? 1.45 : style === "obsessive" ? 0.72 : 1)
      * (1 + Math.max(0, (soundImage?.decay ?? .5) - .5) * .65)
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
    if (soundImage && soundImage.stereoDiffusion > .5) {
      const pan = ctx.createStereoPanner()
      pan.pan.value = (pitch % 2 === 0 ? 1 : -1) * (soundImage.stereoDiffusion - .5) * .55
      gain.connect(pan)
      pan.connect(dest)
    } else {
      gain.connect(dest)
    }
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
