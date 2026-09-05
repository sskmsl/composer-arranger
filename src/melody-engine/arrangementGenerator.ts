import { buildArrangementDirectorBlueprint } from "@/ai-arranger/arrangementDirector"
import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import type { ChordEvent, ComposerProject } from "@/core/project"
import {
  ARRANGEMENT_TRACK_NAMES,
  type ArrangementAnalysis,
  type ArrangementAnalysisSection,
  type ArrangementCandidateCharacter,
  type ArrangementGenerationDirective,
  type ArrangementPlan,
  type ArrangementRegenerationTarget,
  type ArrangementSectionPlan,
  type ArrangementTrackId,
  type ArrangementTransitionCandidate,
  type FullSongArrangement,
  type GeneratedArrangementNote,
  type GeneratedArrangementTrack,
} from "@/core/arrangementGeneration"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial, normalizeSectionTimeline } from "@/core/sectionTimeline"

const DRUM_PITCH: Partial<Record<ArrangementTrackId, number>> = {
  "dr-kick": 36,
  "dr-snare": 38,
  "dr-closed-hat": 42,
  "dr-open-hat": 46,
  "dr-low-tom": 45,
  "dr-high-tom": 50,
  "dr-field-drum": 40,
  "dr-gran-cassa": 35,
  "dr-crash": 49,
}

const TRACK_FAMILY: Record<ArrangementTrackId, GeneratedArrangementTrack["family"]> = {
  "dr-kick": "drums", "dr-snare": "drums", "dr-closed-hat": "drums",
  "dr-open-hat": "drums", "dr-low-tom": "drums", "dr-high-tom": "drums",
  "dr-field-drum": "drums", "dr-gran-cassa": "drums", "dr-crash": "drums",
  "syn-bass": "bass", "syn-pulse": "synth", "syn-stabs": "synth", "syn-dark-pad": "synth",
  "syn-high-glass": "synth", "syn-transition-phrase": "transition",
  "syn-final-lift": "synth", "str-cello": "strings", "str-viola": "strings",
  "str-violin-2": "strings", "str-violin-1": "strings", "str-upper": "strings",
}

