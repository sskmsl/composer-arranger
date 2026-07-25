import { createEmptyProject, type ChordEvent, type ComposerProject } from "./project"
import type { Section, SectionRole } from "./section"

export const COMPOSER_SONG_EXCHANGE_FORMAT = "composer-os/song-exchange" as const
export const COMPOSER_SONG_EXCHANGE_VERSION = 1 as const

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

export interface ComposerSongExchangeV1 {
  format: typeof COMPOSER_SONG_EXCHANGE_FORMAT
  version: typeof COMPOSER_SONG_EXCHANGE_VERSION
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

function readExchange(value: unknown): ComposerSongExchangeV1 {
  const record = asRecord(value)
  if (!record || record.format !== COMPOSER_SONG_EXCHANGE_FORMAT) {
    throw new Error("Composer Song Exchange JSONではありません")
  }
  if (record.version !== COMPOSER_SONG_EXCHANGE_VERSION) {
    throw new Error(`未対応のComposer Song Exchange versionです: ${String(record.version)}`)
  }
  if (record.timeSignature !== "4/4") {
    throw new Error("Composer Song Exchange v1は4/4にのみ対応しています")
  }
  if (!Array.isArray(record.sections) || record.sections.length === 0) {
    throw new Error("読み込めるセクションがありません")
  }
  return record as unknown as ComposerSongExchangeV1
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
 * v1は4/4・1コード=1小節を前提とするが、JSON内の明示的な拍位置と音価を尊重する。
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

    const baseChords = sectionRecord.chords.map((rawChord, chordIndex) => {
      const chord = asRecord(rawChord)
      const symbol = typeof chord?.symbol === "string" ? chord.symbol.trim() : ""
      if (!symbol) {
        throw new Error(
          `セクション${sectionIndex + 1}のコード${chordIndex + 1}が空です`,
        )
      }
      const startBeat = finiteNonNegative(chord?.startBeat, chordIndex * 4)
      const durationBeats =
        typeof chord?.durationBeats === "number" &&
        Number.isFinite(chord.durationBeats) &&
        chord.durationBeats > 0
          ? chord.durationBeats
          : 4
      return { symbol, startBeat, durationBeats }
    })

    const baseLengthBeats = Math.max(
      4,
      ...baseChords.map((chord) => chord.startBeat + chord.durationBeats),
    )
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

  const firstKey = exchange.sections.find(
    (section) => typeof section.key === "string" && section.key.trim(),
  )?.key
  return {
    ...project,
    song: {
      ...project.song,
      key: firstKey?.trim() || project.song.key,
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
