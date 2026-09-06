import type {
  ArrangementTrackId,
  FullSongArrangement,
  GeneratedArrangementTrack,
} from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import type { AiArrangementIntent } from "./types"

export interface DirectionAuditionRange {
  startBeat: number
  endBeat: number
  label: string
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 同じ相談の3案へ、順番と内容から別々の再現可能な試聴seedを割り当てる。 */
export function directionAuditionSeed(
  project: ComposerProject,
  requestId: string,
  intent: AiArrangementIntent,
  directionIndex: number,
): number {
  return hashText([
    project.projectId,
    requestId,
    directionIndex,
    intent.id,
    intent.generator,
    intent.density,
    intent.register,
    intent.motion,
    intent.rhythmCharacter,
    intent.silenceStrategy,
    intent.creativeRisk,
    intent.generationBrief,
  ].join("|"))
}

/** 比較時は共通の自動伴奏一式を除き、そのDirectionが実際に追加する役割だけを鳴らす。 */
export function directionAuditionTracks(
  tracks: readonly GeneratedArrangementTrack[],
  focusTrackIds: readonly ArrangementTrackId[],
): GeneratedArrangementTrack[] {
  const focused = new Set(focusTrackIds)
  return tracks.filter((track) => focused.has(track.id) && track.notes.length > 0)
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
