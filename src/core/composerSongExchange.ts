import { createEmptyProject, type ChordEvent, type ComposerProject } from "./project"
import type { Section, SectionRole } from "./section"

export const COMPOSER_SONG_EXCHANGE_FORMAT = "composer-os/song-exchange" as const
/** 読み込める最新のversion */
export const COMPOSER_SONG_EXCHANGE_VERSION = 2 as const
/**
 * v1: 1コード=1小節(startBeat/durationBeatsは常に4拍刻み)。
 * v2: Chord Generatorの和声のリズムをそのまま反映し、コードごとの長さが可変
 *     (経過和音は2拍、終止の着地は8拍など)。セクションの長さは小節単位にそろえて書き出される。
 * どちらも中身の形は同じで、読み込み側は startBeat/durationBeats を都度参照する。
 */
export const SUPPORTED_COMPOSER_SONG_EXCHANGE_VERSIONS: readonly number[] = [1, 2]

interface ComposerSongExchangeChord {
  symbol: string
  startBeat: number
  durationBeats: number
}

interface ComposerSongExchangeSection {
  sourceId: string
  name: string
  role: SectionRole
  key: string
  repeatCount: number
  chords: ComposerSongExchangeChord[]
  sourceIntent?: {
    style?: string
    mood?: string
    scores?: Record<string, number>
  }
}

export interface ComposerSongExchange {
  format: typeof COMPOSER_SONG_EXCHANGE_FORMAT
  version: 1 | 2
  source: {
    app: string
    folderId: string
    exportedAt: string
  }
  title: string
  tempo: number
  timeSignature: "4/4"
  memo?: string
  sections: ComposerSongExchangeSection[]
}