const TRACK_PURPOSE: Record<ArrangementTrackId, string> = {
  "dr-kick": "曲の重心と歩幅", "dr-snare": "拍節の輪郭", "dr-closed-hat": "時間の粒度",
  "dr-open-hat": "Sectionの開放", "dr-low-tom": "境界へ向かう低い運動",
  "dr-high-tom": "フィルの上方向の動き", "dr-field-drum": "人間的な緊張と予告",
  "dr-gran-cassa": "Section境界の映画的重量", "dr-crash": "温存した入口の強調",
  "syn-bass": "和声の重力と次コードへの方向", "syn-pulse": "周期と推進力",
  "syn-stabs": "休符と裏拍で輪郭を作る疎な和音アクセント",
  "syn-dark-pad": "共通音を残す背景空間", "syn-high-glass": "未使用高域の短い反射",
  "syn-transition-phrase": "主旋律の休符から次Sectionへ渡す短い因果",
  "syn-final-lift": "最終ピークだけに開く上方向の解放",
  "str-cello": "低中域の持続と内的な動き", "str-viola": "内声の緊張",
  "str-violin-2": "中高域の連続性", "str-violin-1": "感情点へ向かう上声",
  "str-upper": "クライマックスでのみ現れる希少な上声",
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function pc(value: number): number {
  return ((value % 12) + 12) % 12
}

function midiForPc(pitchClass: number, around: number): number {
  let pitch = Math.round(around)
  pitch += (pitchClass - pc(pitch) + 12) % 12
  if (pitch - around > 6) pitch -= 12
  return Math.max(0, Math.min(127, pitch))
}

function sectionOffset(startBar: number, beatsPerBar: number): number {
  return (startBar - 1) * beatsPerBar
}

function notesInRange(notes: MelodyNote[], start: number, end: number): MelodyNote[] {
  return notes.filter((note) => note.startBeat < end && note.startBeat + note.durationBeats > start)
}

function intervalSignature(notes: MelodyNote[]): string {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  return sorted.slice(1).map((note, index) => note.pitch - sorted[index].pitch).join(",")
}

function repetitionScore(signature: string, all: string[]): number {
  if (!signature) return 0
  const matches = all.filter((value) => value === signature).length
  return Math.max(0, Math.min(1, (matches - 1) / Math.max(1, all.length - 1)))
}

function semanticRoleFor(section: ComposerProject["sections"][number]) {
  const name = section.name.toLocaleLowerCase()
  if (/final\s*hold|ending hold|終止保持/.test(name)) return "outro" as const
  if (/intro.*reprise|reprise.*intro|reprise|回帰/.test(name)) return "reprise" as const
  if (/final|last chorus|grand|大サビ|最終/.test(name) || section.role === "grand-chorus") return "final" as const
  if (/breakdown|break down|ブレイクダウン/.test(name) || section.role === "breakdown-chorus") return "breakdown" as const
  if (/build|ビルド/.test(name)) return "build" as const
  if (/pre|pre-chorus|bメロ|サビ前/.test(name) || section.role === "pre-chorus") return "pre" as const
  if (/chorus|サビ/.test(name) || section.role === "chorus") return "chorus" as const
  if (/bridge|ブリッジ|間奏/.test(name) || section.role === "bridge") return "bridge" as const
  if (/intro|イントロ|導入/.test(name) || section.role === "intro") return "intro" as const
  if (/verse|aメロ|ヴァース/.test(name) || section.role === "verse") return "verse" as const
  if (/outro|エンディング|アウトロ/.test(name) || section.role === "outro") return "outro" as const
  return "other" as const
}

function semanticBaseEnergy(role: ReturnType<typeof semanticRoleFor>, occurrence: number): number {
  if (role === "intro") return 26
  if (role === "verse") return 36 + Math.min(10, (occurrence - 1) * 7)
  if (role === "pre") return 54 + Math.min(10, (occurrence - 1) * 7)
  if (role === "chorus") return 68 + Math.min(15, (occurrence - 1) * 10)
  if (role === "breakdown") return 30
  if (role === "bridge") return 48
  if (role === "build") return 64
  if (role === "final") return 100
  if (role === "reprise") return 40
  if (role === "outro") return 24
  return 44
}

export function analyzeFullSongArrangement(project: ComposerProject): ArrangementAnalysis {
  const sections = normalizeSectionTimeline(project.sections)
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const material = buildSongPlaybackMaterial(project)
  const director = buildArrangementDirectorBlueprint(project)
  const roleOccurrence = new Map<string, number>()
  const chordSignatures = sections.map((section) => project.chords
    .filter((chord) => chord.sectionId === section.id)
    .sort((a, b) => a.startBeat - b.startBeat)
    .map((chord) => chord.symbol).join("|"))
  const melodySignatures = sections.map((section) => {
    const start = sectionOffset(section.startBar, beatsPerBar)
    return intervalSignature(notesInRange(material.lead, start, start + section.lengthBars * beatsPerBar))
  })
  const semanticRoles = sections.map(semanticRoleFor)
  const semanticFinal = [...sections].reverse().find((section) => semanticRoleFor(section) === "final")
  const lastChorus = [...sections].reverse().find((section) => semanticRoleFor(section) === "chorus")
  const climaxId = semanticFinal?.id ?? lastChorus?.id ?? director.climaxSectionId
  let previousEnergy: number | null = null
  let previousSemanticRole: ArrangementAnalysisSection["semanticRole"]
  let previousWasInferred = false
  let semanticSegmentIndex = 0
  const analysisSections: ArrangementAnalysisSection[] = sections.map((section, order) => {
    const semanticRole = semanticRoles[order]
    const isInferredSegment = project.sourceImport?.sectionsFromMarkers === false && section.id.startsWith("inferred:")
    if (semanticRole === previousSemanticRole && isInferredSegment && previousWasInferred) semanticSegmentIndex += 1
    else semanticSegmentIndex = 0
    const occurrence = semanticSegmentIndex === 0
      ? (roleOccurrence.get(semanticRole) ?? 0) + 1
      : roleOccurrence.get(semanticRole) ?? 1
    roleOccurrence.set(semanticRole, occurrence)
    previousSemanticRole = semanticRole
    previousWasInferred = isInferredSegment
    const directorEnergy = director.sections.find((plan) => plan.sectionId === section.id)?.targetEnergy ?? 2
    const semanticEnergy = semanticBaseEnergy(semanticRole, occurrence)
    const energy = section.id === climaxId
      ? 100
      : Math.max(10, Math.min(94, Math.round(semanticEnergy * 0.82 + directorEnergy * 20 * 0.18)))
    const start = sectionOffset(section.startBar, beatsPerBar)
    const end = start + section.lengthBars * beatsPerBar
    const melody = notesInRange(material.lead, start, end)
    const sounding = melody.reduce((sum, note) => sum + Math.min(note.durationBeats, Math.max(0, end - note.startBeat)), 0)
    const melodyRange = melody.length > 0
      ? { low: Math.min(...melody.map((note) => note.pitch)), high: Math.max(...melody.map((note) => note.pitch)) }
      : null
    const availableRegisters: ArrangementAnalysisSection["availableRegisters"] = ["low", "middle", "high"]
      .filter((register) => {
        if (!melodyRange) return true
        if (register === "low") return melodyRange.low > 52
        if (register === "middle") return melodyRange.low > 66 || melodyRange.high < 55
        return melodyRange.high < 78
      }) as ArrangementAnalysisSection["availableRegisters"]
    const energyDelta = previousEnergy === null ? 0 : energy - previousEnergy
    previousEnergy = energy
    return {
      sectionId: section.id,
      sectionName: section.name,
      sectionRole: section.role,
      order,
      occurrence,
      semanticSegmentIndex,
      energy,
      energyDelta,
      melodyRange,
      melodyRestRatio: Math.max(0, Math.min(1, 1 - sounding / Math.max(1, end - start))),
      chordRepetition: repetitionScore(chordSignatures[order], chordSignatures),
      melodyRepetition: repetitionScore(melodySignatures[order], melodySignatures),
      availableRegisters,
      semanticRole,
    }
  })
  return {
    version: "1.0.0",
    bpm: project.song.tempo,
    key: project.song.key,
    timeSignature: project.song.timeSignature,
    totalBeats: material.totalBeats,
    peakSectionId: climaxId,
    sections: analysisSections,
  }
}

function rolesFor(section: ArrangementAnalysisSection, isPeak: boolean): ArrangementTrackId[] {
  const roles: ArrangementTrackId[] = []
  const semantic = section.semanticRole ?? "other"
  const restAllowsColour = section.melodyRestRatio >= 0.18 && section.availableRegisters.includes("high")
  if (semantic === "intro") {
    roles.push("syn-dark-pad", "syn-bass", "dr-kick")
    if ((section.semanticSegmentIndex ?? 0) > 0) roles.push("dr-snare")
    if (restAllowsColour) roles.push("syn-high-glass")
  } else if (semantic === "verse") {
    roles.push("dr-kick", "dr-snare", "dr-closed-hat", "syn-bass", "syn-dark-pad")
    if (section.occurrence > 1) roles.push("syn-pulse", "dr-field-drum")
  } else if (semantic === "pre") {
    roles.push("dr-kick", "dr-snare", "dr-closed-hat", "dr-field-drum", "syn-bass", "syn-pulse", "str-cello", "syn-transition-phrase")
    if (section.occurrence > 1) roles.push("str-viola")
  } else if (semantic === "chorus") {
    roles.push("dr-kick", "dr-snare", "dr-closed-hat", "syn-bass", "syn-dark-pad", "syn-stabs")
    if (section.occurrence > 1) roles.push("dr-open-hat", "dr-field-drum", "syn-pulse", "str-cello", "str-violin-1")
  } else if (semantic === "breakdown") {
    roles.push("syn-dark-pad", "syn-bass")
    if (restAllowsColour) roles.push("syn-high-glass")
  } else if (semantic === "bridge") {
    roles.push("syn-dark-pad", "str-cello", "str-viola")
    if (section.energyDelta > 0) roles.push("syn-transition-phrase")
  } else if (semantic === "build") {
    roles.push("dr-kick", "dr-snare", "dr-closed-hat", "dr-field-drum", "syn-bass", "syn-pulse", "str-cello", "syn-transition-phrase")
  } else if (semantic === "final" || isPeak) {
    roles.push(
      "dr-kick", "dr-snare", "dr-closed-hat", "dr-open-hat", "dr-low-tom", "dr-high-tom",
      "dr-gran-cassa", "dr-crash", "syn-bass", "syn-pulse", "syn-dark-pad",
      "str-cello", "str-viola", "str-violin-1", "str-upper", "syn-final-lift",
    )
  } else if (semantic === "reprise") {
    roles.push("syn-dark-pad")
    if (restAllowsColour) roles.push("syn-high-glass")
  } else if (semantic === "outro") {
    roles.push("syn-dark-pad")
  } else {
    roles.push("dr-kick", "syn-bass")
    if (section.energy >= 55) roles.push("dr-snare", "syn-pulse")
  }
  return [...new Set(roles)]
}

function developmentStageFor(section: ArrangementAnalysisSection): 0 | 1 | 2 {
  if (section.semanticRole === "final") return 2
  return Math.min(2, Math.max(0, section.occurrence - 1)) as 0 | 1 | 2
}

function grooveFamilyFor(section: ArrangementAnalysisSection) {
  if (section.semanticRole === "intro" || section.semanticRole === "reprise" || section.semanticRole === "outro") return "suspended" as const
  if (section.semanticRole === "breakdown" || section.semanticRole === "bridge") return "broken" as const
  if (section.semanticRole === "pre" || section.semanticRole === "build") return "building" as const
  if (section.semanticRole === "final") return "release" as const
  if (section.semanticRole === "chorus") return "driving" as const
  return "restrained" as const
}

function bassStrategyFor(section: ArrangementAnalysisSection) {
  if (section.semanticRole === "intro" || section.semanticRole === "breakdown" || section.semanticRole === "outro") return "sustain" as const
  if (section.semanticRole === "verse") return section.occurrence > 1 ? "syncopated" as const : "melodic-pulse" as const
  if (section.semanticRole === "pre" || section.semanticRole === "build") return "approach-led" as const
  if (section.semanticRole === "chorus" || section.semanticRole === "final") return "octave-drive" as const
  return "melodic-pulse" as const
}

function harmonyStrategyFor(section: ArrangementAnalysisSection) {
  if (["intro", "breakdown", "bridge", "reprise", "outro"].includes(section.semanticRole ?? "")) return "pedal-space" as const
  if (section.semanticRole === "verse") return section.occurrence > 1 ? "sparse-stabs" as const : "slow-voice-leading" as const
  if (section.semanticRole === "final") return "register-expansion" as const
  if (section.semanticRole === "chorus") return "sparse-stabs" as const
  return "slow-voice-leading" as const
}

function roleEntryBeatsFor(
  section: ArrangementAnalysisSection,
  activeRoles: ArrangementTrackId[],
  sectionLengthBeats: number,
  beatsPerBar: number,
): Partial<Record<ArrangementTrackId, number>> {
  const entries: Partial<Record<ArrangementTrackId, number>> = {}
  if (section.semanticRole === "intro" && sectionLengthBeats >= beatsPerBar * 8) {
    if ((section.semanticSegmentIndex ?? 0) === 0) {
      if (activeRoles.includes("syn-bass")) entries["syn-bass"] = beatsPerBar * 4
      if (activeRoles.includes("dr-kick")) entries["dr-kick"] = beatsPerBar * 8
    }
    if ((section.semanticSegmentIndex ?? 0) > 0 && activeRoles.includes("dr-snare")) entries["dr-snare"] = beatsPerBar * 4
    if (activeRoles.includes("syn-high-glass")) entries["syn-high-glass"] = (section.semanticSegmentIndex ?? 0) === 0 ? beatsPerBar * 6 : beatsPerBar * 4
  }
  if (section.semanticRole === "pre" || section.semanticRole === "build") {
    if (activeRoles.includes("dr-closed-hat")) entries["dr-closed-hat"] = beatsPerBar
    if (activeRoles.includes("dr-field-drum")) entries["dr-field-drum"] = Math.max(0, sectionLengthBeats - beatsPerBar * 2)
    if (activeRoles.includes("syn-transition-phrase")) entries["syn-transition-phrase"] = Math.max(0, sectionLengthBeats - beatsPerBar * 2)
  }
  if (section.semanticRole === "final") {
    if (activeRoles.includes("str-upper")) entries["str-upper"] = beatsPerBar * 2
    if (activeRoles.includes("syn-final-lift")) entries["syn-final-lift"] = Math.max(beatsPerBar * 4, sectionLengthBeats - beatsPerBar * 8)
  }
  return entries
}

function transitionCandidate(
  project: ComposerProject,
  section: ArrangementAnalysisSection,
  next: ArrangementAnalysisSection | undefined,
  character: ArrangementCandidateCharacter,
  seed: number,
): ArrangementTransitionCandidate {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const source = project.sections.find((candidate) => candidate.id === section.sectionId)!
  const offset = sectionOffset(source.startBar, beatsPerBar)
  const end = offset + source.lengthBars * beatsPerBar
  const nextSection = next ? project.sections.find((candidate) => candidate.id === next.sectionId) : undefined
  const nextChord = nextSection
    ? project.chords.filter((chord) => chord.sectionId === nextSection.id).sort((a, b) => a.startBeat - b.startBeat)[0]
    : undefined
  const parsed = nextChord ? parseChordSymbol(nextChord.symbol, nextChord.bass ?? undefined) : null
  const targetPc = parsed?.tones[0]?.pitchClass ?? 9
  const target = midiForPc(targetPc, character === "surprise" ? 81 : 72)
  const reason = character === "safe"
    ? `主旋律の休符を使い、次の${next?.sectionName ?? "終止"}のコードトーンへ順次接続する`
    : character === "edge"
      ? `次の${next?.sectionName ?? "終止"}へ半音で解決する非和声音を、休符の末尾だけに置く`
      : `未使用高域を一瞬だけ開き、次の${next?.sectionName ?? "終止"}の入口で解決して落差を記憶させる`
  if (!next || section.melodyRestRatio < 0.08) {
    return { id: `${section.sectionId}:${character}:silence`, sectionId: section.sectionId, character, kind: "silence", reason: "主旋律の余白が不足しているため、音を足さないことを最も強い選択とする", notes: [] }
  }
  const intervals = character === "safe" ? [-4, -2, 0] : character === "edge" ? [-3, -1, 0] : [7, 1, 0]
  const start = end - (character === "surprise" ? 1.5 : 1.25)
  const notes = intervals.map((interval, index): MelodyNote => ({
    id: `transition:${section.sectionId}:${character}:${seed}:${index}`,
    startBeat: start + index * 0.375,
    durationBeats: index === intervals.length - 1 ? 0.5 : 0.25,
    pitch: Math.max(0, Math.min(127, target + interval)),
    velocity: 58 + index * 8 + (character === "surprise" ? 6 : 0),
    locks: [],
    plannedToneRole: index === intervals.length - 1 ? "anticipation" : character === "safe" ? "passing-tone" : "approach-tone",
    plannedResolution: index === intervals.length - 1 ? { targetPitchClass: targetPc, targetBeat: end, maximumDelayBeats: 1 } : undefined,
  }))
  return {
    id: `${section.sectionId}:${character}:${seed}`,
    sectionId: section.sectionId,
    character,
    kind: character === "safe" ? "ascending" : character === "edge" ? "chromatic-approach" : "synth-fill",
    reason,
    notes,
  }
}

function decorationCandidate(
  project: ComposerProject,
  section: ArrangementAnalysisSection,
  character: ArrangementCandidateCharacter,
  seed: number,
): ArrangementTransitionCandidate {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const source = project.sections.find((candidate) => candidate.id === section.sectionId)!
  const offset = sectionOffset(source.startBar, beatsPerBar)
  const length = source.lengthBars * beatsPerBar
  const chord = project.chords.filter((candidate) => candidate.sectionId === section.sectionId).sort((a, b) => a.startBeat - b.startBeat).at(-1)
  const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
  const chordPc = parsed?.tones[1]?.pitchClass ?? parsed?.rootPc ?? 9
  const tensionPc = parsed?.tensions[0]?.pitchClass ?? pc((parsed?.rootPc ?? chordPc) + 2)
  if (section.melodyRestRatio < 0.12 || !section.availableRegisters.includes("high")) {
    return { id: `${section.sectionId}:decoration:${character}:silence`, sectionId: section.sectionId, character, kind: "silence", reason: "主旋律の休符または高域の余白が不足しているため、装飾を置かない", notes: [] }
  }
  const pitch = character === "safe"
    ? midiForPc(chordPc, 84)
    : character === "edge"
      ? midiForPc(tensionPc, 84)
      : midiForPc(chordPc, 91)
  const reason = character === "safe"
    ? "ボーカル休符の高域にコードの色を一音だけ反射させる"
    : character === "edge"
      ? "9thを短く置き、同じ高域のコードトーンへ解決して緊張を残さない"
      : "直前まで未使用だった最高域を一度だけ開き、反復Sectionに新しい記憶点を作る"
  const startBeat = offset + Math.max(0, length - beatsPerBar * 0.75)
  const candidateNotes: MelodyNote[] = character === "edge"
    ? [
        {
          id: `decoration:${section.sectionId}:${character}:${seed}:tension`,
          startBeat,
          durationBeats: 0.25,
          pitch,
          velocity: 58,
          locks: [],
          plannedToneRole: "appoggiatura",
          plannedResolution: { targetPitchClass: chordPc, targetBeat: startBeat + 0.5, maximumDelayBeats: 0.75 },
        },
        {
          id: `decoration:${section.sectionId}:${character}:${seed}:resolution`,
          startBeat: startBeat + 0.5,
          durationBeats: 0.375,
          pitch: midiForPc(chordPc, pitch),
          velocity: 48,
          locks: [],
          plannedToneRole: "chord-tone",
        },
      ]
    : [{
        id: `decoration:${section.sectionId}:${character}:${seed}`,
        startBeat,
        durationBeats: character === "surprise" ? 0.125 : 0.25,
        pitch,
        velocity: character === "surprise" ? 72 : 50,
        locks: [],
        plannedToneRole: character === "safe" ? "chord-tone" : "tension-hold",
      }]
  return {
    id: `${section.sectionId}:decoration:${character}:${seed}`,
    sectionId: section.sectionId,
    character,
    kind: "bell-hit",
    reason,
    notes: candidateNotes,
  }
}

export function buildFullSongArrangementPlan(
  project: ComposerProject,
  analysis: ArrangementAnalysis,
  seed = hashText(`${project.projectId}:${project.title}:${project.song.tempo}`),
  brief = project.arrangementDirectorWorkspace?.brief ?? "",
  directive?: ArrangementGenerationDirective,
): ArrangementPlan {
  const asksSurprise = (directive?.surpriseLevel ?? 0) >= 0.35 || /surprise|意外|大胆|毒|不穏/i.test(brief)
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  return {
    version: "1.0.0",
    brief,
    seed,
    directive,
    sections: analysis.sections.map((section, index): ArrangementSectionPlan => {
      const applies = !directive?.sectionId || directive.sectionId === section.sectionId
      const effectiveEnergy = applies
        ? Math.max(10, Math.min(100, section.energy + (directive?.energyDelta ?? 0)))
        : section.energy
      const effectiveSection = { ...section, energy: effectiveEnergy }
      const isPeak = section.sectionId === analysis.peakSectionId
      const transitionCandidates = (["safe", "edge", "surprise"] as const).map((character) =>
        transitionCandidate(project, section, analysis.sections[index + 1], character, seed))
      const decorationCandidates = (["safe", "edge", "surprise"] as const).map((character) =>
        decorationCandidate(project, section, character, seed))
      const hasTransition = transitionCandidates.some((candidate) => candidate.notes.length > 0)
      const selectedTransitionCharacter: ArrangementSectionPlan["selectedTransitionCharacter"] = !hasTransition
        ? "silence"
        : asksSurprise && (section.energyDelta >= 10 || section.melodyRestRatio >= 0.25)
          ? "surprise"
          : section.energyDelta >= 15 ? "edge" : "safe"
      const hasDecoration = decorationCandidates.some((candidate) => candidate.notes.length > 0)
      const selectedDecorationCharacter: ArrangementSectionPlan["selectedDecorationCharacter"] = !hasDecoration
        ? "silence"
        : asksSurprise && section.occurrence > 1
          ? "surprise"
          : section.energy >= 65 ? "edge" : "safe"
      const activeRoles = rolesFor(effectiveSection, isPeak)
      const character = applies ? directive?.character : undefined
      if (character === "minimal") {
        const removable = new Set<ArrangementTrackId>(["dr-closed-hat", "dr-open-hat", "syn-pulse", "syn-stabs", "str-viola", "str-violin-1", "str-upper"])
        for (let roleIndex = activeRoles.length - 1; roleIndex >= 0; roleIndex -= 1) {
          if (removable.has(activeRoles[roleIndex]) && !(directive?.preserve ?? []).includes(activeRoles[roleIndex])) activeRoles.splice(roleIndex, 1)
        }
      } else if (character === "cinematic" && ["pre", "chorus", "bridge", "build", "final"].includes(section.semanticRole ?? "")) {
        activeRoles.push("str-cello", "str-viola")
        if (section.occurrence > 1 || isPeak) activeRoles.push("str-violin-1")
        if (isPeak) activeRoles.push("dr-gran-cassa", "str-upper")
      } else if (character === "rhythmic" && !["reprise", "outro"].includes(section.semanticRole ?? "")) {
        activeRoles.push("dr-kick", "syn-bass")
        if (effectiveEnergy >= 48) activeRoles.push("dr-snare", "dr-closed-hat", "syn-pulse")
        if (effectiveEnergy >= 65) activeRoles.push("dr-open-hat", "syn-stabs")
      } else if (character === "dark-experimental" && section.melodyRestRatio >= 0.12) {
        activeRoles.push("syn-stabs", "syn-high-glass")
        if (analysis.sections[index + 1]) activeRoles.push("syn-transition-phrase")
      }
      if (applies) activeRoles.push(...(directive?.add ?? []))
      if (selectedTransitionCharacter === "silence") {
        const index = activeRoles.indexOf("syn-transition-phrase")
        if (index >= 0) activeRoles.splice(index, 1)
      }
      const sourceSection = project.sections.find((candidate) => candidate.id === section.sectionId)
      const sectionLengthBeats = (sourceSection?.lengthBars ?? 1) * beatsPerBar
      return {
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        sectionRole: section.sectionRole,
        energy: effectiveEnergy,
        density: effectiveEnergy >= 85 ? "high" : effectiveEnergy >= 68 ? "medium-high" : effectiveEnergy >= 42 ? "medium" : "sparse",
        register: {
          low: effectiveEnergy >= 65 ? "strong" : effectiveEnergy >= 35 ? "medium" : "open",
          mid: effectiveEnergy >= 45 ? "strong" : "medium",
          high: isPeak ? "strong" : effectiveEnergy >= 65 ? "medium" : "open",
        },
        intention: applies && directive?.intention
          ? directive.intention
          : isPeak
          ? "それまで温存した音域と役割を開き、曲全体の最大解放を作る"
          : section.occurrence > 1
            ? `同じ役割の${section.occurrence}回目として、前回をコピーせず音域・周期・受け渡しを拡張する`
            : section.energyDelta > 0
              ? "次の段階へ向けて音数より期待と方向を増やす"
              : "主旋律の可読性を守り、前Sectionとの差を引き算で示す",
        activeRoles: [...new Set(activeRoles)],
        semanticRole: section.semanticRole,
        developmentStage: developmentStageFor(section),
        phraseCycleBars: section.semanticRole === "intro" || section.semanticRole === "bridge" || section.semanticRole === "final" ? 8 : 4,
        grooveFamily: character === "rhythmic" ? (isPeak ? "release" : "driving") : grooveFamilyFor(section),
        bassStrategy: character === "rhythmic" ? (isPeak ? "octave-drive" : "syncopated") : bassStrategyFor(section),
        harmonyStrategy: character === "minimal" ? "pedal-space" : character === "dark-experimental" ? "sparse-stabs" : character === "cinematic" && isPeak ? "register-expansion" : harmonyStrategyFor(section),
        roleEntryBeats: roleEntryBeatsFor(section, [...new Set(activeRoles)], sectionLengthBeats, beatsPerBar),
        transitionCandidates,
        selectedTransitionCharacter,
        decorationCandidates,
        selectedDecorationCharacter,
      }
    }),
  }
}

function makeNote(
  trackId: ArrangementTrackId,
  sectionId: string,
  index: number,
  startBeat: number,
  durationBeats: number,
  pitch: number,
  velocity: number,
  reason: string,
  character: ArrangementCandidateCharacter = "safe",
): GeneratedArrangementNote {
  return {
    id: `${trackId}:${sectionId}:${index}:${Math.round(startBeat * 1000)}`,
    sectionId,
    startBeat,
    durationBeats: Math.max(0.0625, durationBeats),
    pitch: Math.max(0, Math.min(127, Math.round(pitch))),
    velocity: Math.max(1, Math.min(127, Math.round(velocity))),
    locks: [],
    character,
    reason,
  }
}

function avoidMelodyCollision(note: GeneratedArrangementNote, melody: MelodyNote[]): GeneratedArrangementNote {
  const collisions = melody.filter((lead) =>
    lead.startBeat < note.startBeat + note.durationBeats &&
    lead.startBeat + lead.durationBeats > note.startBeat &&
    Math.abs(lead.pitch - note.pitch) <= 2,
  )
  if (collisions.length === 0 || note.character !== "safe") return note
  const candidates = [note.pitch - 12, note.pitch + 12]
  const replacement = candidates.find((pitch) => pitch >= 24 && pitch <= 108 && collisions.every((lead) => Math.abs(lead.pitch - pitch) > 2))
  return replacement === undefined ? { ...note, velocity: Math.max(1, note.velocity - 18) } : { ...note, pitch: replacement }
}

function generateDrums(
  trackId: ArrangementTrackId,
  section: ArrangementSectionPlan,
  start: number,
  length: number,
  beatsPerBar: number,
  revision: number,
): GeneratedArrangementNote[] {
  const pitch = DRUM_PITCH[trackId]
  if (pitch === undefined) return []
  const beats: number[] = []
  const bars = Math.max(1, Math.ceil(length / beatsPerBar))
  for (let bar = 0; bar < bars; bar += 1) {
    const base = start + bar * beatsPerBar
    const cycleBar = (bar + revision) % (section.phraseCycleBars ?? 4)
    const isPhraseEnd = cycleBar === (section.phraseCycleBars ?? 4) - 1 || bar === bars - 1
    const groove = section.grooveFamily ?? "restrained"
    if (trackId === "dr-kick") {
      if (groove !== "suspended" || cycleBar % 2 === 0) beats.push(base)
      if (groove === "restrained" && section.energy >= 34) beats.push(base + beatsPerBar / 2)
      if (["driving", "release"].includes(groove)) beats.push(base + beatsPerBar / 2)
      if (groove === "release") beats.push(base + beatsPerBar / 4, base + beatsPerBar * 0.75)
      if (groove === "driving" && section.developmentStage === 0 && cycleBar % 2 === 1) beats.push(base + beatsPerBar / 4)
      if (groove === "building" && cycleBar >= 2) beats.push(base + beatsPerBar / 2)
      if ((groove === "release" || (groove === "driving" && cycleBar % 2 === 1)) && !isPhraseEnd) beats.push(base + beatsPerBar - 0.5)
      if (groove === "broken" && cycleBar % 2 === 1) beats.push(base + beatsPerBar * 0.625)
    } else if (trackId === "dr-snare") {
      beats.push(base + beatsPerBar / 4, base + (beatsPerBar * 3) / 4)
      if ((groove === "release" || section.developmentStage === 2) && cycleBar % 2 === 1) {
        beats.push(base + beatsPerBar / 4 + 0.03, base + (beatsPerBar * 3) / 4 + 0.03)
      }
      if (groove === "release" && isPhraseEnd) beats.push(base + beatsPerBar - 0.25)
    } else if (trackId === "dr-closed-hat") {
      const step = groove === "release" ? 0.5 : cycleBar >= 2 && groove === "building" ? 0.5 : 1
      for (let beat = step / 2; beat < beatsPerBar; beat += step) {
        if (!(isPhraseEnd && beat >= beatsPerBar - 0.5)) beats.push(base + beat)
      }
    } else if (trackId === "dr-open-hat") {
      if (cycleBar % 2 === 1 || groove === "release") beats.push(base + beatsPerBar - 0.5)
    } else if (trackId === "dr-field-drum") {
      if (cycleBar === 1) beats.push(base + beatsPerBar * 0.4375)
      if (cycleBar === 2 && section.energy >= 58) beats.push(base + beatsPerBar * 0.75)
      if (isPhraseEnd) beats.push(base + beatsPerBar - 1.5, base + beatsPerBar - 1, base + beatsPerBar - 0.5)
    } else if (trackId === "dr-low-tom" || trackId === "dr-high-tom") {
      if (isPhraseEnd) beats.push(base + beatsPerBar - (trackId === "dr-low-tom" ? 1 : 0.5))
    } else if (trackId === "dr-gran-cassa" || trackId === "dr-crash") {
      if (bar === 0 || (groove === "release" && cycleBar === 0)) beats.push(base)
    }
  }
  return beats.filter((beat) => beat < start + length).map((beat, index) => makeNote(
    trackId, section.sectionId, index, beat, trackId.includes("hat") ? 0.12 : 0.2, pitch,
    44 + section.energy * 0.42 + (index % 2 === 0 ? 7 : -5), TRACK_PURPOSE[trackId], "safe",
  ))
}

function chordAtBeat(chords: ChordEvent[], beat: number): ChordEvent | undefined {
  return chords.find((chord) => beat >= chord.startBeat && beat < chord.startBeat + chord.durationBeats)
    ?? [...chords].reverse().find((chord) => chord.startBeat <= beat)
    ?? chords[0]
}

function chordTonePcs(chord: ChordEvent | undefined): number[] {
  if (!chord) return [9, 0, 4]
  const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
  if (!parsed) return [9, 0, 4]
  return parsed.tones.map((tone) => tone.pitchClass)
}

function generateTonalTrack(
  trackId: ArrangementTrackId,
  section: ArrangementSectionPlan,
  sourceSection: ComposerProject["sections"][number],
  sectionChords: ChordEvent[],
  melody: MelodyNote[],
  beatsPerBar: number,
  revision: number,
): GeneratedArrangementNote[] {
  const start = sectionOffset(sourceSection.startBar, beatsPerBar)
  const length = sourceSection.lengthBars * beatsPerBar
  const notes: GeneratedArrangementNote[] = []
  const add = (beat: number, duration: number, pitch: number, velocity: number, index: number, character: ArrangementCandidateCharacter = "safe", reason = TRACK_PURPOSE[trackId]) => {
    notes.push(avoidMelodyCollision(makeNote(trackId, section.sectionId, index, start + beat, duration, pitch, velocity, reason, character), melody))
  }
  if (trackId === "syn-transition-phrase") {
    const selected = section.transitionCandidates.find((candidate) => candidate.character === section.selectedTransitionCharacter)
    return (selected?.notes ?? []).map((note) => avoidMelodyCollision({
      ...note,
      id: `${trackId}:${note.id}:${revision}`,
      sectionId: section.sectionId,
      character: selected?.character ?? "safe",
      reason: selected?.reason ?? TRACK_PURPOSE[trackId],
    }, melody))
  }
  if (trackId === "syn-high-glass") {
    const selected = section.decorationCandidates.find((candidate) => candidate.character === section.selectedDecorationCharacter)
    return (selected?.notes ?? []).map((note, index) => avoidMelodyCollision({
      ...note,
      id: `${trackId}:${note.id}:${revision}:${index}`,
      sectionId: section.sectionId,
      character: selected?.character ?? "safe",
      reason: selected?.reason ?? TRACK_PURPOSE[trackId],
    }, melody))
  }
  if (trackId === "syn-final-lift") {
    let previousPitch = 81
    const liftStart = Math.max(0, length - beatsPerBar * 2)
    for (let beat = liftStart; beat < length; beat += beatsPerBar / 2) {
      const chord = chordAtBeat(sectionChords, beat)
      const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
      if (!parsed) continue
      const pool = [...parsed.tones, ...parsed.tensions].map((tone) => midiForPc(tone.pitchClass, previousPitch + 2))
      const upward = pool.filter((pitch) => pitch >= previousPitch && pitch - previousPitch <= 7).sort((left, right) => left - right)
      const pitch = upward[0] ?? pool.sort((left, right) => Math.abs(left - previousPitch) - Math.abs(right - previousPitch))[0]
      previousPitch = pitch
      add(beat, beatsPerBar / 2, pitch, 55 + (beat / length) * 28, notes.length, "edge", "最終ピークのコードトーンと明示テンションだけで上方向の解放を作る")
    }
    return notes
  }
  if (trackId === "syn-bass") {
    const strategy = section.bassStrategy ?? "melodic-pulse"
    const patterns: Record<NonNullable<ArrangementSectionPlan["bassStrategy"]>, number[]> = {
      sustain: [0],
      "melodic-pulse": [0, 2.5],
      syncopated: [0, 1.5, 3.5],
      "octave-drive": [0, 1.5, 2.75],
      "approach-led": [0, 2.5, 3.5],
    }
    const bars = Math.max(1, Math.ceil(length / beatsPerBar))
    for (let bar = 0; bar < bars; bar += 1) {
      const cycleBar = (bar + revision) % (section.phraseCycleBars ?? 4)
      const offsets = strategy === "sustain" && cycleBar % 2 === 1 ? [] : patterns[strategy]
      offsets.forEach((offsetInBar, hitIndex) => {
        const localBeat = bar * beatsPerBar + offsetInBar
        if (localBeat >= length) return
        const chord = chordAtBeat(sectionChords, localBeat)
        const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
        if (!parsed) return
        const rootPitch = midiForPc(parsed.rootPc, 39)
        const nextBeat = Math.min(length - 0.01, localBeat + Math.max(0.25, beatsPerBar - offsetInBar))
        const nextChord = chordAtBeat(sectionChords, nextBeat)
        const nextParsed = nextChord ? parseChordSymbol(nextChord.symbol, nextChord.bass ?? undefined) : null
        let pitch = rootPitch
        let character: ArrangementCandidateCharacter = "safe"
        let reason = "コードの重心を保ちながら、4小節周期の独立したBass lineを作る"
        if (strategy === "octave-drive" && (hitIndex + cycleBar) % 3 === 2) pitch += 12
        else if (strategy === "melodic-pulse" && hitIndex === 1) pitch = midiForPc(parsed.tones[2]?.pitchClass ?? parsed.rootPc, 43)
        else if (strategy === "syncopated" && hitIndex === offsets.length - 1) pitch = midiForPc(parsed.tones[1]?.pitchClass ?? parsed.rootPc, 40)
        else if (strategy === "approach-led" && hitIndex === offsets.length - 1 && nextParsed) {
          const target = midiForPc(nextParsed.rootPc, 39)
          pitch = target + ((bar + revision) % 2 === 0 ? -1 : 2)
          character = "edge"
          reason = "次の和音へ解決するアプローチ音でSectionの方向を作る"
        }
        const duration = strategy === "sustain" ? Math.min(beatsPerBar * 2, length - localBeat) : hitIndex === 0 ? 0.8 : 0.42
        add(localBeat, duration, pitch, 52 + section.energy * 0.34 + (hitIndex === 0 ? 5 : -2), notes.length, character, reason)
      })
    }
    return notes
  }
  if (trackId === "syn-stabs") {
    const bars = Math.max(1, Math.ceil(length / beatsPerBar))
    for (let bar = 0; bar < bars; bar += 1) {
      const cycleBar = (bar + revision) % (section.phraseCycleBars ?? 4)
      const offsets = cycleBar === 0
        ? [1.5]
        : cycleBar === 2
          ? [3.5]
          : (section.developmentStage ?? 0) >= 1 && cycleBar === 3
            ? [3.5]
            : []
      offsets.forEach((offsetInBar) => {
        const localBeat = bar * beatsPerBar + offsetInBar
        if (localBeat >= length) return
        const chord = chordAtBeat(sectionChords, localBeat)
        chordTonePcs(chord).slice(0, 3).forEach((tone, voice) => add(
          localBeat, 0.18 + voice * 0.015, midiForPc(tone, 62 + voice * 7), 43 + section.energy * 0.28,
          notes.length, "safe", "主旋律の空白と裏拍だけに短い和音アクセントを置く",
        ))
      })
    }
    return notes
  }
  if (trackId === "syn-dark-pad" || trackId.startsWith("str-")) {
    const stringPeriodBars = trackId === "str-upper" ? 4 : 2
    const segmentBeats = trackId === "syn-dark-pad" ? beatsPerBar : beatsPerBar * stringPeriodBars
    const previousPadPitches: Array<number | undefined> = [undefined, undefined, undefined]
    let previousPitch: number | undefined
    for (let localBeat = 0; localBeat < length - 0.01; localBeat += segmentBeats) {
      const chord = chordAtBeat(sectionChords, localBeat)
      const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
      if (!parsed) continue
      const duration = Math.min(segmentBeats, length - localBeat) * 0.96
      if (trackId === "syn-dark-pad") {
        const palette = [...parsed.tones.slice(1), ...parsed.tensions.slice(0, 1), parsed.tones[0]].filter(Boolean)
        const padCycle = (Math.floor(localBeat / beatsPerBar) + revision) % 4
        const breathFactors = [0.96, 0.88, 0.94, 0.84]
        palette.slice(0, 3).forEach((tone, voice) => {
          const pitch = midiForPc(tone.pitchClass, previousPadPitches[voice] ?? 53 + voice * 7)
          previousPadPitches[voice] = pitch
          const voiceOffset = padCycle === 2 && voice === 2 ? 0.25 : 0
          add(localBeat + voiceOffset, Math.max(0.25, duration * breathFactors[padCycle] - voiceOffset), pitch, 30 + section.energy * 0.17,
            notes.length, "safe", "共通音と最短Voice Leadingを優先し、和声の変化だけを静かに示す")
        })
      } else {
        const phraseOffset = ((Math.floor(localBeat / segmentBeats) + revision) % 2) * (beatsPerBar / 2)
        const soundingChord = chordAtBeat(sectionChords, localBeat + phraseOffset)
        const soundingParsed = (soundingChord ? parseChordSymbol(soundingChord.symbol, soundingChord.bass ?? undefined) : null) ?? parsed
        const targetIndex = trackId === "str-cello" ? 0 : trackId === "str-viola" ? 1 : trackId === "str-violin-2" ? 2 : trackId === "str-violin-1" ? 1 : 2
        const around = trackId === "str-cello" ? 48 : trackId === "str-viola" ? 60 : trackId === "str-violin-2" ? 67 : trackId === "str-violin-1" ? 74 : 86
        const pool = [...soundingParsed.tones.slice(1), ...soundingParsed.tensions]
        const shiftedIndex = (targetIndex + Math.floor(localBeat / segmentBeats) + (section.developmentStage ?? 0)) % Math.max(1, pool.length)
        const tone = pool[shiftedIndex]?.pitchClass ?? soundingParsed.rootPc
        const pitch = midiForPc(tone, previousPitch ?? around)
        previousPitch = pitch
        add(localBeat + phraseOffset, Math.max(0.25, duration - phraseOffset), pitch, 38 + section.energy * 0.3, notes.length, trackId === "str-upper" ? "edge" : "safe", trackId === "str-upper" ? "最終ピークだけに上声を開く" : "2〜4小節単位の長い弧で内声を動かし、主旋律の呼吸を残す")
      }
    }
    return notes
  }
  for (const [chordIndex, chord] of sectionChords.entries()) {
    const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    if (!parsed) continue
    if (trackId === "syn-pulse") {
      const pcs = [parsed.tones[0]?.pitchClass, parsed.tones[2]?.pitchClass, parsed.tones[1]?.pitchClass].filter((value): value is number => value !== undefined)
      const chordEnd = chord.startBeat + chord.durationBeats
      for (let barBeat = chord.startBeat; barBeat < chordEnd; barBeat += beatsPerBar) {
        const cycleBar = (Math.floor(barBeat / beatsPerBar) + revision + chordIndex) % (section.phraseCycleBars ?? 4)
        const offsets = section.energy >= 82
          ? cycleBar === 3 ? [0, 0.5, 1.5, 2.5, 3.5] : [0.5, 1.5, 2.5, 3.5]
          : cycleBar === 3 ? [0.5, 1.5, 3.5] : cycleBar === 1 ? [0.5, 2.5] : [0.5, 1.5, 2.5]
        for (const offsetInBar of offsets) {
          const beat = barBeat + offsetInBar
          if (beat >= chordEnd) continue
          add(beat, 0.22, midiForPc(pcs[notes.length % pcs.length], 57), 40 + section.energy * 0.28, notes.length, "safe", "4〜8小節周期の欠落とアクセントで、連打ではない推進力を作る")
        }
      }
    }
  }
  return notes
}

function emptyTrack(id: ArrangementTrackId, revision = 0): GeneratedArrangementTrack {
  return { id, name: ARRANGEMENT_TRACK_NAMES[id], family: TRACK_FAMILY[id], muted: false, notes: [], generationRevision: revision, purpose: TRACK_PURPOSE[id] }
}

function generateTrack(
  project: ComposerProject,
  plan: ArrangementPlan,
  trackId: ArrangementTrackId,
  revision = 0,
  onlySectionId?: string,
): GeneratedArrangementTrack {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const material = buildSongPlaybackMaterial(project)
  const track = emptyTrack(trackId, revision)
  for (const sectionPlan of plan.sections) {
    if (onlySectionId && sectionPlan.sectionId !== onlySectionId) continue
    if (!sectionPlan.activeRoles.includes(trackId)) continue
    const section = project.sections.find((candidate) => candidate.id === sectionPlan.sectionId)
    if (!section) continue
    const offset = sectionOffset(section.startBar, beatsPerBar)
    const length = section.lengthBars * beatsPerBar
    const entryBeat = offset + (sectionPlan.roleEntryBeats?.[trackId] ?? 0)
    let generated: GeneratedArrangementNote[]
    if (trackId.startsWith("dr-")) {
      generated = generateDrums(trackId, sectionPlan, offset, length, beatsPerBar, revision)
    } else {
      const chords = project.chords.filter((chord) => chord.sectionId === section.id).sort((a, b) => a.startBeat - b.startBeat)
      generated = generateTonalTrack(trackId, sectionPlan, section, chords, material.lead, beatsPerBar, revision)
    }
    track.notes.push(...generated.filter((note) => note.startBeat + 0.001 >= entryBeat))
  }
  return track
}

export function reviewGeneratedArrangement(arrangement: Pick<FullSongArrangement, "analysis" | "plan" | "tracks">) {
  const roleSignatures = arrangement.plan.sections.map((section) => [...section.activeRoles].sort().join("|"))
  const distinctSectionTextures = new Set(roleSignatures).size
  const stagedEntryCount = arrangement.plan.sections.reduce(
    (sum, section) => sum + Object.values(section.roleEntryBeats ?? {}).filter((beat) => (beat ?? 0) > 0).length,
    0,
  )
  const peakIndex = arrangement.analysis.sections.findIndex((section) => section.sectionId === arrangement.analysis.peakSectionId)
  const peakIsLate = peakIndex >= Math.floor(arrangement.analysis.sections.length * 0.6)
  const overfilledSectionCount = arrangement.plan.sections.filter((section) => section.activeRoles.length > 16).length
  const silentRoleCount = arrangement.tracks.filter((track) => track.notes.length === 0).length
  const beatsPerBar = parseTimeSignature(arrangement.analysis.timeSignature).beatsPerBar
  const tonalTracks = arrangement.tracks.filter((track) => !track.id.startsWith("dr-") && track.id !== "syn-pulse")
  const mechanicalLoopCount = arrangement.plan.sections.reduce((sum, section) => {
    const repeatedTracks = tonalTracks.filter((track) => {
      const notes = track.notes.filter((note) => note.sectionId === section.sectionId)
      if (notes.length < 8) return false
      const firstBeat = Math.floor(Math.min(...notes.map((note) => note.startBeat)) / beatsPerBar) * beatsPerBar
      const bars = new Map<number, string[]>()
      for (const note of notes) {
        const bar = Math.floor((note.startBeat - firstBeat) / beatsPerBar)
        const event = `${(note.startBeat % beatsPerBar).toFixed(3)}:${note.durationBeats.toFixed(3)}:${note.pitch}`
        bars.set(bar, [...(bars.get(bar) ?? []), event])
      }
      const signatures = [...bars.values()].map((events) => events.sort().join("|"))
      return signatures.length >= 4 && new Set(signatures).size === 1
    }).length
    return sum + repeatedTracks
  }, 0)
  const sectionNoteCounts = arrangement.plan.sections.map((section) => arrangement.tracks.reduce(
    (sum, track) => sum + track.notes.filter((note) => note.sectionId === section.sectionId).length,
    0,
  ))
  const positiveCounts = sectionNoteCounts.filter((count) => count > 0)
  const densityContrastRatio = positiveCounts.length > 1
    ? Math.max(...positiveCounts) / Math.max(1, Math.min(...positiveCounts))
    : 1
  const recommendations: string[] = []
  if (distinctSectionTextures < Math.min(4, arrangement.plan.sections.length)) recommendations.push("Section間の役割差を増やす")
  if (!peakIsLate) recommendations.push("最大解放を曲後半へ移す")
  if (overfilledSectionCount > 0) recommendations.push("同時に使う役割を整理する")
  if (silentRoleCount > 0) recommendations.push("音のない役割をPlanから除外する")
  if (mechanicalLoopCount > 0) recommendations.push("同一小節の機械的な反復をMotif変形または休符で崩す")
  if (arrangement.plan.sections.length >= 4 && densityContrastRatio < 1.8) recommendations.push("Section間の実音密度差を増やす")
  const score = Math.max(0, Math.min(100,
    45
    + Math.min(25, distinctSectionTextures * 4)
    + Math.min(15, stagedEntryCount * 3)
    + (peakIsLate ? 15 : 0)
    - overfilledSectionCount * 8
    - silentRoleCount * 5
    - mechanicalLoopCount * 4
    + (densityContrastRatio >= 2.5 ? 5 : 0),
  ))
  return {
    score,
    passed: score >= 75 && recommendations.length <= 1,
    summary: score >= 88 ? "Sectionごとの役割差と後半の解放が成立しています" : score >= 75 ? "全曲の起伏は成立しています。試聴で役割密度を確認してください" : "全曲の役割差を再調整する余地があります",
    metrics: {
      distinctSectionTextures,
      stagedEntryCount,
      peakSectionId: arrangement.analysis.peakSectionId,
      peakIsLate,
      overfilledSectionCount,
      silentRoleCount,
      mechanicalLoopCount,
      densityContrastRatio,
    },
    recommendations,
  }
}

export function generateFullSongArrangement(
  project: ComposerProject,
  options: {
    seed?: number
    brief?: string
    directive?: ArrangementGenerationDirective
    revision?: number
  } = {},
): FullSongArrangement {
  const analysis = analyzeFullSongArrangement(project)
  const plan = buildFullSongArrangementPlan(project, analysis, options.seed, options.brief, options.directive)
  const activeTrackIds = [...new Set(plan.sections.flatMap((section) => section.activeRoles))]
  const revision = Math.max(0, Math.round(options.revision ?? 0))
  const result: FullSongArrangement = {
    version: "1.0.0",
    id: `arrangement:${plan.seed}`,
    createdAt: new Date().toISOString(),
    analysis,
    plan,
    tracks: activeTrackIds.map((trackId) => generateTrack(project, plan, trackId, revision)),
  }
  return { ...result, quality: reviewGeneratedArrangement(result) }
}

export function regenerateFullSongArrangementTarget(
  project: ComposerProject,
  current: FullSongArrangement,
  target: ArrangementRegenerationTarget,
): FullSongArrangement {
  let plan = current.plan
  if (target.energyDelta && target.sectionId) {
    plan = {
      ...plan,
      sections: plan.sections.map((section) => section.sectionId === target.sectionId
        ? {
            ...section,
            energy: Math.max(10, Math.min(100, section.energy + target.energyDelta!)),
            activeRoles: [...new Set([...section.activeRoles, target.trackId])],
            ...(target.character
              ? target.trackId === "syn-high-glass"
                ? { selectedDecorationCharacter: target.character }
                : { selectedTransitionCharacter: target.character }
              : {}),
          }
        : section),
    }
  } else if (target.character && target.sectionId) {
    plan = {
      ...plan,
      sections: plan.sections.map((section) => section.sectionId === target.sectionId
        ? {
            ...section,
            ...(target.trackId === "syn-high-glass"
              ? { selectedDecorationCharacter: target.character! }
              : { selectedTransitionCharacter: target.character! }),
            activeRoles: [...new Set([...section.activeRoles, target.trackId])],
          }
        : section),
    }
  }
  const currentTrack = current.tracks.find((track) => track.id === target.trackId) ?? emptyTrack(target.trackId)
  const revision = currentTrack.generationRevision + 1
  const regenerated = generateTrack(project, plan, target.trackId, revision, target.sectionId)
  const tracks = current.tracks.some((track) => track.id === target.trackId)
    ? current.tracks.map((track) => {
        if (track.id !== target.trackId) return track
        if (!target.sectionId) return regenerated
        return {
          ...track,
          generationRevision: revision,
          notes: [
            ...track.notes.filter((note) => note.sectionId !== target.sectionId),
            ...regenerated.notes,
          ].sort((left, right) => left.startBeat - right.startBeat),
        }
      })
    : [...current.tracks, regenerated]
  const updated = { ...current, plan, tracks }
  return { ...updated, quality: reviewGeneratedArrangement(updated) }
}

export function setArrangementTrackMuted(
  current: FullSongArrangement,
  trackId: ArrangementTrackId,
  muted: boolean,
): FullSongArrangement {
  return { ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, muted } : track) }
}
