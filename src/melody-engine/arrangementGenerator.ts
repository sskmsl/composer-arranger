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
  "syn-bass": "bass", "syn-pulse": "synth", "syn-dark-pad": "synth",
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
  const climaxId = director.climaxSectionId
  const analysisSections: ArrangementAnalysisSection[] = sections.map((section, order) => {
    const occurrence = (roleOccurrence.get(section.role) ?? 0) + 1
    roleOccurrence.set(section.role, occurrence)
    const directorEnergy = director.sections.find((plan) => plan.sectionId === section.id)?.targetEnergy ?? 2
    const repeatedExpansion = Math.min(14, Math.max(0, occurrence - 1) * 7)
    const energy = Math.max(10, Math.min(100, directorEnergy * 20 + repeatedExpansion + (section.id === climaxId ? 0 : -5)))
    const previousDirectorEnergy = order > 0
      ? director.sections.find((plan) => plan.sectionId === sections[order - 1].id)?.targetEnergy ?? 2
      : directorEnergy
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
    return {
      sectionId: section.id,
      sectionName: section.name,
      sectionRole: section.role,
      order,
      occurrence,
      energy,
      energyDelta: order === 0 ? 0 : energy - Math.max(10, Math.min(100, previousDirectorEnergy * 20)),
      melodyRange,
      melodyRestRatio: Math.max(0, Math.min(1, 1 - sounding / Math.max(1, end - start))),
      chordRepetition: repetitionScore(chordSignatures[order], chordSignatures),
      melodyRepetition: repetitionScore(melodySignatures[order], melodySignatures),
      availableRegisters,
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
  const energy = section.energy
  const intro = section.sectionRole === "intro"
  const outro = section.sectionRole === "outro"
  if (!outro || energy >= 35) roles.push("dr-kick")
  if (energy >= 38 && !intro) roles.push("dr-snare")
  if (energy >= 46) roles.push("dr-closed-hat")
  if (energy >= 68) roles.push("dr-open-hat")
  if (section.energyDelta >= 12 || section.sectionRole === "pre-chorus") roles.push("dr-field-drum")
  if (energy >= 72 && section.occurrence > 1) roles.push("dr-low-tom", "dr-high-tom")
  if ((isPeak || section.energyDelta >= 25) && energy >= 75) roles.push("dr-gran-cassa", "dr-crash")
  if (!outro) roles.push("syn-bass")
  if (energy >= 48 && section.sectionRole !== "breakdown-chorus") roles.push("syn-pulse")
  if (intro || outro || energy <= 45 || section.sectionRole === "bridge") roles.push("syn-dark-pad")
  if (section.melodyRestRatio >= 0.18 && section.availableRegisters.includes("high")) roles.push("syn-high-glass")
  if (section.energyDelta >= 10 || section.sectionRole === "pre-chorus") roles.push("syn-transition-phrase")
  if (energy >= 58 && ["pre-chorus", "chorus", "grand-chorus", "bridge"].includes(section.sectionRole)) {
    roles.push("str-cello", "str-viola")
  }
  if (energy >= 72) roles.push("str-violin-2", "str-violin-1")
  if (isPeak) roles.push("str-upper", "syn-final-lift")
  return [...new Set(roles)]
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
  const tensionPc = parsed?.tensions[0]?.pitchClass ?? pc(chordPc + 2)
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
      ? "9thまたは隣接テンションを短く置き、次の和声音へ残響で解決する"
      : "直前まで未使用だった最高域を一度だけ開き、反復Sectionに新しい記憶点を作る"
  return {
    id: `${section.sectionId}:decoration:${character}:${seed}`,
    sectionId: section.sectionId,
    character,
    kind: "bell-hit",
    reason,
    notes: [{
      id: `decoration:${section.sectionId}:${character}:${seed}`,
      startBeat: offset + Math.max(0, length - beatsPerBar * 0.75),
      durationBeats: character === "surprise" ? 0.125 : 0.25,
      pitch,
      velocity: character === "surprise" ? 72 : character === "edge" ? 58 : 50,
      locks: [],
      plannedToneRole: character === "safe" ? "chord-tone" : "tension-hold",
    }],
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
      if (applies) activeRoles.push(...(directive?.add ?? []))
      if (selectedTransitionCharacter === "silence") {
        const index = activeRoles.indexOf("syn-transition-phrase")
        if (index >= 0) activeRoles.splice(index, 1)
      }
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
  const energy = section.energy
  const beats: number[] = []
  const bars = Math.max(1, Math.ceil(length / beatsPerBar))
  for (let bar = 0; bar < bars; bar += 1) {
    const base = start + bar * beatsPerBar
    if (trackId === "dr-kick") {
      beats.push(base)
      if (energy >= 58) beats.push(base + beatsPerBar / 2)
      if (energy >= 78 && (bar + revision) % 2 === 1) beats.push(base + beatsPerBar - 0.5)
    } else if (trackId === "dr-snare") {
      beats.push(base + beatsPerBar / 4, base + (beatsPerBar * 3) / 4)
    } else if (trackId === "dr-closed-hat") {
      const step = energy >= 75 ? 0.5 : 1
      for (let beat = step / 2; beat < beatsPerBar; beat += step) beats.push(base + beat)
    } else if (trackId === "dr-open-hat") {
      beats.push(base + beatsPerBar - 0.5)
    } else if (trackId === "dr-field-drum") {
      if (bar === bars - 1) beats.push(base + beatsPerBar - 1.5, base + beatsPerBar - 1, base + beatsPerBar - 0.5)
    } else if (trackId === "dr-low-tom" || trackId === "dr-high-tom") {
      if (bar === bars - 1) beats.push(base + beatsPerBar - (trackId === "dr-low-tom" ? 1 : 0.5))
    } else if (trackId === "dr-gran-cassa" || trackId === "dr-crash") {
      if (bar === 0) beats.push(base)
    }
  }
  return beats.filter((beat) => beat < start + length).map((beat, index) => makeNote(
    trackId, section.sectionId, index, beat, trackId.includes("hat") ? 0.12 : 0.2, pitch,
    48 + section.energy * 0.45 + (index % 2 === 0 ? 5 : -4), TRACK_PURPOSE[trackId], "safe",
  ))
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
    const chord = sectionChords[0]
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    const tone = parsed?.tones[1]?.pitchClass ?? parsed?.rootPc
    if (tone !== undefined) {
      for (let beat = Math.max(0, length - beatsPerBar * 2); beat < length; beat += beatsPerBar / 2) {
        add(beat, beatsPerBar / 2, midiForPc(tone, 88) + Math.min(7, Math.floor((beat - (length - beatsPerBar * 2)) / (beatsPerBar / 2)) * 2), 55 + (beat / length) * 28, notes.length, "edge", "最終ピークだけに温存した高域を段階的に開く")
      }
    }
    return notes
  }
  for (const [chordIndex, chord] of sectionChords.entries()) {
    const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    if (!parsed) continue
    const root = parsed.rootPc
    const next = sectionChords[chordIndex + 1]
    const nextParsed = next ? parseChordSymbol(next.symbol, next.bass ?? undefined) : null
    if (trackId === "syn-bass") {
      const pulse = section.energy >= 68 ? Math.min(1, chord.durationBeats / 2) : chord.durationBeats
      for (let beat = chord.startBeat; beat < chord.startBeat + chord.durationBeats - 0.01; beat += pulse) {
        let pitch = midiForPc(root, 40)
        let character: ArrangementCandidateCharacter = "safe"
        let reason = "コードのルートを持続し、Kickと完全同期しない重力を作る"
        if (nextParsed && beat + pulse >= chord.startBeat + chord.durationBeats && section.energy >= 60) {
          const target = midiForPc(nextParsed.rootPc, pitch)
          pitch = target + ((revision + chordIndex) % 2 === 0 ? -1 : 2)
          character = "edge"
          reason = "次コードのルートへ半音または全音で解決するアプローチ"
        } else if (section.energy >= 72 && Math.round(beat / pulse) % 4 === 2) pitch += 12
        add(beat, Math.max(0.25, pulse * 0.85), pitch, 55 + section.energy * 0.32, notes.length, character, reason)
      }
    } else if (trackId === "syn-pulse") {
      const pcs = [parsed.tones[0]?.pitchClass, parsed.tones[2]?.pitchClass, parsed.tones[1]?.pitchClass].filter((value): value is number => value !== undefined)
      const step = section.energy >= 72 ? 0.5 : 1
      for (let beat = chord.startBeat + ((revision + chordIndex) % 2 ? step / 2 : 0); beat < chord.startBeat + chord.durationBeats; beat += step) {
        add(beat, step * 0.42, midiForPc(pcs[notes.length % pcs.length], 57), 40 + section.energy * 0.28, notes.length, "safe", "コードを説明し切らず、周期とアクセントで推進力を作る")
      }
    } else if (trackId === "syn-dark-pad") {
      const pcs = [...parsed.tones.slice(1, 3), ...parsed.tensions.slice(0, 1)].map((tone) => tone.pitchClass)
      pcs.forEach((tone, index) => add(chord.startBeat, chord.durationBeats * 0.98, midiForPc(tone, 55 + index * 7), 34 + section.energy * 0.18, notes.length, "safe", "ルートを省き、共通音と長い持続で背景空間を保つ"))
    } else if (trackId.startsWith("str-")) {
      const targetIndex = trackId === "str-cello" ? 0 : trackId === "str-viola" ? 1 : trackId === "str-violin-2" ? 2 : trackId === "str-violin-1" ? 1 : 2
      const around = trackId === "str-cello" ? 48 : trackId === "str-viola" ? 60 : trackId === "str-violin-2" ? 67 : trackId === "str-violin-1" ? 74 : 86
      const pool = [...parsed.tones.slice(1), ...parsed.tensions]
      const tone = pool[targetIndex % Math.max(1, pool.length)]?.pitchClass ?? root
      const previousPitch = notes[notes.length - 1]?.pitch
      const pitch = midiForPc(tone, previousPitch ?? around)
      add(chord.startBeat, chord.durationBeats, pitch, 42 + section.energy * 0.3, notes.length, trackId === "str-upper" ? "edge" : "safe", trackId === "str-upper" ? "最終ピークだけに上声を開き、既存Stringsから順次接続する" : "前音からの移動量を抑えた内声で、主旋律を塞がず緊張を運ぶ")
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
    if (trackId.startsWith("dr-")) {
      track.notes.push(...generateDrums(trackId, sectionPlan, offset, length, beatsPerBar, revision))
    } else {
      const chords = project.chords.filter((chord) => chord.sectionId === section.id).sort((a, b) => a.startBeat - b.startBeat)
      track.notes.push(...generateTonalTrack(trackId, sectionPlan, section, chords, material.lead, beatsPerBar, revision))
    }
  }
  return track
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
  return {
    version: "1.0.0",
    id: `arrangement:${plan.seed}`,
    createdAt: new Date().toISOString(),
    analysis,
    plan,
    tracks: activeTrackIds.map((trackId) => generateTrack(project, plan, trackId, revision)),
  }
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
  return { ...current, plan, tracks }
}

export function setArrangementTrackMuted(
  current: FullSongArrangement,
  trackId: ArrangementTrackId,
  muted: boolean,
): FullSongArrangement {
  return { ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, muted } : track) }
}
