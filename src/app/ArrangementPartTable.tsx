import { clsx } from "clsx"
import {
  ARRANGEMENT_PART_ROWS,
  type ArrangementCellChange,
  type ArrangementMatrixSection,
} from "@/core/arrangementChat"
import type { PartCellMark } from "./useArrangementChat"

function markKey(sectionId: string, rowId: string): string {
  return `${sectionId}:${rowId}`
}

const PENDING_TEXT: Record<ArrangementCellChange["kind"], string> = {
  added: "足す?",
  removed: "外す?",
  changed: "変える?",
}

/**
 * 全曲アレンジのパート構成表。セクションを小節数に比例した列、パートを行にして、
 * どこで何が鳴っているかと、この版・提案で変わる所を一目で分かるようにする。
 */
export function ArrangementPartTable({
  matrix,
  marks,
  pendingChanges = [],
}: {
  matrix: ArrangementMatrixSection[]
  marks: Map<string, PartCellMark>
  pendingChanges?: ArrangementCellChange[]
}) {
  if (matrix.length === 0) return null
  const columns = `7.5rem ${matrix.map((section) => `minmax(2.75rem, ${Math.max(1, section.lengthBars)}fr)`).join(" ")}`
  const maxDensity = Math.max(
    1,
    ...matrix.flatMap((section) => ARRANGEMENT_PART_ROWS.map((row) => section.cells[row.id].notesPerBar)),
  )
  const pendingByKey = new Map(pendingChanges.map((change) => [markKey(change.sectionId, change.rowId), change]))
  const minWidth = `${7.5 * 16 + matrix.length * 52}px`

  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label="パート構成" className="flex flex-col gap-1.5" style={{ minWidth }}>
        <div role="row" className="grid items-end gap-1.5 pb-1" style={{ gridTemplateColumns: columns }}>
          <div role="columnheader" className="text-[11px] text-ink-muted-48">パート</div>
          {matrix.map((section) => (
            <div role="columnheader" key={section.sectionId} className="min-w-0">
              <div className="truncate text-[12px] font-medium text-body-on-dark" title={section.name}>{section.name}</div>
              <div className="text-[11px] tabular-nums text-ink-muted-48">{section.startBar}–{section.endBar}</div>
            </div>
          ))}
        </div>
        <SourceRow
          label="主旋律"
          color="#78baff"
          columns={columns}
          values={matrix.map((section) => section.hasMelody)}
          sectionIds={matrix.map((section) => section.sectionId)}
        />
        <SourceRow
          label="コード"
          color="#a8a8ad"
          columns={columns}
          values={matrix.map((section) => section.hasChords)}
          sectionIds={matrix.map((section) => section.sectionId)}
        />
        {ARRANGEMENT_PART_ROWS.map((row) => (
          <div role="row" key={row.id} className="grid items-center gap-1.5" style={{ gridTemplateColumns: columns }}>
            <div role="rowheader" className="flex min-w-0 items-center gap-2 text-[12px] text-body-muted">
              <span className="size-2 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden="true" />
              <span className="truncate">{row.label}</span>
            </div>
            {matrix.map((section) => {
              const cell = section.cells[row.id]
              const key = markKey(section.sectionId, row.id)
              const mark = marks.get(key)
              const pending = pendingByKey.get(key)
              const playing = cell.noteCount > 0
              const strength = playing ? 0.3 + 0.55 * Math.min(1, cell.notesPerBar / maxDensity) : 0
              const label = mark === "pending" && pending
                ? PENDING_TEXT[pending.kind]
                : mark === "removed"
                  ? "外した"
                  : mark === "added"
                    ? "追加"
                    : mark === "changed"
                      ? "変更"
                      : ""
              return (
                <div
                  role="cell"
                  key={section.sectionId}
                  aria-label={`${section.name}の${row.label}: ${playing ? `1小節あたり${Math.round(cell.notesPerBar * 10) / 10}音` : "なし"}${label ? `（${label}）` : ""}`}
                  className={clsx(
                    "relative flex h-7 items-center justify-center overflow-hidden rounded-[6px] text-[11px]",
                    !playing && "bg-white/[0.03]",
                    mark === "removed" && "border-[1.5px] border-dashed border-primary-on-dark text-primary-on-dark",
                    (mark === "changed" || mark === "added") && "outline outline-2 outline-offset-1 outline-primary-on-dark",
                    mark === "pending" && "outline outline-[1.5px] outline-offset-2 outline-dashed outline-amber-300",
                  )}
                >
                  {playing && (
                    <span className="absolute inset-0" style={{ background: row.color, opacity: strength }} aria-hidden="true" />
                  )}
                  {label && (
                    <span className={clsx("relative font-medium", playing ? "text-black" : mark === "pending" ? "text-amber-200" : "")}>
                      {label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-2 text-[11px] text-ink-muted-48">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 rounded-[3px] bg-white/40 outline outline-2 outline-primary-on-dark" aria-hidden="true" />
            この版で追加・変更
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 rounded-[3px] border-[1.5px] border-dashed border-primary-on-dark" aria-hidden="true" />
            この版で外した
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 rounded-[3px] outline outline-[1.5px] outline-dashed outline-amber-300" aria-hidden="true" />
            提案中（まだ適用していない）
          </span>
          <span>色が濃いほど音数が多い</span>
        </div>
      </div>
    </div>
  )
}

function SourceRow({
  label,
  color,
  columns,
  values,
  sectionIds,
}: {
  label: string
  color: string
  columns: string
  values: boolean[]
  sectionIds: string[]
}) {
  return (
    <div role="row" className="grid items-center gap-1.5" style={{ gridTemplateColumns: columns }}>
      <div role="rowheader" className="flex min-w-0 items-center gap-2 text-[12px] text-body-muted">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
        <span className="truncate">{label}</span>
        <span className="text-[11px] text-ink-muted-48">原曲</span>
      </div>
      {values.map((value, index) => (
        <div
          role="cell"
          key={sectionIds[index]}
          aria-label={`${label}: ${value ? "あり" : "なし"}`}
          className="h-3 rounded-full"
          style={{ background: value ? color : "rgba(255,255,255,0.04)", opacity: value ? 0.45 : 1 }}
        />
      ))}
    </div>
  )
}
