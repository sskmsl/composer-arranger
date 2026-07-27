import { useMemo, useRef, useState } from "react"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { noteName } from "@/core/note"
import { keyPrefersFlatSpelling } from "@/core/scale"
import { parseTimeSignature } from "@/core/section"
import { Lock } from "lucide-react"

const PX_PER_BEAT = 32
const ROW_HEIGHT = 8
const EMPTY_NOTES: MelodyNote[] = []

export interface BeatRange {
  start: number
  end: number
}

export function PianoRoll({
  variant,
  chords,
  totalBeats,
  timeSignature,
  songKey,
  selectedNoteIds,
  onToggleNoteSelect,
  onToggleNoteLock,
  lockedBars,
  onToggleBarLock,
  selection,
  onSelectionChange,
}: {
  variant: MelodyVariant | undefined
  chords: ChordEvent[]
  totalBeats: number
  timeSignature: string
  songKey?: string
  selectedNoteIds: Set<string>
  onToggleNoteSelect: (noteId: string) => void
  onToggleNoteLock: (noteId: string) => void
  lockedBars: number[]
  onToggleBarLock: (barIndex: number) => void
  selection: BeatRange | null
  onSelectionChange: (range: BeatRange | null) => void
}) {
  const { beatsPerBar } = parseTimeSignature(timeSignature)
  const preferFlat = songKey ? keyPrefersFlatSpelling(songKey) : false
  const notes = variant?.notes ?? EMPTY_NOTES

  const { low, high } = useMemo(() => {
    if (notes.length === 0) return { low: 55, high: 79 }
    const pitches = notes.map((n) => n.pitch)
    return { low: Math.min(...pitches) - 3, high: Math.max(...pitches) + 3 }
  }, [notes])

  const rows = high - low + 1
  const width = Math.max(totalBeats * PX_PER_BEAT, 200)
  const height = rows * ROW_HEIGHT
  const yForPitch = (pitch: number) => (high - pitch) * ROW_HEIGHT

  const containerRef = useRef<HTMLDivElement>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)

  const beatAtClientX = (clientX: number): number => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const x = clientX - rect.left + (containerRef.current?.scrollLeft ?? 0)
    return Math.max(0, Math.min(totalBeats, x / PX_PER_BEAT))
  }

  const bars = Math.ceil(totalBeats / beatsPerBar)

  return (
    // Issue #59: overflow-hidden を持つflexアイテムは、CSSの自動最小サイズ規則により
    // コンテンツより小さく圧縮され得る(main側はスクロールせず、この要素だけが潰れる)。
    // shrink-0 で常にコンテンツの自然な高さ(=内部のmax-height指定に従う高さ)を確保する。
    <div className="flex w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border border-hairline bg-surface-tile-1">
      <div className="flex items-center gap-2 border-b border-hairline bg-surface-tile-2 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
        <h3 className="text-[12px] font-medium text-body-on-dark">Melody</h3>
        <span className="text-[10px] text-ink-muted-48">編集可能</span>
      </div>
      <div
        ref={containerRef}
        className="relative w-full min-w-0 overflow-auto no-scrollbar"
        // Issue #59: 固定px高では画面サイズに関わらず一律にスクロールが発生していたため、
        // viewport高に応じて自動調整する。通常の音域(コンテンツ実高)ならスクロールなしで
        // 全体が収まり、極端に広い音域のときだけ内部スクロールでレイアウト崩れを防ぐ。
        style={{ maxHeight: "min(52vh, 560px)" }}
        onMouseDown={(e) => {
          const target = e.target as SVGElement
          if (target.closest("[data-note]")) return
          const beat = beatAtClientX(e.clientX)
          setDragStart(beat)
          onSelectionChange({ start: beat, end: beat })
        }}
        onMouseMove={(e) => {
          if (dragStart === null) return
          const beat = beatAtClientX(e.clientX)
          onSelectionChange({ start: Math.min(dragStart, beat), end: Math.max(dragStart, beat) })
        }}
        onMouseUp={() => setDragStart(null)}
      >
        {/* 小節ヘッダー: クリックでBar Lock。水平スクロールは本体と連動し、縦スクロール時は上部に固定する */}
        <div
          className="sticky top-0 z-10 flex h-6 shrink-0 border-b border-hairline bg-surface-tile-2 text-[10px] text-ink-muted-48"
          style={{ width }}
        >
          {Array.from({ length: bars }).map((_, i) => (
            <button
              key={i}
              onClick={() => onToggleBarLock(i + 1)}
              className={`flex items-center justify-center gap-1 border-r border-hairline/60 ${
                lockedBars.includes(i + 1) ? "bg-primary/25 text-primary-on-dark" : "hover:bg-white/5"
              }`}
              style={{ width: beatsPerBar * PX_PER_BEAT }}
              title="クリックでこの小節をLock"
            >
              {lockedBars.includes(i + 1) && <Lock size={9} />}
              {i + 1}
            </button>
          ))}
        </div>

        <svg width={width} height={height} className="block">
          {/* コード背景 */}
          {chords.map((c, i) => (
            <g key={c.id}>
              <rect
                x={c.startBeat * PX_PER_BEAT}
                y={0}
                width={c.durationBeats * PX_PER_BEAT}
                height={height}
                fill={i % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.045)"}
              />
              <text x={c.startBeat * PX_PER_BEAT + 4} y={12} fontSize={10} fill="rgba(255,255,255,0.4)">
                {c.symbol}
              </text>
            </g>
          ))}

          {/* 小節線 */}
          {Array.from({ length: bars + 1 }).map((_, i) => (
            <line
              key={i}
              x1={i * beatsPerBar * PX_PER_BEAT}
              x2={i * beatsPerBar * PX_PER_BEAT}
              y1={0}
              y2={height}
              stroke="rgba(255,255,255,0.1)"
            />
          ))}

          {/* フレーズ境界・クライマックス */}
          {variant?.phrasePlans.map((p, i) => (
            <g key={i}>
              <line
                x1={p.phraseStartBeat * PX_PER_BEAT}
                x2={p.phraseStartBeat * PX_PER_BEAT}
                y1={0}
                y2={height}
                stroke="rgba(41,151,255,0.5)"
                strokeDasharray="3,3"
              />
              <circle cx={p.climaxBeat * PX_PER_BEAT + 4} cy={4} r={3} fill="#2997ff" />
            </g>
          ))}

          {/* 選択範囲 */}
          {selection && selection.end > selection.start && (
            <rect
              x={selection.start * PX_PER_BEAT}
              y={0}
              width={(selection.end - selection.start) * PX_PER_BEAT}
              height={height}
              fill="rgba(0,102,204,0.18)"
              stroke="#0071e3"
            />
          )}

          {/* ノート */}
          {notes.map((n) => {
            const selected = selectedNoteIds.has(n.id)
            const locked = n.locks.length > 0
            return (
              <g key={n.id}>
                <rect
                  data-note="true"
                  x={n.startBeat * PX_PER_BEAT + 1}
                  y={yForPitch(n.pitch) + 1}
                  width={Math.max(4, n.durationBeats * PX_PER_BEAT - 2)}
                  height={ROW_HEIGHT - 2}
                  rx={2}
                  fill={selected ? "#2997ff" : locked ? "#8a3b52" : "#0066cc"}
                  stroke={selected ? "#ffffff" : "none"}
                  strokeWidth={1}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleNoteSelect(n.id)
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    onToggleNoteLock(n.id)
                  }}
                >
                  <title>{`${noteName(n.pitch, preferFlat)} — ダブルクリックでLock`}</title>
                </rect>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
