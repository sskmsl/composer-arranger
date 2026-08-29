import type { MainTab } from "@/app/App"
import type { ComposerProject } from "@/core/project"
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

export type CurrentCandidateGenerator =
  | "melody"
  | "phrase"
  | "signature"
  | "counter"
  | "decoration"
  | "accompaniment"

export interface CurrentCandidateResultItem {
  id: string
  sectionId: string
  sectionName: string
  generator: CurrentCandidateGenerator
  target: MainTab
  candidateCount: number
  latestBatchId: string | null
  applied: boolean
}

const CURRENT_CANDIDATE_TARGETS: Record<CurrentCandidateGenerator, MainTab> = {
  melody: "melody",
  phrase: "phrase",
  signature: "signature",
  counter: "counter",
  decoration: "decoration",
  accompaniment: "melody",
}

function latestBatch<T extends { batchId: string; createdAt: string }>(
  candidates: readonly T[],
): { batchId: string; count: number } | null {
  const latest = [...candidates].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0]
  if (!latest) return null
  return {
    batchId: latest.batchId,
    count: candidates.filter((candidate) => candidate.batchId === latest.batchId).length,
  }
}

/**
 * 現在保存されている候補をSection単位で一覧化する。
 * A/B/C画面へ一律に送らず、候補を実際に保持するGeneratorへ案内するための情報源。
 */
export function currentCandidateResultItems(
  project: ComposerProject,
): CurrentCandidateResultItem[] {
  const items: CurrentCandidateResultItem[] = []
  const pushCandidate = (
    sectionId: string,
    sectionName: string,
    generator: Exclude<CurrentCandidateGenerator, "accompaniment">,
    batch: { batchId: string; count: number } | null,
  ) => {
    if (!batch) return
    items.push({
      id: `${sectionId}:${generator}`,
      sectionId,
      sectionName,
      generator,
      target: CURRENT_CANDIDATE_TARGETS[generator],
      candidateCount: batch.count,
      latestBatchId: batch.batchId,
      applied:
        generator === "melody" &&
        Boolean(project.sectionMelodyAssignments[sectionId]),
    })
  }

  for (const section of project.sections) {
    pushCandidate(
      section.id,
      section.name,
      "melody",
      latestBatch(project.melodyVariants.filter((item) => item.sectionId === section.id)),
    )
    pushCandidate(
      section.id,
      section.name,
      "phrase",
      latestBatch(project.phraseCandidates.filter((item) => item.sectionId === section.id)),
    )
    pushCandidate(
      section.id,
      section.name,
      "signature",
      latestBatch(project.signaturePhraseCandidates.filter((item) => item.sectionId === section.id)),
    )
    pushCandidate(
      section.id,
      section.name,
      "counter",
      latestBatch((project.reactiveLayerCandidates ?? []).filter(
        (item) => item.sectionId === section.id && item.kind === "counter",
      )),
    )
    pushCandidate(
      section.id,
      section.name,
      "decoration",
      latestBatch((project.reactiveLayerCandidates ?? []).filter(
        (item) => item.sectionId === section.id && item.kind === "decoration",
      )),
    )

    if (project.sectionAccompanimentPatternAssignments[section.id]) {
      items.push({
        id: `${section.id}:accompaniment`,
        sectionId: section.id,
        sectionName: section.name,
        generator: "accompaniment",
        target: CURRENT_CANDIDATE_TARGETS.accompaniment,
        candidateCount: 1,
        latestBatchId: null,
        applied: true,
      })
    }
  }
  return items
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