const SECTION_ROLES = new Set<SectionRole>([
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "breakdown-chorus",
  "grand-chorus",
  "c-melody",
  "bridge",
  "instrumental",
  "outro",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

export function isComposerSongExchange(value: unknown): boolean {
  const record = asRecord(value)
  return record?.format === COMPOSER_SONG_EXCHANGE_FORMAT
}

function readExchange(value: unknown): ComposerSongExchange {
  const record = asRecord(value)
  if (!record || record.format !== COMPOSER_SONG_EXCHANGE_FORMAT) {
    throw new Error("Composer Song Exchange JSONではありません")
  }
  if (typeof record.version !== "number" || !SUPPORTED_COMPOSER_SONG_EXCHANGE_VERSIONS.includes(record.version)) {
    const version = record.version
    throw new Error(
      typeof version === "number" && version > COMPOSER_SONG_EXCHANGE_VERSION
        ? `Chord Generatorの書き出し形式(version ${version})がこのArrangerより新しいため読み込めません。ページを再読み込みしてArrangerを最新版にしてください`
        : `未対応のComposer Song Exchange versionです: ${String(version)}`,
    )
  }
  if (record.timeSignature !== "4/4") {
    throw new Error("Composer Song Exchangeは4/4にのみ対応しています")
  }
  if (!Array.isArray(record.sections) || record.sections.length === 0) {
    throw new Error("読み込めるセクションがありません")
  }
  return record as unknown as ComposerSongExchange
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

function positiveRepeat(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1
  return Math.min(64, Math.max(1, Math.round(value)))
}

function slashBass(symbol: string): string | null {
  return /\/([A-Ga-g][#b]?)$/.exec(symbol)?.[1] ?? null
}

/**
 * Chord Generatorの中立Exchange JSONを、新規Composer Projectへ変換する。
 * コードの拍位置と長さはJSON内の startBeat/durationBeats を尊重する(1小節に2コード等もそのまま)。
 * startBeat が無い場合は直前までの長さの合計から補う(v1なら従来どおり4拍刻みになる)。
 */
export function composerSongExchangeToProject(value: unknown): ComposerProject {
  const exchange = readExchange(value)
  const project = createEmptyProject(
    typeof exchange.title === "string" && exchange.title.trim()
      ? exchange.title.trim()
      : "Imported Song",
  )
  const sections: Section[] = []
  const chords: ChordEvent[] = []
  let startBar = 1
  // 曲の調は最初のセクションの調。転調したセクション(大サビの全音上げ等)は各セクションに調を持たせる
  const songKey =
    exchange.sections
      .map((section) => (typeof section.key === "string" ? section.key.trim() : ""))
      .find(Boolean) ?? project.song.key

  exchange.sections.forEach((rawSection, sectionIndex) => {
    const sectionRecord = asRecord(rawSection)
    if (!sectionRecord) throw new Error(`セクション${sectionIndex + 1}の形式が不正です`)

    const role = sectionRecord.role
    if (typeof role !== "string" || !SECTION_ROLES.has(role as SectionRole)) {
      throw new Error(`セクション${sectionIndex + 1}のRoleが不正です`)
    }
    if (!Array.isArray(sectionRecord.chords) || sectionRecord.chords.length === 0) {
      throw new Error(`セクション${sectionIndex + 1}にコードがありません`)
    }

    let cursor = 0
    const baseChords = sectionRecord.chords.map((rawChord, chordIndex) => {
      const chord = asRecord(rawChord)
      const symbol = typeof chord?.symbol === "string" ? chord.symbol.trim() : ""
      if (!symbol) {
        throw new Error(
          `セクション${sectionIndex + 1}のコード${chordIndex + 1}が空です`,
        )
      }
      const startBeat = finiteNonNegative(chord?.startBeat, cursor)
      const durationBeats =
        typeof chord?.durationBeats === "number" &&
        Number.isFinite(chord.durationBeats) &&
        chord.durationBeats > 0
          ? chord.durationBeats
          : 4
      cursor = startBeat + durationBeats
      return { symbol, startBeat, durationBeats }
    })

    // セクションは小節単位で並べる。合計が小節の途中で終わるファイル(Chord Generatorが
    // 小節単位にそろえる前に書き出したv2)は、最後のコードを小節末まで伸ばして埋める。
    // そうしないと繰り返しの2回目以降が小節の途中から始まり、次のセクションとの間に隙間ができる
    const contentBeats = Math.max(4, ...baseChords.map((chord) => chord.startBeat + chord.durationBeats))
    const baseLengthBeats = Math.ceil(contentBeats / 4) * 4
    const lastChord = baseChords.reduce((a, b) => (b.startBeat >= a.startBeat ? b : a))
    lastChord.durationBeats += baseLengthBeats - (lastChord.startBeat + lastChord.durationBeats)
    const repeatCount = positiveRepeat(sectionRecord.repeatCount)
    const totalBeats = baseLengthBeats * repeatCount
    const sectionId = crypto.randomUUID()
    const section: Section = {
      id: sectionId,
      name:
        typeof sectionRecord.name === "string" && sectionRecord.name.trim()
          ? sectionRecord.name.trim()
          : `Section ${sectionIndex + 1}`,
      role: role as SectionRole,
      startBar,
      lengthBars: Math.max(1, Math.ceil(totalBeats / 4)),
    }
    const sectionKey = typeof sectionRecord.key === "string" ? sectionRecord.key.trim() : ""
    if (sectionKey && sectionKey !== songKey) section.key = sectionKey
    sections.push(section)

    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++) {
      const repeatOffset = repeatIndex * baseLengthBeats
      for (const chord of baseChords) {
        chords.push({
          id: crypto.randomUUID(),
          sectionId,
          startBeat: repeatOffset + chord.startBeat,
          durationBeats: chord.durationBeats,
          symbol: chord.symbol,
          bass: slashBass(chord.symbol),
        })
      }
    }
    startBar += section.lengthBars
  })

  return {
    ...project,
    song: {
      ...project.song,
      key: songKey,
      tempo:
        Number.isFinite(exchange.tempo) && exchange.tempo >= 20 && exchange.tempo <= 300
          ? Math.round(exchange.tempo)
          : project.song.tempo,
      timeSignature: "4/4",
    },
    sections,
    chords,
    notes: typeof exchange.memo === "string" ? exchange.memo : "",
  }
}

/** 通常のComposer Project JSONはそのまま、Exchange JSONだけ新規Projectへ変換する。 */
export function prepareImportedProject(value: unknown): unknown {
  return isComposerSongExchange(value) ? composerSongExchangeToProject(value) : value
}
