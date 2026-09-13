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
import { hasActiveLeadMelody } from "@/core/melodyProtection"
import { arrangementSoundInstructionAppliesTo } from "@/core/arrangementIntent"
import { soundInstructionForIntent } from "./directionAudition"
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
  const section = before.project.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return { generated: false, target: null }
  const soundInstruction = soundInstructionForIntent(intent)
  const directedSoundApplies = arrangementSoundInstructionAppliesTo(
    soundInstruction,
    section.id,
    section.role,
    section.id,
  )
  const directedGenerator = !directedSoundApplies || !soundInstruction
    ? intent.generator
    : ["stabs", "pulse", "bell"].includes(soundInstruction.role)
      ? "signature"
      : ["counter", "strings"].includes(soundInstruction.role)
        ? "counter"
        : soundInstruction.role === "transition"
          ? "phrase"
          : ["pad", "bass"].includes(soundInstruction.role)
            ? "accompaniment"
            : intent.generator
  const effectiveIntent: AiArrangementIntent = directedGenerator === intent.generator
    ? intent
    : { ...intent, generator: directedGenerator }
  if (hasActiveLeadMelody(before.project, sectionId) && effectiveIntent.generator === "melody") {
    useProjectStore.setState({
      workflowNotice: "採用中の主旋律は変更・再生成しません。AIでは伴奏・つなぎ・装飾だけを追加します。",
    })
    return { generated: false, target: "arrangement" }
  }
  before.selectSection(sectionId)
  before.setGenerationSettings({
    density: effectiveIntent.density,
    rangePreset: effectiveIntent.register,
    drama: effectiveIntent.drama,
  })
  if (effectiveIntent.generator === "melody") {
    before.generateForSection(sectionId)
  } else if (effectiveIntent.generator === "phrase") {
    const length = phraseLengthForIntent(effectiveIntent, section.lengthBars)
    if (length) before.generatePhrasesForSection(sectionId, length)
  } else if (effectiveIntent.generator === "signature") {
    before.generateSignaturePhrasesForSection(
      sectionId,
      signatureLengthForIntent(effectiveIntent, section.lengthBars),
      signatureDirectionForIntent(effectiveIntent),
    )
  } else if (effectiveIntent.generator === "counter") {
    const counterStyle = effectiveIntent.techniques.includes("strings")
      ? "string-answer"
      : effectiveIntent.techniques.includes("analog-synth") || /synth|シンセ/i.test(effectiveIntent.soundPalette)
        ? "synth-whisper"
        : undefined
    before.generateCounterForSection(
      sectionId,
      counterStyle,
      effectiveIntent.approach === "surprise-tension"
        ? effectiveIntent.creativeRisk === "radical"
          ? "radical"
          : "bold"
        : "focused",
    )
  } else if (effectiveIntent.generator === "decoration") {
    before.generateDecorationsForSection(sectionId, decorationSettingsForIntent(effectiveIntent))
  } else if (
    effectiveIntent.generator === "accompaniment" &&
    effectiveIntent.accompanimentPatternId !== "none"
  ) {
    before.setSectionAccompanimentPattern(sectionId, effectiveIntent.accompanimentPatternId)
  }

  const after = useProjectStore.getState()
  const generated = effectiveIntent.generator === "melody"
    ? after.activeBatchId !== before.activeBatchId
    : effectiveIntent.generator === "phrase"
      ? after.activePhraseBatchId !== before.activePhraseBatchId
      : effectiveIntent.generator === "signature"
        ? after.activeSignaturePhraseBatchId !== before.activeSignaturePhraseBatchId
        : effectiveIntent.generator === "counter" || effectiveIntent.generator === "decoration"
          ? after.activeReactiveBatchId !== before.activeReactiveBatchId
          : effectiveIntent.generator === "accompaniment"
  if (generated) {
    const director = buildArrangementDirectorBlueprint(after.project)
    const orchestration = buildOrchestrationBlueprint(after.project, director)
    const part = performancePartForIntent(
      effectiveIntent,
      orchestration.sections.find((candidate) => candidate.sectionId === sectionId),
    )
    if (
      part
      && effectiveIntent.generator !== "rhythm"
      && effectiveIntent.generator !== "none"
    ) after.applyPerformanceToLatestGeneration(sectionId, effectiveIntent.generator, part)
  }
  return { generated, target: targetTabForIntent(effectiveIntent) }
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
