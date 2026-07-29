import type {
  ComposerRule,
  GenrePrinciple,
  TechniqueLibrary,
} from "./types"
import { ruleFromTechnique } from "./techniqueLibrary"

export function compileTechniqueRules(
  library: TechniqueLibrary,
  principles: GenrePrinciple[],
): ComposerRule[] {
  return library.techniques.flatMap((technique) => {
    const evidence = principles.filter(
      (principle) => principle.techniqueId === technique.id,
    )
    if (evidence.length === 0) return []
    const rule = ruleFromTechnique(technique, evidence)
    return rule ? [rule] : []
  })
}
