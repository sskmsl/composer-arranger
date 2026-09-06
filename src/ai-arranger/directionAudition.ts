import type {
  ArrangementGenerationDirective,
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

/**
 * AIのGenerator名を、全曲アレンジで必ず実音化できる補助パートへ対応付ける。
 * Transition / Decorationは主旋律の休符がない曲では空になるため、
 * 和音から生成できる役割を同じ案の補助として含める。
 */
export function directionAuditionRoleIds(
  intent: AiArrangementIntent,
): ArrangementTrackId[] {
  const roles: ArrangementTrackId[] = []
  if (intent.generator === "rhythm") roles.push("dr-kick", "dr-snare", "dr-closed-hat", "dr-field-drum")
  if (intent.generator === "accompaniment") roles.push("syn-bass", "syn-pulse")
  if (intent.generator === "melody") roles.push("str-violin-1", "syn-stabs")
  if (intent.generator === "phrase") roles.push("syn-transition-phrase", "syn-stabs")
  if (intent.generator === "counter") roles.push("str-cello", "str-viola")
  if (intent.generator === "signature") roles.push("syn-transition-phrase", "syn-high-glass", "syn-stabs")
  if (intent.generator === "decoration") roles.push("syn-high-glass", "syn-stabs")
  return roles
}

/** AIの案を、全曲試聴で実際に鳴らす役割へ変換する。 */
export function directionAuditionDirectiveForIntent(
  intent: AiArrangementIntent,
): ArrangementGenerationDirective {
  const roles = directionAuditionRoleIds(intent)
  const description = `${intent.generationBrief} ${intent.soundPalette} ${intent.techniques.join(" ")}`
  if (/string|violin|viola|cello|ストリング/i.test(description)) roles.push("str-cello", "str-viola", "str-violin-2", "str-violin-1")
  if (/bass|低音|ベース/i.test(description)) roles.push("syn-bass")
  if (/pad|パッド|空間/i.test(description)) roles.push("syn-dark-pad")
  const densityDelta = intent.density === "sparse" ? -8 : intent.density === "active" ? 8 : 0
  const dramaDelta = intent.drama === "restrained" ? -2 : intent.drama === "open" ? 5 : 0
  return {
    intention: `${intent.emotionalFunction}。${intent.generationBrief}`,
    character: intent.generator === "rhythm"
      ? "rhythmic"
      : intent.creativeRisk === "radical" || intent.creativeRisk === "bold"
        ? "dark-experimental"
        : /string|violin|viola|cello|ストリング/i.test(description)
          ? "cinematic"
          : intent.density === "sparse"
            ? "minimal"
            : "balanced",
    energyDelta: densityDelta + dramaDelta,
    add: [...new Set(roles)],
    surpriseLevel: intent.creativeRisk === "radical" ? 0.75 : intent.creativeRisk === "bold" ? 0.45 : 0.15,
  }
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
  auditionTracks: readonly GeneratedArrangementTrack[] = [],
): DirectionAuditionRange[] {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const excerptBeats = beatsPerBar * 4
  const totalBeats = arrangement.analysis.totalBeats
  if (totalBeats <= 0) return []
  const focusedNotes = auditionTracks.flatMap((track) => track.notes)
  if (focusedNotes.length > 0) {
    const sections = normalizeSectionTimeline(project.sections)
    const noteSections = sections
      .map((section) => {
        const startBeat = (section.startBar - 1) * beatsPerBar
        const endBeat = Math.min(totalBeats, startBeat + section.lengthBars * beatsPerBar)
        const notes = focusedNotes.filter((note) => note.startBeat < endBeat && note.startBeat + note.durationBeats > startBeat)
        return { section, startBeat, endBeat, notes }
      })
      .filter((candidate) => candidate.notes.length > 0)
    if (noteSections.length > 0) {
      const peakSectionId = arrangement.analysis.peakSectionId
      const first = noteSections[0]
      const strongest = [...noteSections].sort((left, right) =>
        Number(right.section.id === peakSectionId) - Number(left.section.id === peakSectionId)
        || right.notes.length - left.notes.length
        || right.startBeat - left.startBeat,
      )[0]
      const selected = strongest.section.id === first.section.id ? [first] : [first, strongest]
      return selected.map(({ section, startBeat, endBeat, notes }) => {
        const firstNoteBeat = Math.min(...notes.map((note) => note.startBeat))
        const lastPossibleStart = Math.max(startBeat, endBeat - excerptBeats)
        const windowStart = Math.min(
          lastPossibleStart,
          Math.max(startBeat, Math.floor(firstNoteBeat / beatsPerBar) * beatsPerBar - beatsPerBar),
        )
        return {
          startBeat: windowStart,
          endBeat: Math.min(endBeat, windowStart + excerptBeats),
          label: `${section.name}・提案音を含む部分`,
        }
      })
    }
  }
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
