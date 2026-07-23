import { useProjectStore } from "@/store/useProjectStore"
import type { MelodyVariant } from "@/core/melody"

export function useCandidateBatch(): MelodyVariant[] {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const activeBatchId = useProjectStore((s) => s.activeBatchId)
  if (!selectedSectionId) return []
  return project.melodyVariants
    .filter((v) => v.sectionId === selectedSectionId && (activeBatchId ? v.batchId === activeBatchId : false))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function useActiveVariant(): MelodyVariant | undefined {
  const project = useProjectStore((s) => s.project)
  const activeCandidateIndex = useProjectStore((s) => s.activeCandidateIndex)
  const batch = useCandidateBatch()
  if (batch.length > 0) return batch[Math.min(activeCandidateIndex, batch.length - 1)]
  if (project.activeMelodyId) return project.melodyVariants.find((v) => v.id === project.activeMelodyId)
  return undefined
}
