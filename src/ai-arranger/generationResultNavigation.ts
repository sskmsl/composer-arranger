import type { MainTab } from "@/app/App"
import type { ArrangementBatchActionResult } from "./arrangementActionExecution"
import type { WholeSongArrangementAction } from "./wholeSongDirectionPlan"

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

export type WholeSongGenerationResultStatus =
  | "candidate"
  | "applied"
  | "existing"
  | "preserved"
  | "unavailable"
  | "failed"

export interface WholeSongGenerationResultItem {
  actionId: string
  sectionId: string
  sectionName: string
  generator: WholeSongArrangementAction["generator"]
  purpose: string
  status: WholeSongGenerationResultStatus
  target: MainTab | null
}

function targetForGenerator(
  generator: WholeSongArrangementAction["generator"],
): MainTab | null {
  if (generator === "signature") return "signature"
  if (generator === "counter") return "counter"
  if (generator === "decoration") return "decoration"
  if (generator === "accompaniment") return "melody"
  return null
}

/** 全Sectionを、生成候補・直接適用・既存維持・追加なしまで含む確認一覧へ変換する。 */
export function wholeSongGenerationResultItems(
  actions: readonly WholeSongArrangementAction[],
  results: readonly ArrangementBatchActionResult[],
): WholeSongGenerationResultItem[] {
  const executionByActionId = new Map(
    results.map((result) => [result.actionId, result]),
  )
  return actions.map((action) => {
    const execution = executionByActionId.get(action.id)
    let status: WholeSongGenerationResultStatus
    if (action.status === "preserve") status = "preserved"
    else if (action.status === "already-active") status = "existing"
    else if (action.status === "unavailable") status = "unavailable"
    else if (!execution?.generated) status = "failed"
    else status = action.generator === "accompaniment" ? "applied" : "candidate"

    return {
      actionId: action.id,
      sectionId: action.sectionId,
      sectionName: action.sectionName,
      generator: action.generator,
      purpose: action.purpose,
      status,
      target:
        status === "candidate" || status === "applied" || status === "existing"
          ? execution?.target ?? targetForGenerator(action.generator)
          : null,
    }
  })
}
