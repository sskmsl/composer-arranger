import type { ComposerProject } from "./project"
import { layersOf } from "./sectionLayers"

/** 読み込み／コード生成を問わず、現在採用中の主旋律が実在するかを判定する。 */
export function hasActiveLeadMelody(
  project: ComposerProject,
  sectionId?: string,
): boolean {
  // MIDI読込ではトラック判定が未確定でも、従来どおり原素材を保護する。
  if (project.sourceImport?.type === "midi") return true
  const sectionIds = sectionId ? [sectionId] : project.sections.map((section) => section.id)
  return sectionIds.some((candidateSectionId) => {
    const assignedId = project.sectionMelodyAssignments[candidateSectionId]
    const variant = project.melodyVariants.find(
      (candidate) => candidate.id === assignedId && candidate.sectionId === candidateSectionId,
    )
    return Boolean(variant && layersOf(variant).some(
      (layer) => layer.partRole === "lead" && layer.notes.length > 0,
    ))
  })
}
