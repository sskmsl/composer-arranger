import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"

export interface DirectionAuditionRange {
  startBeat: number
  endBeat: number
  label: string
}

/**
 * 3案を同じ条件で比べるため、冒頭と曲の頂点を各4小節だけ聴かせる。
 * 頂点が冒頭区間と重なる短い曲では、重複再生せず冒頭だけを返す。
 */
export function directionAuditionRanges(
  project: ComposerProject,
  arrangement: FullSongArrangement,
): DirectionAuditionRange[] {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const excerptBeats = beatsPerBar * 4
  const totalBeats = arrangement.analysis.totalBeats
  if (totalBeats <= 0) return []
  const ranges: DirectionAuditionRange[] = [{
    startBeat: 0,
    endBeat: Math.min(totalBeats, excerptBeats),
    label: "冒頭4小節",
  }]
  const peakSectionId = arrangement.analysis.peakSectionId
  const peakSection = normalizeSectionTimeline(project.sections).find(
    (section) => section.id === peakSectionId,
  )
  if (!peakSection) return ranges
  const peakStart = (peakSection.startBar - 1) * beatsPerBar
  const peakEnd = Math.min(
    totalBeats,
    peakStart + Math.min(excerptBeats, peakSection.lengthBars * beatsPerBar),
  )
  if (peakEnd <= ranges[0].endBeat + beatsPerBar) return ranges
  ranges.push({
    startBeat: peakStart,
    endBeat: peakEnd,
    label: `${peakSection.name}の冒頭4小節`,
  })
  return ranges
}
