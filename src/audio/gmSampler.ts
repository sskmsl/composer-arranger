/**
 * GM音源(MIDI.js Soundfonts の FluidR3_GM)のサンプルを読み込み、Web Audio で鳴らす。
 * 楽器ごとのファイル(音名ごとの mp3 を base64 で並べた JS)は1回だけ取得し、
 * 使う音だけを復号して、このページを開いている間は使い回す(AudioBuffer は AudioContext をまたいで使える)。
 *
 * 音源: FluidR3_GM(Frank Wen)を MIDI.js 用に書き出したもの(https://github.com/gleitz/midi-js-soundfonts、CC BY 3.0)。
 */
export const GM_SOUNDFONT_BASE_URL = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/"

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
/** FluidR3_GM に入っている音域(A0〜C8)。外の音は端の音の再生速度を変えて鳴らす */
const LOWEST = 21
const HIGHEST = 108

export function gmNoteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/** サンプルの音(音域の中に丸めた音)と、再生速度(音域の外なら半音ずつずらす) */
export function gmSampleFor(midi: number): { sampleMidi: number; playbackRate: number } {
  const sampleMidi = Math.max(LOWEST, Math.min(HIGHEST, Math.round(midi)))
  return { sampleMidi, playbackRate: Math.pow(2, (midi - sampleMidi) / 12) }
}

/** 楽器ファイル(JS)から、音名 → data URL の表を取り出す */
export function parseSoundfontScript(text: string): Map<string, string> {
  const notes = new Map<string, string>()
  const pattern = /"([A-G]b?-?\d)"\s*:\s*"(data:audio\/[a-z0-9]+;base64,[^"]+)"/g
  for (const match of text.matchAll(pattern)) notes.set(match[1], match[2])
  return notes
}

const fileCache = new Map<string, Promise<Map<string, string>>>()
const bufferCache = new Map<string, Promise<AudioBuffer>>()
let decoder: BaseAudioContext | null = null

function decodingContext(): BaseAudioContext {
  decoder ??= new OfflineAudioContext(1, 1, 44_100)
  return decoder
}

function loadFile(file: string): Promise<Map<string, string>> {
  let pending = fileCache.get(file)
  if (!pending) {
    pending = fetch(`${GM_SOUNDFONT_BASE_URL}${file}-mp3.js`)
      .then((response) => {
        if (!response.ok) throw new Error(`GM音源を読み込めません(${response.status})`)
        return response.text()
      })
      .then(parseSoundfontScript)
    // 失敗したときは次の再生でもう一度取りに行く
    pending.catch(() => fileCache.delete(file))
    fileCache.set(file, pending)
  }
  return pending
}

function base64ToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function loadBuffer(file: string, sampleMidi: number): Promise<AudioBuffer> {
  const key = `${file}:${sampleMidi}`
  let pending = bufferCache.get(key)
  if (!pending) {
    pending = loadFile(file).then((notes) => {
      const dataUrl = notes.get(gmNoteName(sampleMidi))
      if (!dataUrl) throw new Error(`GM音源に ${gmNoteName(sampleMidi)} がありません`)
      return decodingContext().decodeAudioData(base64ToArrayBuffer(dataUrl))
    })
    pending.catch(() => bufferCache.delete(key))
    bufferCache.set(key, pending)
  }
  return pending
}

export type GmBufferKey = `${string}:${number}`

export const gmBufferKey = (file: string, sampleMidi: number): GmBufferKey => `${file}:${sampleMidi}`

/** 楽器ファイルごとの必要な音を読み込み、`楽器:音` → AudioBuffer の表を返す */
export async function loadGmBuffers(requests: ReadonlyMap<string, ReadonlySet<number>>): Promise<Map<GmBufferKey, AudioBuffer>> {
  const entries = await Promise.all(
    [...requests].flatMap(([file, pitches]) => {
      const samples = new Set([...pitches].map((pitch) => gmSampleFor(pitch).sampleMidi))
      return [...samples].map(async (sampleMidi) => [gmBufferKey(file, sampleMidi), await loadBuffer(file, sampleMidi)] as const)
    }),
  )
  return new Map(entries)
}

/**
 * サンプルを1音鳴らす。音価の終わりで短く減衰させる(持続する楽器も、減衰する楽器も同じ扱い)。
 * 返り値は音が鳴り終わる時刻。
 */
export function scheduleGmSample(
  ctx: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  pitch: number,
  velocity: number,
  t0: number,
  duration: number,
  release = 0.25,
): number {
  const { playbackRate } = gmSampleFor(pitch)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = playbackRate
  const gain = ctx.createGain()
  const level = 0.9 * Math.pow(Math.max(0.1, Math.min(1, velocity / 127)), 1.4)
  const end = t0 + Math.max(0.05, duration)
  gain.gain.setValueAtTime(level, t0)
  gain.gain.setValueAtTime(level, end)
  gain.gain.exponentialRampToValueAtTime(0.0001, end + release)
  source.connect(gain)
  gain.connect(destination)
  source.start(t0)
  source.stop(end + release + 0.02)
  return end + release
}
