import { useMemo } from "react"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { noteName } from "@/core/note"
import { keyPrefersFlatSpelling } from "@/core/scale"
import { parseTimeSignature } from "@/core/section"

const PX_PER_BEAT = 32
const ROW_HEIGHT = 8

export function ReadOnlyPianoRoll({
  notes,
  chords,
  totalBeats,
  timeSignature,
  songKey,
  title,
  subtitle,
  accentColor,
  accentStroke,
  ariaLabel,
  noteLabel,
  maxHeight = "min(40vh, 400px)",
}: {
  notes: MelodyNote[]
  chords: ChordEvent[]
  totalBeats: number
  timeSignature: string
  songKey?: string
  title: string
  subtitle: string
  accentColor: string
  accentStroke: string
  ariaLabel: string
  noteLabel: string
  /** Issue #59: コンテンツの音域はcontentごとに大きく異なる(Chord Voicingは特に広い)ため上書き可能にする */
  maxHeight?: string
}) {
  const { beatsPerBar } = parseTimeSignature(timeSignature)
  const preferFlat = songKey ? keyPrefersFlatSpelling(songKey) : false
  const { low, high } = useMemo(() => {
    if (notes.length === 0) return { low: 36, high: 60 }
    const pitches = notes.map((note) => note.pitch)
    return {
      low: Math.max(0, Math.min(...pitches) - 3),
      high: Math.min(127, Math.max(...pitches) + 3),
    }
  }, [notes])
  const rows = high - low + 1
  const width = Math.max(totalBeats * PX_PER_BEAT, 200)
  const height = rows * ROW_HEIGHT
  const bars = Math.ceil(totalBeats / beatsPerBar)
  const yForPitch = (pitch: number) => (high - pitch) * ROW_HEIGHT

  return (
    <section
      // Issue #59: overflow-hidden を持つflexアイテムの自動最小サイズ規則により、
      // コンテンツより小さく圧縮されることがある。shrink-0 で防ぐ(PianoRoll.tsxと同じ理由)。
      className="flex w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-surface-tile-1"
      style={{ borderColor: `${accentStroke}55` }}
    >
      <div className="flex items-center gap-2 border-b border-hairline bg-surface-tile-2 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: accentColor }} />
        <h3 className="text-[12px] font-medium text-body-on-dark">{title}</h3>
        <span className="text-[10px] text-ink-muted-48">{subtitle}</span>
      </div>
      {/* Issue #59: 固定260pxは Chord Voicing(Bass+Upper Notes)のような広い音域だと
          常に内部スクロールを強制していた。viewport高に応じた可変上限へ変え、
          呼び出し側(ChordPianoRoll)がcontentの典型的な音域に合わせて広げられるようにする。 */}
      <div className="w-full min-w-0 overflow-auto no-scrollbar" style={{ maxHeight }}>
        <div
          className="sticky top-0 z-10 flex h-6 shrink-0 border-b border-hairline bg-surface-tile-2 text-[10px] text-ink-muted-48"
          style={{ width }}
        >
          {Array.from({ length: bars }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-center border-r border-hairline/60"
              style={{ width: beatsPerBar * PX_PER_BEAT }}
            >
              {index + 1}
            </div>
          ))}
        </div>

        <svg width={width} height={height} className="block" aria-label={ariaLabel}>
          {chords.map((chord, index) => (
            <g key={chord.id}>
              <rect
                x={chord.startBeat * PX_PER_BEAT}
                y={0}
                width={chord.durationBeats * PX_PER_BEAT}
                height={height}
                fill={index % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.045)"}
              />
              <text
                x={chord.startBeat * PX_PER_BEAT + 4}
                y={12}
                fontSize={10}
                fill="rgba(255,255,255,0.4)"
              >
                {chord.symbol}
              </text>
            </g>
          ))}

          {Array.from({ length: bars + 1 }).map((_, index) => (
            <line
              key={index}
              x1={index * beatsPerBar * PX_PER_BEAT}
              x2={index * beatsPerBar * PX_PER_BEAT}
              y1={0}
              y2={height}
              stroke="rgba(255,255,255,0.1)"
            />
          ))}

          {notes.map((note) => (
            <rect
              key={note.id}
              x={note.startBeat * PX_PER_BEAT + 1}
              y={yForPitch(note.pitch) + 1}
              width={Math.max(4, note.durationBeats * PX_PER_BEAT - 2)}
              height={ROW_HEIGHT - 2}
              rx={2}
              fill={accentColor}
              stroke={accentStroke}
              strokeWidth={0.5}
              opacity={0.9}
            >
              <title>{`${noteName(note.pitch, preferFlat)} — ${noteLabel}`}</title>
            </rect>
          ))}
        </svg>
      </div>
    </section>
  )
}

export function AccompanimentPianoRoll(
  props: Omit<
    Parameters<typeof ReadOnlyPianoRoll>[0],
    "title" | "subtitle" | "accentColor" | "accentStroke" | "ariaLabel" | "noteLabel"
  >,
) {
  return (
    <ReadOnlyPianoRoll
      {...props}
      title="Accompaniment Pattern"
      subtitle="表示専用 · MIDI出力と同一"
      accentColor="#d79b45"
      accentStroke="#f3c56b"
      ariaLabel="Accompaniment Pattern Piano Roll"
      noteLabel="Accompaniment Pattern"
    />
  )
}
