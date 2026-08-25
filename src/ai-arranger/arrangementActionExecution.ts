import { useProjectStore } from "@/store/useProjectStore"
import type { MainTab } from "@/app/App"
import { buildArrangementDirectorBlueprint } from "./arrangementDirector"
import {
  decorationSettingsForIntent,
  performancePartForIntent,
  signatureDirectionForIntent,
  signatureLengthForIntent,
  targetTabForIntent,
} from "./generationBridge"
import { buildOrchestrationBlueprint } from "./orchestrationIntelligence"
import {
  intentForWholeSongAction,
  type WholeSongArrangementAction,
} from "./wholeSongDirectionPlan"

export interface ArrangementActionExecutionResult {
  generated: boolean
  target: MainTab | null
}

/**
 * DirectorとPackageの両方から同じ既存Generatorを実行する唯一の経路。
 * MelodyのSet Activeは行わず、Accompaniment以外は候補プールへ追加する。
 */
export function executeArrangementAction(
  action: WholeSongArrangementAction,
): ArrangementActionExecutionResult {
  if (action.status !== "available" || action.generator === "none") {
    return { generated: false, target: null }
  }
  const intent = intentForWholeSongAction(action)
  const before = useProjectStore.getState()
  before.selectSection(action.sectionId)
  before.setGenerationSettings({
    density: intent.density,
    rangePreset: intent.register,
    drama: intent.drama,
  })
  if (intent.generator === "signature") {
    const section = before.project.sections.find((candidate) => candidate.id === action.sectionId)
    if (section) {
      before.generateSignaturePhrasesForSection(
        action.sectionId,
        signatureLengthForIntent(intent, section.lengthBars),
        signatureDirectionForIntent(intent),
      )
    }
  } else if (intent.generator === "counter") {
    before.generateCounterForSection(action.sectionId)
  } else if (intent.generator === "decoration") {
    before.generateDecorationsForSection(action.sectionId, decorationSettingsForIntent(intent))
  } else if (intent.generator === "accompaniment" && intent.accompanimentPatternId !== "none") {
    before.setSectionAccompanimentPattern(action.sectionId, intent.accompanimentPatternId)
  }
  const after = useProjectStore.getState()
  const generated = intent.generator === "signature"
    ? after.activeSignaturePhraseBatchId !== before.activeSignaturePhraseBatchId
    : intent.generator === "counter" || intent.generator === "decoration"
      ? after.activeReactiveBatchId !== before.activeReactiveBatchId
      : intent.generator === "accompaniment"
  if (generated) {
    const director = buildArrangementDirectorBlueprint(after.project)
    const orchestration = buildOrchestrationBlueprint(after.project, director)
    const part = performancePartForIntent(
      intent,
      orchestration.sections.find((candidate) => candidate.sectionId === action.sectionId),
    )
    if (part) after.applyPerformanceToLatestGeneration(action.sectionId, action.generator, part)
  }
  return { generated, target: targetTabForIntent(intent) }
}
