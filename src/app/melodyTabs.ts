import type { MainTab } from "./App"

/** 旋律タブの中の作業。すべて主旋律を中心にした作業なので、同じ画面の中で切り替える */
export const MELODY_SUB_TABS: { id: MainTab; label: string; dot: string; description: string }[] = [
  { id: "melody", label: "主旋律", dot: "bg-primary", description: "セクション全体のメロディ" },
  { id: "counter", label: "対旋律", dot: "bg-amber-400", description: "主旋律へ応答する第二の線" },
  { id: "decoration", label: "装飾", dot: "bg-fuchsia-400", description: "隙間を生かす短い演出" },
  { id: "signature", label: "イントロ", dot: "bg-sky-300", description: "記憶に残る導入フレーズ" },
  { id: "phrase", label: "短いフレーズ", dot: "bg-white/50", description: "2〜8小節の着想" },
]

/** 旋律タブに含まれる画面(聴き比べは主旋律の中の表示) */
export const MELODY_GROUP_TABS: readonly MainTab[] = ["melody", "counter", "decoration", "signature", "phrase", "audition"]

export function isMelodyGroupTab(tab: MainTab): boolean {
  return MELODY_GROUP_TABS.includes(tab)
}
