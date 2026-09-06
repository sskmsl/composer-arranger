import type { MelodyNote } from "@/core/melody"
import { candidatePlacement } from "@/core/candidatePlacement"
import type { Section } from "@/core/section"

export function CandidatePlacementHint({
  section,
  notes,
  beatsPerBar,
}: {
  section: Section
  notes: MelodyNote[]
  beatsPerBar: number
}) {
  const placement = candidatePlacement(section, notes, beatsPerBar)
  if (!placement) return null
  return (
    <p className="mt-2 rounded-sm bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary-on-dark">
      {placement.label}
    </p>
  )
}
