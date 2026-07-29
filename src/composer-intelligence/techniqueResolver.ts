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
  const principleByTechnique = new Map(
    principles.map((principle) => [principle.techniqueId, principle]),
  )
  return library.techniques.flatMap((technique) => {
    const principle = principleByTechnique.get(technique.id)
    if (!principle) return []
    const rule = ruleFromTechnique(technique, principle)
    return rule ? [rule] : []
  })
}
