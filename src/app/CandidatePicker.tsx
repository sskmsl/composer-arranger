import type { ReactNode } from "react"
import { clsx } from "clsx"
import { Check, Heart } from "lucide-react"
import { Pill } from "../ui/primitives"

export interface CandidatePickerItem {
  id: string
  adopted?: boolean
  favorite?: boolean
  rejected?: boolean
}

/**
 * 旋律タブで共通の、候補を番号で選ぶ行。主旋律と同じく「候補番号 → 選んだ候補の操作 →
 * ピアノロール」の順に並べるため、対旋律・装飾・イントロ・短いフレーズの候補一覧を
 * カードの格子ではなくこの1行にまとめる。採用中は✓、お気に入りは♥、却下は薄く表示する。
 */
export function CandidatePicker({
  items,
  activeId,
  onSelect,
  trailing,
}: {
  items: CandidatePickerItem[]
  activeId: string | undefined
  onSelect: (index: number) => void
  trailing?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[13px] font-medium text-body-on-dark">候補</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, index) => {
          const active = item.id === activeId
          const label = `候補 ${index + 1}${item.adopted ? "(採用中)" : ""}${item.favorite ? "(お気に入り)" : ""}${item.rejected ? "(却下)" : ""}`
          return (
            <Pill
              key={item.id}
              active={active}
              aria-pressed={active}
              aria-label={label}
              title={label}
              onClick={() => onSelect(index)}
              className={clsx(
                "flex min-w-9 items-center justify-center gap-0.5 px-3 tabular-nums",
                item.adopted && !active && "ring-1 ring-primary/70",
                item.rejected && !active && "opacity-40",
              )}
            >
              {index + 1}
              {item.adopted && <Check size={11} aria-hidden="true" />}
              {item.favorite && <Heart size={10} aria-hidden="true" className="fill-current" />}
            </Pill>
          )
        })}
      </div>
      {trailing && <div className="ml-auto flex flex-wrap items-center gap-2">{trailing}</div>}
    </div>
  )
}
