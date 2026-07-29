import { createTechniqueLibrary } from "./techniqueLibrary"
import { resolveComposerRules } from "./ruleResolver"
import { compileTechniqueRules } from "./techniqueResolver"
import type {
  ComposerRuleContext,
  GenrePrinciple,
  ResolvedComposerRules,
} from "./types"

/**
 * 公開リポジトリには抽象化・検証済みTechniqueだけを置く。
 * 実名、参照曲、Genre Analysisの生データはreference-data/(Git管理外)に保持する。
 */
export const PUBLIC_TECHNIQUE_LIBRARY = createTechniqueLibrary()
export const PUBLIC_GENRE_PRINCIPLES: GenrePrinciple[] = []

export function resolvePublicComposerRules(
  context: ComposerRuleContext,
): ResolvedComposerRules {
  return resolveComposerRules(
    compileTechniqueRules(
      PUBLIC_TECHNIQUE_LIBRARY,
      PUBLIC_GENRE_PRINCIPLES,
    ),
    context,
  )
}
