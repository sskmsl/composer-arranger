import type { AiAudioLocalFeatures, AiAudioPayload } from "./types"

export const MAX_AI_AUDIO_BYTES = 12 * 1024 * 1024
export const MAX_AI_AUDIO_DURATION_SECONDS = 10 * 60
export const AI_AUDIO_ACCEPT = ".mp3,.wav,audio/mpeg,audio/wav"

function normalizedEnergyCurve(channelData: Float32Array, bucketCount = 16): number[] {
  if (channelData.length === 0) return Array.from({ length: bucketCount }, () => 0)
  const values = Array.from({ length: bucketCount }, (_, bucket) => {
    const start = Math.floor(channelData.length * bucket / bucketCount)
    const end = Math.max(start + 1, Math.floor(channelData.length * (bucket + 1) / bucketCount))
    let squared = 0
    const stride = Math.max(1, Math.floor((end - start) / 12_000))
    let count = 0
    for (let index = start; index < end; index += stride) {
      const sample = channelData[index] ?? 0
      squared += sample * sample
      count += 1
    }
    return Math.sqrt(squared / Math.max(1, count))
  })
  const peak = Math.max(...values, 0.000_001)
  return values.map((value) => Number((value / peak).toFixed(3)))
}

export function summarizeAudioSamples(
  channelData: Float32Array,
  durationSeconds: number,
  sampleRate: number,
  channelCount: number,
): AiAudioLocalFeatures {
  const energyCurve = normalizedEnergyCurve(channelData)
  const sorted = [...energyCurve].sort((left, right) => left - right)
  const low = sorted[Math.floor(sorted.length * 0.15)] ?? 0
  const high = sorted[Math.floor(sorted.length * 0.85)] ?? 0
  const silenceRatio = energyCurve.filter((value) => value < 0.12).length / energyCurve.length
  const changes = energyCurve.slice(1).map((value, index) => Math.abs(value - energyCurve[index]))
  const transientDensity = changes.filter((value) => value > 0.22).length / Math.max(1, changes.length)
  const peakIndex = energyCurve.indexOf(Math.max(...energyCurve))
  return {
    durationSeconds: Number(durationSeconds.toFixed(2)),
    sampleRate,
    channelCount,
    energyCurve,
    silenceRatio: Number(silenceRatio.toFixed(3)),
    dynamicRange: Number(Math.max(0, high - low).toFixed(3)),
    transientDensity: Number(transientDensity.toFixed(3)),
    peakPosition: Number(((peakIndex + 0.5) / energyCurve.length).toFixed(3)),
  }
}

function audioFormat(file: File): "mp3" | "wav" {
  const lowerName = file.name.toLowerCase()
  if (file.type === "audio/wav" || file.type === "audio/x-wav" || lowerName.endsWith(".wav")) {
    return "wav"
  }
  if (file.type === "audio/mpeg" || lowerName.endsWith(".mp3")) return "mp3"
  throw new Error("現在対応している音源形式はMP3とWAVです。")
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function prepareAiAudio(file: File): Promise<AiAudioPayload> {
  if (file.size > MAX_AI_AUDIO_BYTES) {
    throw new Error("音源は12MB以下にしてください。書き出し範囲を短くするかMP3をご利用ください。")
  }
  const format = audioFormat(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const audioContext = new AudioContext()
  try {
    const decoded = await audioContext.decodeAudioData(bytes.buffer.slice(0))
    if (decoded.duration > MAX_AI_AUDIO_DURATION_SECONDS) {
      throw new Error("音源は10分以内にしてください。分析したい範囲だけを書き出すと精度も上がります。")
    }
    const features = summarizeAudioSamples(
      decoded.getChannelData(0),
      decoded.duration,
      decoded.sampleRate,
      decoded.numberOfChannels,
    )
    return {
      fileName: file.name,
      mimeType: file.type || (format === "mp3" ? "audio/mpeg" : "audio/wav"),
      format,
      sizeBytes: file.size,
      dataBase64: bytesToBase64(bytes),
      localFeatures: features,
    }
  } finally {
    await audioContext.close()
  }
}
