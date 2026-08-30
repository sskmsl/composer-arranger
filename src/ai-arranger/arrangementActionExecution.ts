import { useProjectStore } from "@/store/useProjectStore"
import type { MainTab } from "@/app/App"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import {
  decorationSettingsForIntent,
  performancePartForIntent,
  phraseLengthForIntent,
  signatureDirectionForIntent,
  signatureLengthForIntent,
  targetTabForIntent,
} from "./generationBridge"
import type { AiArrangementIntent } from "./types"
import { buildOrchestrationBlueprint } from "./orchestrationIntelligence"
import {
  intentForWholeSongAction,
  type WholeSongArrangementAction,
} from "./wholeSongDirectionPlan"

export interface ArrangementActionExecutionResult {
  generated: boolean
  target: MainTab | null
}

export interface ArrangementBatchExecutionResult {
  generatedCount: number
  skippedCount: number
  targets: MainTab[]
  actionIds: string[]
  results: ArrangementBatchActionResult[]
}

export interface ArrangementBatchActionResult
  extends ArrangementActionExecutionResult {
  actionId: string
  sectionId: string
}

/**
 * AI Partner / Whole Song Director が共用するGenerator実行経路。
 * 候補の自動採用は行わず、既存の候補プール・試聴・Set Activeへ接続する。
 */
export function executeAiArrangementIntent(
  sectionId: string,
  intent: AiArrangementIntent,
): ArrangementActionExecutionResult {
  if (intent.generator === "none" || intent.generator === "rhythm") {
    return { generated: false, target: targetTabForIntent(intent) }
  }
  const before = useProjectStore.getState()
  if (before.project.sourceImport?.type === "midi" && intent.generator === "melody") {
    useProjectStore.setState({
      workflowNotice: "原曲保護モードでは、読み込んだ主旋律を変更・再生成しません。補助パートを選んでください。",
    })
    return { generated: false, target: "arrangement" }
  }
  const section = before.project.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return { generated: false, target: null }

  before.selectSection(sectionId)
  before.setGenerationSettings({
    density: intent.density,
    rangePreset: intent.register,
    drama: intent.drama,
  })
  if (intent.generator === "melody") {
    before.generateForSection(sectionId)
  } else if (intent.generator === "phrase") {
    const length = phraseLengthForIntent(intent, section.lengthBars)
    if (length) before.generatePhrasesForSection(sectionId, length)
  } else if (intent.generator === "signature") {
    before.generateSignaturePhrasesForSection(
      sectionId,
      signatureLengthForIntent(intent, section.lengthBars),
      signatureDirectionForIntent(intent),
    )
  } else if (intent.generator === "counter") {
    const counterStyle = intent.techniques.includes("strings")
      ? "string-answer"
      : intent.techniques.includes("analog-synth") || /synth|シンセ/i.test(intent.soundPalette)
        ? "synth-whisper"
        : undefined
    before.generateCounterForSection(
      sectionId,
      counterStyle,
      intent.approach === "surprise-tension"
        ? intent.creativeRisk === "radical"
          ? "radical"
          : "bold"
        : "focused",
    )
  } else if (intent.generator === "decoration") {
    before.generateDecorationsForSection(sectionId, decorationSettingsForIntent(intent))
  } else if (
    intent.generator === "accompaniment" &&
    intent.accompanimentPatternId !== "none"
  ) {
    before.setSectionAccompanimentPattern(sectionId, intent.accompanimentPatternId)
  }

  const after = useProjectStore.getState()
  const generated = intent.generator === "melody"
    ? after.activeBatchId !== before.activeBatchId
    : intent.generator === "phrase"
      ? after.activePhraseBatchId !== before.activePhraseBatchId
      : intent.generator === "signature"
        ? after.activeSignaturePhraseBatchId !== before.activeSignaturePhraseBatchId
        : intent.generator === "counter" || intent.generator === "decoration"
          ? after.activeReactiveBatchId !== before.activeReactiveBatchId
          : intent.generator === "accompaniment"
  if (generated) {
    const director = buildArrangementDirectorBlueprint(after.project)
    const orchestration = buildOrchestrationBlueprint(after.project, director)
    const part = performancePartForIntent(
      intent,
      orchestration.sections.find((candidate) => candidate.sectionId === sectionId),
    )
    if (part) after.applyPerformanceToLatestGeneration(sectionId, intent.generator, part)
  }
  return { generated, target: targetTabForIntent(intent) }
}

/**
 * AI Partner・Director・Packageから同じ既存Generatorを実行する共通経路。
 * MelodyのSet Activeは行わず、Accompaniment以外は候補プールへ追加する。
 */
export function executeArrangementAction(
  action: WholeSongArrangementAction,
): ArrangementActionExecutionResult {
  if (action.status !== "available" || action.generator === "none") {
    return { generated: false, target: null }
  }
  return executeAiArrangementIntent(action.sectionId, intentForWholeSongAction(action))
}

/** Stage順に渡された全曲Actionを実行する。各候補は自動採用しない。 */
export function executeArrangementActions(
  actions: readonly WholeSongArrangementAction[],
): ArrangementBatchExecutionResult {
  const targets = new Set<MainTab>()
  const actionIds: string[] = []
  const results: ArrangementBatchActionResult[] = []
  let skippedCount = 0
  for (const action of actions) {
    let result: ArrangementActionExecutionResult
    try {
      result = executeArrangementAction(action)
    } catch {
      // 1 Sectionの候補生成失敗で、残りのSectionと全曲Arrangementまで
      // 中断しない。失敗Actionは生成保留として結果一覧へ残す。
      result = { generated: false, target: null }
    }
    results.push({
      actionId: action.id,
      sectionId: action.sectionId,
      ...result,
    })
    if (result.generated) actionIds.push(action.id)
    else skippedCount += 1
    if (result.target) targets.add(result.target)
  }
  return {
    generatedCount: actionIds.length,
    skippedCount,
    targets: [...targets],
    actionIds,
    results,
  }
}
