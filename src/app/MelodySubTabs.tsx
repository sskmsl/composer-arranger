import type { ReactNode } from "react"
import type { MainTab } from "./App"
import { MELODY_SUB_TABS } from "./melodyTabs"

export function MelodySubTabs({ tab, onChange }: { tab: MainTab; onChange: (tab: MainTab) => void }) {
  // 聴き比べは主旋律の中の表示なので、主旋律を選択中として示す
  const active = tab === "audition" ? "melody" : tab
  return (
    <nav
      aria-label="旋律の作業"
      className="no-scrollbar flex shrink-0 items-end gap-1 overflow-x-auto border-b border-hairline bg-surface-black px-3 pt-2"
    >
      {MELODY_SUB_TABS.map((item) => {
        const selected = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            aria-current={selected ? "page" : undefined}
            title={item.description}
            onClick={() => onChange(item.id)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] transition ${
              selected
                ? "border-primary font-semibold text-body-on-dark"
                : "border-transparent text-body-muted hover:text-body-on-dark"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${item.dot}`} aria-hidden="true" />
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * 旋律タブの中央の列。上に作業の切り替え、下に各作業の画面を置く。
 * 左のセクション一覧・右の生成設定・下の再生バーは、どの作業でも共通のまま。
 */
export function MelodyColumn({
  tab,
  onChange,
  children,
}: {
  tab: MainTab
  onChange: (tab: MainTab) => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <MelodySubTabs tab={tab} onChange={onChange} />
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  )
}
