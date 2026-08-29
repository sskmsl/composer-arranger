import type { MainTab } from "@/app/App"

const RESULT_LABELS: Record<MainTab, string> = {
  melody: "Melody",
  phrase: "Phrase",
  signature: "Signature",
  counter: "Counter",
  decoration: "Decoration",
  "ai-partner": "AI Partner",
  arrangement: "Arrangement",
  audition: "Audition",
}

export interface GenerationResultLink {
  tab: MainTab
  label: string
}

/**
 * 複数Generatorの実行結果を、最後の1件へ固定せず種類別の確認導線へ変換する。
 * Setの順序を保つため、実行順と画面上の表示順も一致する。
 */
export function generationResultLinks(
  targets: readonly MainTab[],
): GenerationResultLink[] {
  return [...new Set(targets)].map((tab) => ({
    tab,
    label: RESULT_LABELS[tab],
  }))
}
