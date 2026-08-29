const COMPRESSED_FORMAT = "composer-arranger:gzip-base64:v1" as const
const COMPRESSION_THRESHOLD_BYTES = 64 * 1024

export interface CompressedCloudProjectPayload {
  __composerArrangerCloudFormat: typeof COMPRESSED_FORMAT
  originalBytes: number
  payload: string
}

export type CloudProjectPayload<T> = T | CompressedCloudProjectPayload

function isCompressedPayload(
  value: unknown,
): value is CompressedCloudProjectPayload {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<CompressedCloudProjectPayload>
  return (
    candidate.__composerArrangerCloudFormat === COMPRESSED_FORMAT &&
    typeof candidate.originalBytes === "number" &&
    typeof candidate.payload === "string"
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(
    new CompressionStream("gzip"),
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * 大きいProjectだけgzip+base64へ変換し、Chromeからの巨大なJSONB一括送信を抑える。
 * 小さいProjectと既存Cloudデータは従来のJSONオブジェクト形式を維持する。
 */
export async function encodeCloudProjectPayload<T>(
  project: T,
): Promise<CloudProjectPayload<T>> {
  const json = JSON.stringify(project)
  const source = new TextEncoder().encode(json)
  if (
    source.byteLength < COMPRESSION_THRESHOLD_BYTES ||
    typeof CompressionStream === "undefined"
  ) {
    return project
  }

  try {
    const compressed = await compress(source)
    const envelope: CompressedCloudProjectPayload = {
      __composerArrangerCloudFormat: COMPRESSED_FORMAT,
      originalBytes: source.byteLength,
      payload: bytesToBase64(compressed),
    }
    // 圧縮しにくいデータではbase64分だけ増えるため、元データの方が小さければ従来形式を使う。
    return JSON.stringify(envelope).length < source.byteLength
      ? envelope
      : project
  } catch {
    // CompressionStreamが部分実装のブラウザでもCloud同期自体は従来形式で継続する。
    return project
  }
}

/** 既存の生JSONと新しい圧縮Envelopeを同じ読込経路で復元する。 */
export async function decodeCloudProjectPayload<T>(
  value: CloudProjectPayload<T> | unknown,
): Promise<T> {
  if (!isCompressedPayload(value)) return value as T
  if (typeof DecompressionStream === "undefined") {
    throw new Error("このブラウザは圧縮済みCloud Projectの読込に対応していません。")
  }
  const restored = await decompress(base64ToBytes(value.payload))
  return JSON.parse(new TextDecoder().decode(restored)) as T
}
