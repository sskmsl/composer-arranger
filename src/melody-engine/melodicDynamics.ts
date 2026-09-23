import type { CandidateMelodyDNA, MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import type { Drama } from "./generationParams"

/**
 * 音数や音高を増やさず、StandardのGrowingサビに遅い盛り上がりと終端の緩みを付ける。
 * 専用の演奏カーブを持つCinematicや、早い頂点を意図した候補には重ねない。
 */
export function shapeGrowingMelodyDynamics(
  source: MelodyNote[],
  totalBeats: number,
  profile: MelodyGeneratorProfile = "standard",
  sectionRole?: SectionRole,
  drama?: Drama,
  dna?: CandidateMelodyDNA,
): MelodyNote[] {
  if (
    profile !== "standard" ||
    (sectionRole !== "chorus" && sectionRole !== "grand-chorus") ||
    drama !== "growing" ||
    dna?.climaxPlan.position === "early" ||
    totalBeats < 24
  ) return source

  const peak = 0.82
  return source.map(note => {
    if (note.locks.length > 0) return { ...note }
    const progress = Math.max(0, Math.min(1, note.startBeat / totalBeats))
    const change = progress <= peak
      ? -8 + 21 * (progress / peak)
      : 13 - 17 * ((progress - peak) / (1 - peak))
    return {
      ...note,
      velocity: Math.max(50, Math.min(110, Math.round(note.velocity + change))),
    }
  })
}
