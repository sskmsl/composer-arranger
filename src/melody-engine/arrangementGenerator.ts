import { buildArrangementDirectorBlueprint } from "@/ai-arranger/arrangementDirector"
import { parseChordSymbol } from "@/core/chord"
import { resolveMusicContext, type GenreTraits, type SoundImageTraits } from "@/core/musicContext"
import { applyReferenceArc } from "@/core/referenceProfile"
import type { MelodyNote } from "@/core/melody"
import {
  arrangementSoundInstructionAppliesTo,
  arrangementSoundInstructionFromText,
  arrangementSoundInstructionLabel,
  type ArrangementSoundInstruction,
} from "@/core/arrangementIntent"
import type { ChordEvent, ComposerProject } from "@/core/project"
import {
  ARRANGEMENT_TRACK_NAMES,
  type ArrangementAnalysis,
  type ArrangementAnalysisSection,
  type ArrangementCandidateApproach,
  type ArrangementCandidateSummary,
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
import { applyArrangementTimelineToTracks } from "@/core/arrangementTimelineConstraints"
import { applyArrangementPerformanceDirector } from "./arrangementPerformanceDirector"
import { evaluateArrangementAudition, refineArrangementByAudition } from "./arrangementAuditionCritic"

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
  "dr-kick-sub": "drums", "dr-kick-click": "drums", "dr-snare-body": "drums",
  "dr-clap": "drums", "dr-shaker": "drums", "dr-ride": "drums",
  "dr-percussion-high": "drums", "dr-cymbal-swell": "drums", "dr-impact": "drums",
  "syn-bass": "bass", "syn-sub-bass": "bass", "syn-bass-mid": "bass",
  "syn-pulse": "synth", "syn-arp-low": "synth", "syn-arp-high": "synth",
  "syn-stabs": "synth", "syn-chord-wide": "synth", "syn-dark-pad": "synth",
  "syn-pad-air": "synth", "syn-pad-motion": "synth",
  "syn-high-glass": "synth", "syn-transition-phrase": "transition",
  "syn-final-lift": "synth", "str-cello": "strings", "str-viola": "strings",
  "str-violin-2": "strings", "str-violin-1": "strings", "str-upper": "strings",
  "str-contrabass": "strings", "str-spiccato": "strings", "str-high-octave": "strings",
}

const TRACK_PURPOSE: Record<ArrangementTrackId, string> = {
  "dr-kick": "曲の重心と歩幅", "dr-snare": "拍節の輪郭", "dr-closed-hat": "時間の粒度",
  "dr-open-hat": "Sectionの開放", "dr-low-tom": "境界へ向かう低い運動",
  "dr-high-tom": "フィルの上方向の動き", "dr-field-drum": "人間的な緊張と予告",
  "dr-gran-cassa": "Section境界の映画的重量", "dr-crash": "温存した入口の強調",
  "dr-kick-sub": "キックの下にだけ足す低域の重量", "dr-kick-click": "小さい再生環境でも残るキックの輪郭",
  "dr-snare-body": "スネアの胴鳴り", "dr-clap": "サビだけを横へ広げる拍の層",
  "dr-shaker": "ハイハットより細い前進", "dr-ride": "高揚時の長い金属的な流れ",
  "dr-percussion-high": "フィルへ高さと応答を足す補助打楽器", "dr-cymbal-swell": "Section入口へ向かう金属の余韻",
  "dr-impact": "大きな境界だけに加える短い衝撃",
  "syn-bass": "和声の重力と次コードへの方向", "syn-sub-bass": "最小限の低域を長く支える層",
  "syn-bass-mid": "ベースの動きを小さい再生環境へ伝える中低域", "syn-pulse": "周期と推進力",
  "syn-arp-low": "Pulseの隙間を低めの分散音でつなぐ", "syn-arp-high": "後半だけ開く高域の分散音",
  "syn-stabs": "休符と裏拍で輪郭を作る疎な和音アクセント",
  "syn-chord-wide": "短い和音を上下へ広げる補助層",
  "syn-dark-pad": "共通音を残す背景空間", "syn-pad-air": "Padの最上音だけで作る遠い空気層",
  "syn-pad-motion": "Padの内声だけを残して静かな動きを作る層", "syn-high-glass": "未使用高域の短い反射",
  "syn-transition-phrase": "主旋律の休符から次Sectionへ渡す短い因果",
  "syn-final-lift": "最終ピークだけに開く上方向の解放",
  "str-cello": "低中域の持続と内的な動き", "str-viola": "内声の緊張",
  "str-violin-2": "中高域の連続性", "str-violin-1": "感情点へ向かう上声",
  "str-upper": "クライマックスでのみ現れる希少な上声",
  "str-contrabass": "弦の最下層を長く支える重心", "str-spiccato": "持続弦とは別に拍を刻む短音層",
  "str-high-octave": "最終ピークで上声を一段だけ持ち上げる層",
}

/**
 * 作曲上の役割を増やすのではなく、音域・アタック・距離を別音源へ割り当てるための
 * オーケストレーション層。元トラックの音楽的判断を共有しつつ、同じMIDIの複製にはしない。
 */
const ARRANGEMENT_LAYER_SOURCES = {
  "dr-kick-sub": "dr-kick",
  "dr-kick-click": "dr-kick",
  "dr-snare-body": "dr-snare",
  "dr-clap": "dr-snare",
  "dr-shaker": "dr-closed-hat",
  "dr-ride": "dr-closed-hat",
  "dr-percussion-high": "dr-field-drum",
  "dr-cymbal-swell": "dr-crash",
  "dr-impact": "dr-gran-cassa",
  "syn-sub-bass": "syn-bass",
  "syn-bass-mid": "syn-bass",
  "syn-arp-low": "syn-pulse",
  "syn-arp-high": "syn-pulse",
  "syn-chord-wide": "syn-stabs",
  "syn-pad-air": "syn-dark-pad",
  "syn-pad-motion": "syn-dark-pad",
  "str-contrabass": "str-cello",
  "str-spiccato": "str-viola",
  "str-high-octave": "str-violin-1",
} as const satisfies Partial<Record<ArrangementTrackId, ArrangementTrackId>>

const PHASE_LOCKED_LAYER_SOURCES = new Map<ArrangementTrackId, ArrangementTrackId>([
  ["dr-kick-sub", "dr-kick"],
  ["dr-kick-click", "dr-kick"],
  ["dr-snare-body", "dr-snare"],
  ["dr-impact", "dr-gran-cassa"],
])

type ArrangementLayerTrackId = keyof typeof ARRANGEMENT_LAYER_SOURCES

function isArrangementLayerTrackId(trackId: ArrangementTrackId): trackId is ArrangementLayerTrackId {
  return trackId in ARRANGEMENT_LAYER_SOURCES
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const ARRANGEMENT_APPROACHES: ArrangementCandidateApproach[] = [
  "space-led",
  "rhythm-led",
  "counterpoint-led",
  "dynamic-contrast",
  "motif-led",
]

const ARRANGEMENT_CANDIDATE_POOL_SIZE = 8
const ARRANGEMENT_QUALITY_FLOOR = 76
const ARRANGEMENT_CANDIDATE_SEED_STEP = 104_729

function candidateApproachFor(seed: number): ArrangementCandidateApproach {
  return ARRANGEMENT_APPROACHES[hashText(`arrangement-approach:${seed}`) % ARRANGEMENT_APPROACHES.length]
}

function removeRoles(roles: ArrangementTrackId[], removable: ArrangementTrackId[]) {
  const blocked = new Set(removable)
  for (let index = roles.length - 1; index >= 0; index -= 1) {
    if (blocked.has(roles[index])) roles.splice(index, 1)
  }
}

function trackIdsForSoundInstruction(
  instruction: ArrangementSoundInstruction | undefined,
): ArrangementTrackId[] {
  if (!instruction?.enabled) return []
  if (instruction.role === "stabs") return ["syn-stabs"]
  if (instruction.role === "pulse") return ["syn-pulse"]
  if (instruction.role === "pad") return ["syn-dark-pad"]
  if (instruction.role === "bass") return ["syn-bass"]
  if (instruction.role === "strings") return ["str-cello", "str-viola", "str-violin-1"]
  if (instruction.role === "bell") return ["syn-high-glass"]
  if (instruction.role === "counter") return ["str-cello", "str-viola"]
  if (instruction.role === "transition") return ["syn-transition-phrase"]
  if (instruction.role === "percussion") return ["dr-field-drum"]
  return []
}

function trackMatchesSoundInstruction(
  trackId: ArrangementTrackId,
  instruction: ArrangementSoundInstruction,
): boolean {
  return trackIdsForSoundInstruction(instruction).includes(trackId)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  let numerator = 0
  let leftVariance = 0
  let rightVariance = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean
    const rightDelta = right[index] - rightMean
    numerator += leftDelta * rightDelta
    leftVariance += leftDelta * leftDelta
    rightVariance += rightDelta * rightDelta
  }
  const denominator = Math.sqrt(leftVariance * rightVariance)
  return denominator > 0 ? Math.max(-1, Math.min(1, numerator / denominator)) : 0
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
  // "Final Build" は最終サビではなく、最終サビへ向かう助走として扱う。
  if (/build|ビルド/.test(name)) return "build" as const
  if (/final|last chorus|grand|大サビ|最終/.test(name) || section.role === "grand-chorus") return "final" as const
  if (/breakdown|break down|ブレイクダウン/.test(name) || section.role === "breakdown-chorus") return "breakdown" as const
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

/** 盛り上げ方で選ぶ強さ(1 静か〜5 最も強い)を、生成で使う0〜100の強さへ */
const MANUAL_ENERGY: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 20, 2: 36, 3: 54, 4: 72, 5: 90 }

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
  // 「最も盛り上げる場所」を人が選んだときは、曲の役割からの推定より優先する
  const manualClimaxId = project.arrangementDirectorOverrides?.climaxSectionId
  const climaxId = (manualClimaxId && sections.some((section) => section.id === manualClimaxId) ? manualClimaxId : null)
    ?? semanticFinal?.id ?? lastChorus?.id ?? director.climaxSectionId
  // 参考曲の感情の弧(使うよう選ばれたときだけ)。役割から推定したエネルギーを少し寄せるだけ
  const referenceArc = resolveMusicContext(project).reference?.emotionalArc
  const songBars = Math.max(1, ...sections.map((section) => section.startBar - 1 + section.lengthBars))
  const climaxOrder = Math.max(0, sections.findIndex((section) => section.id === climaxId))
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
    // 人が決めた強さはそのまま使う(推定と混ぜると、選んでも音がほとんど変わらないため)
    const manualEnergy = project.arrangementDirectorOverrides?.sections[section.id]?.targetEnergy
    const energy = section.id === climaxId
      ? 100
      : manualEnergy
        ? MANUAL_ENERGY[manualEnergy]
        : applyReferenceArc(
          Math.max(10, Math.min(94, Math.round(semanticEnergy * 0.82 + directorEnergy * 20 * 0.18))),
          (section.startBar - 1 + section.lengthBars / 2) / songBars,
          order < climaxOrder,
          referenceArc,
        )
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
    if (section.occurrence > 1) {
      // 再提示は音量と一つの音色交代で進め、最終ピークの上声を先取りしない。
      removeRoles(roles, ["syn-dark-pad"])
      roles.push("str-cello")
      if (restAllowsColour) roles.push("dr-open-hat")
    }
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
  lead: MelodyNote[],
  approach: ArrangementCandidateApproach,
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
  const sectionLead = notesInRange(lead, offset, end).sort((left, right) => left.startBeat - right.startBeat)
  const motifHead = sectionLead.slice(0, 4)
  const motifIntervals = motifHead.slice(1).map((note, index) => Math.max(-7, Math.min(7, note.pitch - motifHead[index].pitch)))
  const usesMotif = motifIntervals.length >= 2 && (approach === "motif-led" || approach === "counterpoint-led") && character !== "safe"
  const reverseMotif = usesMotif && character === "surprise"
  const reason = character === "safe"
    ? `主旋律の休符を使い、次の${next?.sectionName ?? "終止"}のコードトーンへ順次接続する`
    : character === "edge"
      ? usesMotif
        ? `主旋律冒頭の上下の動きだけを短く変形し、次の${next?.sectionName ?? "終止"}へ解決する`
        : `次の${next?.sectionName ?? "終止"}へ半音で解決する非和声音を、休符の末尾だけに置く`
      : reverseMotif
        ? `主旋律冒頭の動きを逆順にして高域へ一度だけ置き、次の${next?.sectionName ?? "終止"}で回収する`
        : `未使用高域を一瞬だけ開き、次の${next?.sectionName ?? "終止"}の入口で解決して落差を記憶させる`
  const start = end - (character === "surprise" ? 1.5 : 1.25)
  const hasEndingRest = !lead.some((note) => note.startBeat < end && note.startBeat + note.durationBeats > start)
  if (!next || section.melodyRestRatio < 0.08 || !hasEndingRest) {
    return { id: `${section.sectionId}:${character}:silence`, sectionId: section.sectionId, character, kind: "silence", reason: "主旋律の余白が不足しているため、音を足さないことを最も強い選択とする", notes: [] }
  }
  const transformedMotif = usesMotif
    ? (reverseMotif ? [...motifIntervals].reverse().map((interval) => -interval) : motifIntervals)
    : []
  const motifLeadIn = transformedMotif.slice(0, 2).reduceRight<number[]>((result, interval) => {
    const nextValue = result[0] ?? 0
    result.unshift(nextValue - interval)
    return result
  }, [0])
  const intervals = usesMotif ? motifLeadIn.slice(-3) : character === "safe" ? [-4, -2, 0] : character === "edge" ? [-3, -1, 0] : [7, 1, 0]
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
    kind: usesMotif ? reverseMotif ? "reverse-motif" : "motif-variation" : character === "safe" ? "ascending" : character === "edge" ? "chromatic-approach" : "synth-fill",
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

/**
 * 和声を漂わせる度合い。Delius の弦楽四重奏・歌曲(OpenScore、CC0)では、Schumann / Brahms に比べて
 * 付加音・7度の響き(82% 対 50〜55%)と長い持続(40% 対 20〜31%)が多く、4度・5度の根音進行(機能的な動き)が少なかった。
 * ここでは音像の余韻・奥行きとジャンルの持続が高いときだけ、その方向へ今ある音の置き方を寄せる。
 */
function harmonicHazeFor(genre: GenreTraits, aesthetic: SoundImageTraits): number {
  return Math.max(0, Math.min(1, .5 + (aesthetic.decay - .5) * .5 + (aesthetic.depth - .5) * .35 + (genre.sustain - .5) * .45))
}

/**
 * 主旋律の休みで、核のリズムを既存パートへ一度だけ渡す。
 * Schumann / Brahms では、フレーズあたり 0.3 回ほど低音へ、0.1〜0.17 回ほど内声へ動機が移り、
 * その約6割は主旋律が薄い所だった。Boutonnat 的に削り、セクションに1回・休みが十分ある所だけに絞る。
 */
function motifEchoFor(
  section: ArrangementAnalysisSection,
  activeRoles: readonly ArrangementTrackId[],
  energy: number,
  isPeak: boolean,
): ArrangementSectionPlan["motifEcho"] {
  if (isPeak || section.melodyRestRatio < .15 || !["verse", "pre", "bridge", "chorus"].includes(section.semanticRole ?? "")) return undefined
  if (energy >= 50 && activeRoles.includes("syn-bass")) return "bass"
  if (activeRoles.includes("str-viola")) return "inner"
  return undefined
}

function rhythmGrammarFor(
  section: ArrangementAnalysisSection,
  genre: GenreTraits,
  approach: ArrangementCandidateApproach,
  isPeak: boolean,
): NonNullable<ArrangementSectionPlan["rhythmGrammar"]> {
  if (isPeak && genre.rhythmDensity >= .58) return "four-on-floor"
  if (genre.rhythmDensity >= .72) return "four-on-floor"
  if (genre.syncopation >= .66) return "syncopated-pocket"
  if (["intro", "bridge", "build", "final"].includes(section.semanticRole ?? "")
    && genre.sustain >= .68 && genre.dynamicContrast >= .64) return "cinematic-pulse"
  if (genre.rhythmDensity <= .30 || approach === "space-led") return "half-time"
  if (approach === "motif-led") return "syncopated-pocket"
  if (approach === "rhythm-led") return "four-on-floor"
  return "song-led"
}

function sectionShapeFor(
  section: ArrangementAnalysisSection,
  isPeak: boolean,
): NonNullable<ArrangementSectionPlan["sectionShape"]> {
  if (isPeak || section.semanticRole === "final") return "release"
  if (["pre", "build"].includes(section.semanticRole ?? "")) return "build"
  if (["breakdown", "bridge"].includes(section.semanticRole ?? "")) return "drop"
  if (["reprise", "outro"].includes(section.semanticRole ?? "")) return "withdraw"
  if (section.occurrence >= 3) return "expansion"
  if (section.occurrence === 2) return "answer"
  return "statement"
}

function motifTreatmentFor(
  section: ArrangementAnalysisSection,
  approach: ArrangementCandidateApproach,
  shape: NonNullable<ArrangementSectionPlan["sectionShape"]>,
): NonNullable<ArrangementSectionPlan["motifTreatment"]> {
  if (shape === "withdraw" || section.melodyRestRatio < .10) return "none"
  if (shape === "drop") return "augmentation"
  if (shape === "answer") return approach === "counterpoint-led" ? "inversion" : "answer"
  if (shape === "expansion" || shape === "release") return "fragmentation"
  return approach === "motif-led" ? "answer" : "none"
}

function boundaryDropFor(
  section: ArrangementAnalysisSection,
  next: ArrangementAnalysisSection | undefined,
  beatsPerBar: number,
  approach: ArrangementCandidateApproach,
): number {
  if (!next || ["outro", "reprise"].includes(section.semanticRole ?? "")) return 0
  const rise = next.energy - section.energy
  if (rise < 10) return 0
  if (approach === "dynamic-contrast" || rise >= 24) return Math.min(beatsPerBar, 1)
  if (rise >= 14) return Math.min(beatsPerBar / 2, .5)
  return 0
}

function backHalfLiftFor(
  source: ComposerProject["sections"][number] | undefined,
  section: ArrangementAnalysisSection,
  shape: NonNullable<ArrangementSectionPlan["sectionShape"]>,
  beatsPerBar: number,
): number | undefined {
  if (!source || source.lengthBars < 6) return undefined
  if (!["build", "answer", "expansion", "release"].includes(shape)) return undefined
  if (section.energy < 48) return undefined
  return Math.floor(source.lengthBars / 2) * beatsPerBar
}

export function buildFullSongArrangementPlan(
  project: ComposerProject,
  analysis: ArrangementAnalysis,
  seed = hashText(`${project.projectId}:${project.title}:${project.song.tempo}`),
  brief = project.arrangementDirectorWorkspace?.brief ?? "",
  directive?: ArrangementGenerationDirective,
  forcedApproach?: ArrangementCandidateApproach,
): ArrangementPlan {
  const parsedSoundInstruction = directive?.soundInstruction ?? arrangementSoundInstructionFromText(brief)
  const effectiveDirective = parsedSoundInstruction
    ? { ...directive, intention: directive?.intention ?? brief, soundInstruction: parsedSoundInstruction }
    : directive
  const asksSurprise = (directive?.surpriseLevel ?? 0) >= 0.35 || /surprise|意外|大胆|毒|不穏/i.test(brief)
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const lead = buildSongPlaybackMaterial(project).lead
  const candidateApproach = forcedApproach ?? candidateApproachFor(seed)
  const effectiveEnergyBySection = new Map(analysis.sections.map((section) => {
    const { genre } = resolveMusicContext(project, section.sectionId)
    const applies = !effectiveDirective?.sectionId || effectiveDirective.sectionId === section.sectionId
    const contrastShift = genre.dynamicContrast === .5 ? 0
      : (genre.dynamicContrast - .5) * (section.energy >= 65 ? 10 : -6)
    return [section.sectionId, Math.max(10, Math.min(100,
      section.energy + contrastShift + (applies ? effectiveDirective?.energyDelta ?? 0 : 0),
    ))] as const
  }))
  return {
    version: "1.0.0",
    brief,
    seed,
    candidateApproach,
    directive: effectiveDirective,
    sections: analysis.sections.map((section, index): ArrangementSectionPlan => {
      const { genre, aesthetic } = resolveMusicContext(project, section.sectionId)
      const nextAnalysisSection = analysis.sections[index + 1]
      const sourceSection = project.sections.find((candidate) => candidate.id === section.sectionId)
      const applies = !effectiveDirective?.sectionId || effectiveDirective.sectionId === section.sectionId
      const character = applies ? effectiveDirective?.character : undefined
      const effectiveEnergy = effectiveEnergyBySection.get(section.sectionId) ?? section.energy
      const effectiveSection = { ...section, energy: effectiveEnergy }
      const effectiveNextSection = nextAnalysisSection
        ? { ...nextAnalysisSection, energy: effectiveEnergyBySection.get(nextAnalysisSection.sectionId) ?? nextAnalysisSection.energy }
        : undefined
      const isPeak = section.sectionId === analysis.peakSectionId
      let rhythmGrammar = rhythmGrammarFor(section, genre, candidateApproach, isPeak)
      if (character === "minimal" && !isPeak) rhythmGrammar = "half-time"
      else if (character === "cinematic") rhythmGrammar = "cinematic-pulse"
      else if (character === "rhythmic") rhythmGrammar = genre.rhythmDensity >= .78 ? "four-on-floor" : "syncopated-pocket"
      const sectionShape = sectionShapeFor(section, isPeak)
      const motifTreatment = motifTreatmentFor(section, candidateApproach, sectionShape)
      const transitionCandidates = (["safe", "edge", "surprise"] as const).map((character) =>
        transitionCandidate(project, section, analysis.sections[index + 1], character, seed, lead, candidateApproach))
      const decorationCandidates = (["safe", "edge", "surprise"] as const).map((character) =>
        decorationCandidate(project, section, character, seed))
      const hasTransition = transitionCandidates.some((candidate) => candidate.notes.length > 0)
      const selectedTransitionCharacter: ArrangementSectionPlan["selectedTransitionCharacter"] = !hasTransition
        ? "silence"
        : asksSurprise && (section.energyDelta >= 10 || section.melodyRestRatio >= 0.25)
          ? "surprise"
          : section.energyDelta >= 15 || genre.tension >= .7 && section.melodyRestRatio >= .18 && section.energyDelta >= 0
            ? "edge" : "safe"
      const hasDecoration = decorationCandidates.some((candidate) => candidate.notes.length > 0)
      let selectedDecorationCharacter: ArrangementSectionPlan["selectedDecorationCharacter"] = !hasDecoration
        ? "silence"
        : asksSurprise && section.occurrence > 1
          ? "surprise"
          : section.energy >= 65 ? "edge" : "safe"
      const activeRoles = rolesFor(effectiveSection, isPeak)
      if (character === "minimal") {
        const removable = new Set<ArrangementTrackId>(["dr-closed-hat", "dr-open-hat", "syn-pulse", "syn-stabs", "str-viola", "str-violin-1", "str-upper"])
        for (let roleIndex = activeRoles.length - 1; roleIndex >= 0; roleIndex -= 1) {
          if (removable.has(activeRoles[roleIndex]) && !(effectiveDirective?.preserve ?? []).includes(activeRoles[roleIndex])) activeRoles.splice(roleIndex, 1)
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
      // 同じDirection内でも、何を主役にするかを先に分岐させる。
      // 乱数で音を散らすのではなく、全Sectionを通した一貫した解釈軸として扱う。
      if (!isPeak && candidateApproach === "space-led") {
        if (effectiveEnergy < 60) removeRoles(activeRoles, ["syn-pulse", "syn-stabs", "dr-open-hat", "dr-field-drum"])
        if (
          section.melodyRestRatio >= 0.24
          && section.availableRegisters.includes("high")
          && ["intro", "breakdown", "bridge", "reprise"].includes(section.semanticRole ?? "")
        ) activeRoles.push("syn-high-glass")
      } else if (!isPeak && candidateApproach === "rhythm-led") {
        if (effectiveEnergy >= 42 && !["breakdown", "reprise", "outro"].includes(section.semanticRole ?? "")) {
          activeRoles.push("dr-closed-hat", "syn-pulse")
        }
        if (effectiveEnergy >= 64) activeRoles.push("dr-open-hat", "dr-field-drum")
      } else if (!isPeak && candidateApproach === "counterpoint-led") {
        if (["pre", "chorus", "bridge", "build"].includes(section.semanticRole ?? "")) activeRoles.push("str-cello")
        if (effectiveEnergy >= 62 && section.availableRegisters.includes("middle")) activeRoles.push("str-viola")
        removeRoles(activeRoles, effectiveEnergy < 68 ? ["syn-stabs"] : [])
      } else if (!isPeak && candidateApproach === "dynamic-contrast") {
        if (effectiveEnergy < 42) removeRoles(activeRoles, ["dr-closed-hat", "syn-pulse", "syn-stabs", "str-viola", "str-violin-1"])
        if (effectiveEnergy >= 68) activeRoles.push("dr-open-hat", "syn-stabs")
      } else if (!isPeak && candidateApproach === "motif-led") {
        if (effectiveEnergy >= 52) activeRoles.push("syn-stabs")
        if (section.melodyRestRatio >= 0.12 && analysis.sections[index + 1]) activeRoles.push("syn-transition-phrase")
        if (effectiveEnergy < 62) removeRoles(activeRoles, ["syn-pulse"])
      }
      // Genreは完成パターンではなく、既存役割の採否と演奏方法を動かす。
      // 歌の密度と明示的なSound Instructionを最優先し、空間は追加より削除で作る。
      if (!isPeak && (genre.space + aesthetic.layerTransparency) / 2 >= .65) {
        removeRoles(activeRoles, ["syn-stabs", "dr-open-hat", "dr-field-drum"])
        if (section.melodyRestRatio < .22) removeRoles(activeRoles, ["syn-transition-phrase", "syn-high-glass"])
      }
      if (!isPeak && genre.rhythmDensity < .36) removeRoles(activeRoles, ["dr-closed-hat", "syn-pulse"])
      if (!isPeak && genre.rhythmDensity > .7 && effectiveEnergy >= 40 && section.melodyRestRatio >= .12) {
        activeRoles.push("dr-closed-hat")
        if (genre.repetition >= .7) activeRoles.push("syn-pulse")
      }
      if (!isPeak && genre.phraseDensity < .3) removeRoles(activeRoles, ["syn-transition-phrase"])
      if (!isPeak && genre.decorationDensity < .26) {
        removeRoles(activeRoles, ["syn-high-glass"])
        selectedDecorationCharacter = "silence"
      }
      const soundApplies = arrangementSoundInstructionAppliesTo(
        effectiveDirective?.soundInstruction,
        section.sectionId,
        section.semanticRole,
        effectiveDirective?.sectionId,
      )
      const soundRoleIds = trackIdsForSoundInstruction(effectiveDirective?.soundInstruction)
      if (applies) activeRoles.push(...(effectiveDirective?.add ?? []).filter(
        (trackId) => soundApplies || !soundRoleIds.includes(trackId),
      ))
      if (soundApplies && effectiveDirective?.soundInstruction?.role === "silence") {
        activeRoles.splice(0, activeRoles.length)
      } else if (soundApplies) {
        activeRoles.push(...soundRoleIds)
      }
      if (selectedTransitionCharacter === "silence") {
        const index = activeRoles.indexOf("syn-transition-phrase")
        if (index >= 0) activeRoles.splice(index, 1)
      }
      const explicitBell = soundApplies && effectiveDirective?.soundInstruction?.role === "bell"
        || applies && (effectiveDirective?.add ?? []).includes("syn-high-glass")
      if (!explicitBell && activeRoles.includes("syn-transition-phrase") && activeRoles.includes("syn-high-glass")) {
        // 一つの境界でPhraseとDecorationを重ねず、短い接続フレーズへ役割を委ねる。
        removeRoles(activeRoles, ["syn-high-glass"])
        selectedDecorationCharacter = "silence"
      }
      const sectionLengthBeats = (sourceSection?.lengthBars ?? 1) * beatsPerBar
      const uniqueRoles = [...new Set(activeRoles)]
      const roleEntryBeats = roleEntryBeatsFor(section, uniqueRoles, sectionLengthBeats, beatsPerBar)
      if (candidateApproach === "space-led" && effectiveEnergy < 55) {
        if (uniqueRoles.includes("dr-kick")) roleEntryBeats["dr-kick"] = Math.max(roleEntryBeats["dr-kick"] ?? 0, beatsPerBar)
        if (uniqueRoles.includes("dr-snare")) roleEntryBeats["dr-snare"] = Math.max(roleEntryBeats["dr-snare"] ?? 0, beatsPerBar * 2)
      }
      const backHalfLiftBeat = backHalfLiftFor(sourceSection, effectiveSection, sectionShape, beatsPerBar)
      // 後半の発展はSection頭から全パートを鳴らすのではなく、役割の登場時点そのものを変える。
      if (backHalfLiftBeat !== undefined) {
        if (uniqueRoles.includes("dr-open-hat")) roleEntryBeats["dr-open-hat"] = Math.max(roleEntryBeats["dr-open-hat"] ?? 0, backHalfLiftBeat)
        if (uniqueRoles.includes("str-viola") && sectionShape !== "release") roleEntryBeats["str-viola"] = Math.max(roleEntryBeats["str-viola"] ?? 0, backHalfLiftBeat)
        if (uniqueRoles.includes("syn-high-glass")) roleEntryBeats["syn-high-glass"] = Math.max(roleEntryBeats["syn-high-glass"] ?? 0, backHalfLiftBeat)
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
          high: isPeak ? "strong" : effectiveEnergy >= 65 - (genre.registerRange - .5) * 15 ? "medium" : "open",
        },
        intention: applies && effectiveDirective?.intention
          ? effectiveDirective.intention
          : isPeak
          ? "それまで温存した音域と役割を開き、曲全体の最大解放を作る"
          : section.occurrence > 1
            ? `同じ役割の${section.occurrence}回目として、前回をコピーせず音域・周期・受け渡しを拡張する`
            : section.energyDelta > 0
              ? "次の段階へ向けて音数より期待と方向を増やす"
              : "主旋律の可読性を守り、前Sectionとの差を引き算で示す",
        activeRoles: uniqueRoles,
        semanticRole: section.semanticRole,
        developmentStage: developmentStageFor(section),
        phraseCycleBars: candidateApproach === "motif-led" || section.semanticRole === "intro" || section.semanticRole === "bridge" || section.semanticRole === "final" ? 8 : 4,
        grooveFamily: genre.rhythmDensity < .32 && !isPeak ? "suspended"
          : genre.rhythmDensity > .73 && !isPeak ? "driving"
          : genre.syncopation > .72 && !isPeak ? "broken"
          : character === "rhythmic" || candidateApproach === "rhythm-led" ? (isPeak ? "release" : "driving") : grooveFamilyFor(section),
        bassStrategy: character === "rhythmic" ? (isPeak ? "octave-drive" : "syncopated")
          : genre.bassMovement < .32 && !isPeak ? "sustain"
          : genre.bassMovement > .7 && genre.syncopation > .64 && !isPeak ? "syncopated"
          : genre.bassMovement > .62 && !isPeak ? "approach-led"
          : candidateApproach === "space-led"
          ? "sustain"
          : candidateApproach === "rhythm-led"
            ? (isPeak ? "octave-drive" : "syncopated")
            : candidateApproach === "motif-led" && effectiveEnergy < 68
              ? "melodic-pulse"
              : bassStrategyFor(section),
        harmonyStrategy: (genre.harmonicDensity < .36 || genre.sustain > .8 && genre.harmonicDensity < .6) && !isPeak ? "pedal-space"
          : genre.harmonicDensity > .72 && isPeak ? "register-expansion"
          : character === "minimal" ? "pedal-space" : character === "dark-experimental" ? "sparse-stabs" : character === "cinematic" && isPeak ? "register-expansion" : harmonyStrategyFor(section),
        rhythmGrammar,
        sectionShape,
        motifTreatment,
        preBoundaryDropBeats: boundaryDropFor(effectiveSection, effectiveNextSection, beatsPerBar, candidateApproach),
        backHalfLiftBeat,
        roleEntryBeats,
        harmonicHaze: harmonicHazeFor(genre, aesthetic),
        motifEcho: motifEchoFor(section, uniqueRoles, effectiveEnergy, isPeak),
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
  const candidates = note.pitch >= 72
    ? [note.pitch + 12, note.pitch - 12]
    : [note.pitch - 12, note.pitch + 12]
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
  melody: MelodyNote[],
  soundInstruction?: ArrangementSoundInstruction,
  directedSectionId?: string,
): GeneratedArrangementNote[] {
  const pitch = DRUM_PITCH[trackId]
  if (pitch === undefined) return []
  const beats: number[] = []
  const bars = Math.max(1, Math.ceil(length / beatsPerBar))
  const directedPercussion = trackId === "dr-field-drum"
    && soundInstruction?.role === "percussion"
    && arrangementSoundInstructionAppliesTo(
      soundInstruction,
      section.sectionId,
      section.semanticRole,
      directedSectionId,
    )
  if (directedPercussion && soundInstruction) {
    const sourceSteps = soundInstruction.rhythmSteps.length > 0
      ? soundInstruction.rhythmSteps
      : [0, 1.5, 2.75]
    for (let bar = 0; bar < bars; bar += 1) {
      if (soundInstruction.repetition === "none" && bar > 0) continue
      for (const step of sourceSteps) {
        const beat = start + bar * beatsPerBar + step * beatsPerBar / 4
        if (beat < start + length) beats.push(beat)
      }
    }
    return beats.map((beat, index) => makeNote(
      trackId,
      section.sectionId,
      index,
      beat,
      soundInstruction.articulation === "short" ? 0.1 : 0.2,
      pitch,
      48 + section.energy * 0.36 + (index % sourceSteps.length === 0 ? 10 : -3),
      `指定を実音化: ${arrangementSoundInstructionLabel(soundInstruction)}`,
      "safe",
    ))
  }
  for (let bar = 0; bar < bars; bar += 1) {
    const base = start + bar * beatsPerBar
    const cycleBar = (bar + revision) % (section.phraseCycleBars ?? 4)
    const isPhraseEnd = cycleBar === (section.phraseCycleBars ?? 4) - 1 || bar === bars - 1
    const groove = section.grooveFamily ?? "restrained"
    const grammar = section.rhythmGrammar ?? "song-led"
    const localSectionBeat = bar * beatsPerBar
    const afterLift = section.backHalfLiftBeat !== undefined && localSectionBeat >= section.backHalfLiftBeat
    if (trackId === "dr-kick") {
      if (grammar === "four-on-floor") {
        for (let beat = 0; beat < beatsPerBar; beat += beatsPerBar / 4) beats.push(base + beat)
        if ((section.sectionShape === "expansion" || section.sectionShape === "release") && (afterLift || cycleBar % 2 === 1)) beats.push(base + beatsPerBar - .5)
      } else if (grammar === "half-time") {
        if (cycleBar % 2 === 0 || section.sectionShape === "build") beats.push(base)
        if (afterLift || section.energy >= 58) beats.push(base + beatsPerBar * .625)
      } else if (grammar === "syncopated-pocket") {
        beats.push(base, base + beatsPerBar * .375)
        if (cycleBar % 2 === 1 || afterLift) beats.push(base + beatsPerBar * .6875)
        if (!isPhraseEnd && section.sectionShape !== "drop") beats.push(base + beatsPerBar - .5)
      } else if (grammar === "cinematic-pulse") {
        if (cycleBar % 2 === 0 || section.sectionShape === "build") beats.push(base)
        if (isPhraseEnd || afterLift) beats.push(base + beatsPerBar * .75)
      } else {
        if (groove !== "suspended" || cycleBar % 2 === 0) beats.push(base)
        if (groove === "restrained" && section.energy >= 34) beats.push(base + beatsPerBar / 2)
        if (["driving", "release"].includes(groove)) beats.push(base + beatsPerBar / 2)
        if (groove === "release") beats.push(base + beatsPerBar / 4, base + beatsPerBar * 0.75)
        if (groove === "driving" && section.developmentStage === 0 && cycleBar % 2 === 1) beats.push(base + beatsPerBar / 4)
        if (groove === "building" && cycleBar >= 2) beats.push(base + beatsPerBar / 2)
        if ((groove === "release" || (groove === "driving" && cycleBar % 2 === 1)) && !isPhraseEnd) beats.push(base + beatsPerBar - 0.5)
        if (groove === "broken" && cycleBar % 2 === 1) beats.push(base + beatsPerBar * 0.625)
      }
    } else if (trackId === "dr-snare") {
      if (grammar === "half-time" || grammar === "cinematic-pulse") beats.push(base + beatsPerBar / 2)
      else beats.push(base + beatsPerBar / 4, base + (beatsPerBar * 3) / 4)
      if (grammar === "syncopated-pocket" && cycleBar % 2 === 1) beats.push(base + beatsPerBar * .625)
      if ((groove === "release" || section.developmentStage === 2 || afterLift && section.sectionShape === "expansion") && cycleBar % 2 === 1) {
        beats.push(base + beatsPerBar / 4 + 0.03, base + (beatsPerBar * 3) / 4 + 0.03)
      }
      if (groove === "release" && isPhraseEnd) beats.push(base + beatsPerBar - 0.25)
    } else if (trackId === "dr-closed-hat") {
      const step = grammar === "four-on-floor" || grammar === "syncopated-pocket" || afterLift || groove === "release" || cycleBar >= 2 && groove === "building" ? 0.5 : 1
      for (let beat = step / 2; beat < beatsPerBar; beat += step) {
        const pocketGap = grammar === "syncopated-pocket" && cycleBar % 2 === 0 && Math.abs(beat - beatsPerBar * .625) < .08
        if (!pocketGap && !(isPhraseEnd && beat >= beatsPerBar - 0.5)) beats.push(base + beat)
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
  const dropStart = start + length - (section.preBoundaryDropBeats ?? 0)
  const dropsAtBoundary = new Set<ArrangementTrackId>(["dr-kick", "dr-snare", "dr-closed-hat", "dr-open-hat"])
  const shapedBeats = [...new Set(beats.map((beat) => Math.round(beat * 1000) / 1000))].filter((beat) => {
    if (beat >= start + length) return false
    if ((section.preBoundaryDropBeats ?? 0) > 0 && dropsAtBoundary.has(trackId) && beat >= dropStart) return false
    const nearLeadAttack = melody.some((note) => Math.abs(note.startBeat - beat) <= 0.12)
    const barOffset = ((beat - start) % beatsPerBar + beatsPerBar) % beatsPerBar
    if (trackId === "dr-kick") return barOffset < 0.08 || !nearLeadAttack
    if (trackId === "dr-field-drum" || trackId === "dr-low-tom" || trackId === "dr-high-tom") return !nearLeadAttack
    if (trackId === "dr-closed-hat" && section.semanticRole !== "final") {
      const barStart = beat - barOffset
      const attacks = melody.filter((note) => note.startBeat >= barStart && note.startBeat < barStart + beatsPerBar).length
      if (attacks >= 3 && Math.round(barOffset * 2) % 4 >= 2) return false
    }
    return true
  })
  return shapedBeats.map((beat, index) => makeNote(
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

function sharedBassPedalPc(chords: ChordEvent[]): number | null {
  if (chords.length < 2) return null
  const parsed = chords.map((chord) => parseChordSymbol(chord.symbol, chord.bass ?? undefined))
  if (parsed.some((chord) => !chord || chord.bassPc !== chord.rootPc)) return null
  const first = parsed[0]!
  const common = first.tones.map((tone) => tone.pitchClass).filter((pitchClass) =>
    parsed.every((chord) => chord && [...chord.tones, ...chord.tensions].some((tone) => tone.pitchClass === pitchClass)))
  return common.find((pitchClass) => pitchClass === first.bassPc)
    ?? common.find((pitchClass) => pitchClass !== first.rootPc)
    ?? null
}

function quietPadVoicing(
  chord: NonNullable<ReturnType<typeof parseChordSymbol>>,
  previous: number[],
  haze = .5,
): number[] {
  // 漂わせるほど付加音(9th など)を残し、半音で動く声部を選ぶ(Delius 的な色)。中立(0.5)以下では従来どおり
  const drift = Math.max(0, haze - .5) * 2
  // 三和音しか書かれていなくても、漂わせる場面では 9th(根音の全音上)を色として残せる。減5度を含む和音には足さない
  const ninth = drift > 0 && chord.tensions.length === 0 && !chord.tones.some((tone) => (tone.pitchClass - chord.rootPc + 12) % 12 === 6)
    ? [{ ...chord.tones[0], pitchClass: (chord.rootPc + 2) % 12 }]
    : []
  const palette = [...chord.tones.slice(1), ...chord.tensions.slice(0, 1), ...ninth, chord.tones[0]]
    .filter((tone, index, all) => all.findIndex((candidate) => candidate.pitchClass === tone.pitchClass) === index)
  const anchors = [53, 60, 67]
  const options = anchors.map((anchor, voice) => palette.flatMap((tone) => {
    const nearest = midiForPc(tone.pitchClass, previous[voice] ?? anchor)
    return [nearest - 12, nearest, nearest + 12]
      .filter((pitch) => pitch >= 48 + voice * 4 && pitch <= 64 + voice * 5)
      .map((pitch) => ({ pitch, pitchClass: tone.pitchClass, isTension: !chord.tones.some((item) => item.pitchClass === tone.pitchClass) }))
  }))
  let best: number[] | undefined
  let bestCost = Infinity
  for (const low of options[0]) for (const mid of options[1]) for (const high of options[2]) {
    if (new Set([low.pitchClass, mid.pitchClass, high.pitchClass]).size < 3) continue
    if (mid.pitch - low.pitch < 3 || high.pitch - mid.pitch < 3) continue
    if (mid.pitch - low.pitch > 12 || high.pitch - mid.pitch > 12) continue
    const choice = [low, mid, high]
    const cost = choice.reduce((sum, note, voice) => {
      const move = Math.abs(note.pitch - (previous[voice] ?? anchors[voice]))
      return sum
        + (move === 1 ? move * (1 - drift * .5) : move)
        + Math.abs(note.pitch - anchors[voice]) * 0.12
        + (note.isTension ? 0.8 - drift * 3 : 0)
    }, 0)
    if (cost < bestCost) {
      bestCost = cost
      best = choice.map((note) => note.pitch)
    }
  }
  return best ?? palette.slice(0, 3).map((tone, voice) => midiForPc(tone.pitchClass, previous[voice] ?? anchors[voice]))
}

function generateTonalTrack(
  trackId: ArrangementTrackId,
  section: ArrangementSectionPlan,
  sourceSection: ComposerProject["sections"][number],
  sectionChords: ChordEvent[],
  melody: MelodyNote[],
  beatsPerBar: number,
  revision: number,
  arrangementSeed: number,
  soundInstruction?: ArrangementSoundInstruction,
  directedSectionId?: string,
): GeneratedArrangementNote[] {
  const start = sectionOffset(sourceSection.startBar, beatsPerBar)
  const length = sourceSection.lengthBars * beatsPerBar
  const variationPhase = (arrangementSeed + hashText(`${section.sectionId}:${trackId}`)) % (section.phraseCycleBars ?? 4)
  const notes: GeneratedArrangementNote[] = []
  const add = (beat: number, duration: number, pitch: number, velocity: number, index: number, character: ArrangementCandidateCharacter = "safe", reason = TRACK_PURPOSE[trackId]) => {
    notes.push(avoidMelodyCollision(makeNote(trackId, section.sectionId, index, start + beat, duration, pitch, velocity, reason, character), melody))
  }
  const directedSoundApplies = Boolean(
    soundInstruction
    && trackMatchesSoundInstruction(trackId, soundInstruction)
    && arrangementSoundInstructionAppliesTo(
      soundInstruction,
      section.sectionId,
      section.semanticRole,
      directedSectionId,
    ),
  )
  if (directedSoundApplies && soundInstruction) {
    if (soundInstruction.role === "silence" || soundInstruction.behavior === "silence") return []
    const defaultSteps = soundInstruction.behavior === "riff"
      ? [0, 0.75, 1.5, 2.75]
      : soundInstruction.behavior === "pulse"
        ? [0.5, 1.5, 2.5, 3.5]
        : soundInstruction.behavior === "hit"
          ? [0, 2.5]
          : [0]
    const sourceSteps = soundInstruction.rhythmSteps.length > 0
      ? soundInstruction.rhythmSteps
      : defaultSteps
    const candidateSteps = revision % 3 === 1 && sourceSteps.length < 8
      ? [...sourceSteps, Math.min(3.75, (sourceSteps.at(-1) ?? 0) + 0.5)]
      : revision % 3 === 2 && sourceSteps.length > 2
        ? sourceSteps.filter((_, index) => index !== sourceSteps.length - 2)
        : sourceSteps
    const scaledSteps = [...new Set(candidateSteps)]
      .filter((step) => step >= 0 && step < 4)
      .map((step) => step * beatsPerBar / 4)
      .sort((left, right) => left - right)
    const bars = Math.max(1, Math.ceil(length / beatsPerBar))
    const registerBase = soundInstruction.register === "low" ? 43 : soundInstruction.register === "high" ? 78 : 61
    const durationFor = (localBeat: number) => {
      if (soundInstruction.articulation === "short") return Math.min(0.24, beatsPerBar / 8)
      if (soundInstruction.articulation === "long" || soundInstruction.articulation === "legato") {
        return Math.min(beatsPerBar * 0.96, length - localBeat)
      }
      return Math.min(0.65, beatsPerBar / 3)
    }
    const trackVoice = trackId === "str-cello" ? 0 : trackId === "str-viola" ? 1 : 2
    for (let bar = 0; bar < bars; bar += 1) {
      if (soundInstruction.repetition === "none" && bar > 0 && soundInstruction.behavior !== "sustain" && soundInstruction.behavior !== "swell") continue
      const isFill = soundInstruction.behavior === "fill"
      if (isFill && bar < bars - 1) continue
      const steps = soundInstruction.repetition === "evolving" && bar % 4 === 3 && scaledSteps.length > 1
        ? [...scaledSteps, Math.min(beatsPerBar - 0.25, scaledSteps.at(-1)! + beatsPerBar / 8)]
        : scaledSteps
      for (const [hitIndex, offsetInBar] of steps.entries()) {
        const localBeat = bar * beatsPerBar + offsetInBar
        if (localBeat >= length) continue
        const chord = chordAtBeat(sectionChords, localBeat)
        const pcs = chordTonePcs(chord)
        const directionIndex = soundInstruction.motion === "descending"
          ? pcs.length - 1 - ((bar + hitIndex) % pcs.length)
          : soundInstruction.motion === "wave"
            ? Math.abs(((bar + hitIndex) % Math.max(1, pcs.length * 2 - 2)) - (pcs.length - 1))
            : soundInstruction.motion === "ascending"
              ? (bar + hitIndex) % pcs.length
              : hitIndex % pcs.length
        const materialPcs = soundInstruction.material === "chord"
          ? pcs.slice(0, 3)
          : soundInstruction.material === "dyad"
            ? pcs.slice(0, 2)
            : soundInstruction.material === "root"
              ? pcs.slice(0, 1)
              : [pcs[Math.max(0, directionIndex)] ?? pcs[0]]
        const voicedPcs = trackId.startsWith("str-") ? [materialPcs[trackVoice % materialPcs.length]] : materialPcs
        for (const [voice, pitchClass] of voicedPcs.entries()) {
          const pitch = midiForPc(pitchClass, registerBase + voice * 5)
          const progress = length <= 0 ? 0 : localBeat / length
          const velocity = 48 + section.energy * 0.28
            + (hitIndex === 0 ? 10 : 0)
            + (soundInstruction.behavior === "swell" ? progress * 24 : 0)
          add(
            localBeat,
            durationFor(localBeat) + voice * 0.008,
            pitch,
            velocity,
            notes.length,
            "safe",
            `指定を実音化: ${arrangementSoundInstructionLabel(soundInstruction)}`,
          )
        }
      }
    }
    return notes
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
    // 持続低音: Janáček / Delius では同じ最低音が2小節以上続く時間が約1割(Schumann / Brahms の3〜5倍)。
    // 漂わせる場面の静かな Verse にも、景色だけを変える保続低音を許す
    // (初出の静かな Verse だけ。保続が曲の大半を占めないように)
    const quietHaze = (section.harmonicHaze ?? .5) >= .65 && section.energy < 40 && section.semanticRole === "verse" && (section.developmentStage ?? 0) === 0
    const bassPedal = (strategy === "sustain" && ["intro", "breakdown", "bridge", "reprise", "outro"].includes(section.semanticRole ?? "")) || quietHaze
      ? sharedBassPedalPc(sectionChords)
      : null
    const patterns: Record<NonNullable<ArrangementSectionPlan["bassStrategy"]>, number[]> = {
      sustain: [0],
      "melodic-pulse": [0, 2.5],
      syncopated: [0, 1.5, 3.5],
      "octave-drive": [0, 1.5, 2.75],
      "approach-led": [0, 2.5, 3.5],
    }
    const bars = Math.max(1, Math.ceil(length / beatsPerBar))
    for (let bar = 0; bar < bars; bar += 1) {
      const cycleBar = (bar + revision + variationPhase) % (section.phraseCycleBars ?? 4)
      let offsets = strategy === "sustain" && cycleBar % 2 === 1 ? [] : patterns[strategy]
      if (strategy !== "sustain") {
        if (section.rhythmGrammar === "half-time") offsets = section.energy >= 58 ? [0, 2.5] : [0]
        else if (section.rhythmGrammar === "four-on-floor") offsets = [0, 1, 2, 3]
        else if (section.rhythmGrammar === "syncopated-pocket") offsets = [0, 1.5, 2.75, 3.5]
        else if (section.rhythmGrammar === "cinematic-pulse") offsets = cycleBar % 2 === 0 ? [0, 3] : [2.5]
        if (section.motifTreatment === "fragmentation" && cycleBar % 2 === 1) offsets = offsets.filter((_, index) => index !== 1)
        if (section.motifTreatment === "augmentation" && cycleBar % 2 === 1) offsets = offsets.slice(0, 1)
      }
      offsets.forEach((offsetInBar, hitIndex) => {
        const localBeat = bar * beatsPerBar + offsetInBar
        if (localBeat >= length) return
        const barStart = start + bar * beatsPerBar
        const barEnd = Math.min(start + length, barStart + beatsPerBar)
        const leadOccupancy = melody.reduce((sum, lead) => sum + Math.max(0,
          Math.min(barEnd, lead.startBeat + lead.durationBeats) - Math.max(barStart, lead.startBeat)), 0)
          / Math.max(0.01, barEnd - barStart)
        const chord = chordAtBeat(sectionChords, localBeat)
        const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
        if (!parsed) return
        const rootPitch = midiForPc(bassPedal ?? parsed.bassPc, 39)
        const nextBeat = Math.min(length - 0.01, localBeat + Math.max(0.25, beatsPerBar - offsetInBar))
        const nextChord = chordAtBeat(sectionChords, nextBeat)
        const nextParsed = nextChord ? parseChordSymbol(nextChord.symbol, nextChord.bass ?? undefined) : null
        // 歌が密な小節ではBassの補助音を引く。次コードへの明確な接近音だけは残せる。
        const isApproach = strategy === "approach-led" && hitIndex === offsets.length - 1 && nextParsed && nextChord?.id !== chord?.id
        if (hitIndex > 0 && leadOccupancy >= 0.72 && !isApproach) return
        if (hitIndex > 0 && section.rhythmGrammar !== "four-on-floor"
          && melody.some((lead) => Math.abs(lead.startBeat - start - localBeat) <= 0.12)) return
        let pitch = rootPitch
        let character: ArrangementCandidateCharacter = "safe"
        let reason = bassPedal === null
          ? "コードの重心を保ちながら、4小節周期の独立したBass lineを作る"
          : "共通音を低音に保持し、和声の見え方だけを静かに変える"
        if (strategy === "octave-drive" && (hitIndex + cycleBar) % 3 === 2) pitch += 12
        else if (strategy === "melodic-pulse" && hitIndex === 1) pitch = midiForPc(parsed.tones[2]?.pitchClass ?? parsed.rootPc, 43)
        else if (strategy === "syncopated" && hitIndex === offsets.length - 1) pitch = midiForPc(parsed.tones[1]?.pitchClass ?? parsed.rootPc, 40)
        else if (isApproach && nextParsed) {
          const target = midiForPc(nextParsed.bassPc, 39)
          pitch = target + ((bar + revision + variationPhase) % 2 === 0 ? -1 : 2)
          character = "edge"
          reason = "次の和音へ解決するアプローチ音でSectionの方向を作る"
        }
        if (section.motifTreatment === "inversion" && hitIndex > 0 && !isApproach) {
          const colour = parsed.tones[(parsed.tones.length - hitIndex % parsed.tones.length) % parsed.tones.length]?.pitchClass ?? parsed.rootPc
          pitch = midiForPc(colour, 40)
          reason = "前回の動きと逆向きの応答を低音に作り、同じSectionのコピーを避ける"
        } else if (section.motifTreatment === "answer" && hitIndex === offsets.length - 1 && !isApproach) {
          pitch = midiForPc(parsed.tones[1]?.pitchClass ?? parsed.rootPc, 42)
          reason = "前回と同じコードでも終わりの音を変え、低音に短い応答を作る"
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
      const cycleBar = (bar + revision + variationPhase) % (section.phraseCycleBars ?? 4)
      let offsets = cycleBar === 0
          ? [1.5]
          : cycleBar === 2
            ? [3.5]
            : (section.developmentStage ?? 0) >= 1 && cycleBar === 3
              ? [3.5]
              : []
      if (section.rhythmGrammar === "four-on-floor") offsets = cycleBar % 2 === 0 ? [1.5, 3.5] : [2.5]
      else if (section.rhythmGrammar === "syncopated-pocket") offsets = cycleBar % 2 === 0 ? [.75, 2.75] : [1.5, 3.5]
      else if (section.rhythmGrammar === "cinematic-pulse") offsets = cycleBar === 0 || cycleBar === 3 ? [0] : []
      else if (section.rhythmGrammar === "half-time") offsets = cycleBar % 2 === 0 ? [2.5] : []
      if (section.motifTreatment === "fragmentation" && cycleBar % 2 === 1) offsets = offsets.slice(-1)
      if (section.motifTreatment === "inversion") offsets = offsets.map((offset) => Math.max(.25, beatsPerBar - offset - .5))
      offsets.forEach((offsetInBar, hitIndex) => {
        const localBeat = bar * beatsPerBar + offsetInBar
        if (localBeat >= length) return
        // A short chord accent belongs in a genuine vocal rest, not on top of a sustained syllable.
        if (melody.some((lead) => lead.startBeat < start + localBeat + 0.25 &&
          lead.startBeat + lead.durationBeats > start + localBeat)) return
        const chord = chordAtBeat(sectionChords, localBeat)
        chordTonePcs(chord).slice(0, 3).forEach((tone, voice) => add(
          localBeat,
          0.18 + voice * 0.015,
          midiForPc(tone, 62 + voice * 7),
          43 + section.energy * 0.28 + (hitIndex === 0 ? 5 : 0),
          notes.length,
          "safe",
          section.motifTreatment === "none"
            ? "主旋律の空白と裏拍だけに短い和音アクセントを置く"
            : `主旋律の空白で特徴を${section.motifTreatment === "fragmentation" ? "短く切り分け" : section.motifTreatment === "inversion" ? "逆向きに応答させ" : "別の位置から答え"}、前回のSectionをコピーしない`,
        ))
      })
    }
    return notes
  }
  if (trackId === "syn-dark-pad" || trackId.startsWith("str-")) {
    const stringPeriodBars = section.motifTreatment === "augmentation" ? 4 : trackId === "str-upper" ? 4 : 2
    const segmentBeats = trackId === "syn-dark-pad" ? beatsPerBar : beatsPerBar * stringPeriodBars
    let previousPadPitches: number[] = []
    const padVoiceNotes: GeneratedArrangementNote[] = []
    let previousPitch: number | undefined
    for (let localBeat = 0; localBeat < length - 0.01; localBeat += segmentBeats) {
      const chord = chordAtBeat(sectionChords, localBeat)
      const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
      if (!parsed) continue
      const duration = Math.min(segmentBeats, length - localBeat) * 0.96
      if (trackId === "syn-dark-pad") {
        const haze = section.harmonicHaze ?? .5
        const pitches = quietPadVoicing(parsed, previousPadPitches, haze)
        const padCycle = (Math.floor(localBeat / beatsPerBar) + revision + variationPhase) % 4
        const breathFactors = [0.96, 0.88, 0.94, 0.84]
        pitches.forEach((pitch, voice) => {
          const voiceOffset = 0
          // 漂わせる場面では、次の和音にも残る音を弾き直さず伸ばす(長い持続と共通音で境目を溶かす)
          const held = haze > .6 && previousPadPitches[voice] === pitch ? padVoiceNotes[voice] : undefined
          if (held && Math.abs(held.startBeat + held.durationBeats - (start + localBeat)) < beatsPerBar * .2) {
            held.durationBeats = start + localBeat + Math.max(0.25, duration * breathFactors[padCycle]) - held.startBeat
            held.reason = "次の和音にも残る音を弾き直さずに伸ばし、和声の境目を溶かす"
            return
          }
          const harmonyBreath = section.harmonyStrategy === "pedal-space"
            ? 1
            : section.harmonyStrategy === "sparse-stabs"
              ? .72
              : breathFactors[padCycle]
          add(localBeat + voiceOffset, Math.max(0.25, duration * (haze > .6 ? 1 : harmonyBreath) - voiceOffset), pitch, 30 + section.energy * 0.17,
            notes.length, "safe", "共通音と最短Voice Leadingを優先し、和声の変化だけを静かに示す")
          padVoiceNotes[voice] = notes[notes.length - 1]
        })
        previousPadPitches = pitches
      } else {
        const phraseIndex = Math.floor(localBeat / segmentBeats)
        const phraseOffset = section.motifTreatment === "inversion"
          ? ((phraseIndex + revision + variationPhase + 1) % 2) * (beatsPerBar / 2)
          : ((phraseIndex + revision + variationPhase) % 2) * (beatsPerBar / 2)
        const soundingChord = chordAtBeat(sectionChords, localBeat + phraseOffset)
        const soundingParsed = (soundingChord ? parseChordSymbol(soundingChord.symbol, soundingChord.bass ?? undefined) : null) ?? parsed
        const targetIndex = trackId === "str-cello" ? 0 : trackId === "str-viola" ? 1 : trackId === "str-violin-2" ? 2 : trackId === "str-violin-1" ? 1 : 2
        const around = trackId === "str-cello" ? 48 : trackId === "str-viola" ? 60 : trackId === "str-violin-2" ? 67 : trackId === "str-violin-1" ? 74 : 86
        const pool = [...soundingParsed.tones.slice(1), ...soundingParsed.tensions]
        const motion = section.motifTreatment === "inversion" ? -phraseIndex : phraseIndex
        const shiftedIndex = ((targetIndex + motion + (section.developmentStage ?? 0)) % Math.max(1, pool.length) + Math.max(1, pool.length)) % Math.max(1, pool.length)
        const tone = pool[shiftedIndex]?.pitchClass ?? soundingParsed.rootPc
        const pitch = midiForPc(tone, previousPitch ?? around)
        previousPitch = pitch
        add(localBeat + phraseOffset, Math.max(0.25, duration - phraseOffset), pitch, 38 + section.energy * 0.3, notes.length, trackId === "str-upper" ? "edge" : "safe", trackId === "str-upper" ? "最終ピークだけに上声を開く" : section.motifTreatment === "none" ? "2〜4小節単位の長い弧で内声を動かし、主旋律の呼吸を残す" : "前回の輪郭をそのまま複製せず、内声の向きと長さを発展させる")
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
        const cycleBar = (Math.floor(barBeat / beatsPerBar) + revision + variationPhase + chordIndex) % (section.phraseCycleBars ?? 4)
        let offsets = section.energy >= 82
          ? cycleBar === 3 ? [0, 0.5, 1.5, 2.5, 3.5] : [0.5, 1.5, 2.5, 3.5]
          : cycleBar === 3 ? [0.5, 1.5, 3.5] : cycleBar === 1 ? [0.5, 2.5] : [0.5, 1.5, 2.5]
        if (section.rhythmGrammar === "half-time") offsets = cycleBar % 2 === 0 ? [.5, 2.5] : [1.5]
        else if (section.rhythmGrammar === "four-on-floor") offsets = cycleBar % 4 !== 1 ? [.5, 1.5, 2.5, 3.5] : [.5, 1.5, 3.5]
        else if (section.rhythmGrammar === "syncopated-pocket") offsets = cycleBar % 2 === 0 ? [.75, 1.5, 2.75] : [.5, 2.25, 3.5]
        else if (section.rhythmGrammar === "cinematic-pulse") offsets = cycleBar % 2 === 0 ? [0, 2] : [1.5, 3.5]
        if (section.motifTreatment === "fragmentation" && cycleBar % 2 === 1) offsets = offsets.filter((_, index) => index % 2 === 0)
        if (section.motifTreatment === "augmentation") offsets = offsets.slice(0, Math.max(1, Math.ceil(offsets.length / 2)))
        for (const offsetInBar of offsets) {
          const beat = barBeat + offsetInBar
          if (beat >= chordEnd) continue
          const register = section.sectionShape === "release" || section.backHalfLiftBeat !== undefined && beat >= section.backHalfLiftBeat ? 69 : 57
          const pcIndex = section.motifTreatment === "inversion"
            ? (pcs.length - 1 - (notes.length + variationPhase) % pcs.length)
            : (notes.length + variationPhase) % pcs.length
          add(beat, 0.22, midiForPc(pcs[pcIndex], register), 40 + section.energy * 0.28, notes.length, "safe", section.motifTreatment === "none" ? "4〜8小節周期の欠落とアクセントで、連打ではない推進力を作る" : "主旋律の特徴を短く変形し、同じコードでも前回と異なる推進を作る")
        }
      }
    }
  }
  return notes
}

function emptyTrack(id: ArrangementTrackId, revision = 0): GeneratedArrangementTrack {
  return { id, name: ARRANGEMENT_TRACK_NAMES[id], family: TRACK_FAMILY[id], muted: false, notes: [], generationRevision: revision, purpose: TRACK_PURPOSE[id] }
}

function layerEnabledInSection(trackId: ArrangementLayerTrackId, section: ArrangementSectionPlan): boolean {
  const role = section.semanticRole ?? "other"
  const energy = section.energy
  if (trackId === "dr-kick-sub") return energy >= 44 || ["chorus", "build", "final"].includes(role)
  if (trackId === "dr-kick-click") return energy >= 32 && role !== "outro"
  if (trackId === "dr-snare-body") return energy >= 38
  if (trackId === "dr-clap") return energy >= 66 && ["chorus", "final"].includes(role)
  if (trackId === "dr-shaker") return energy >= 42 && !["breakdown", "outro"].includes(role)
  if (trackId === "dr-ride") return energy >= 72 && (role === "final" || section.developmentStage !== 0)
  if (trackId === "dr-percussion-high") return energy >= 54 && ["pre", "build", "final"].includes(role)
  if (trackId === "dr-cymbal-swell") return energy >= 70 && ["chorus", "final"].includes(role)
  if (trackId === "dr-impact") return role === "final"
  if (trackId === "syn-sub-bass") return energy >= 28 && role !== "outro"
  if (trackId === "syn-bass-mid") return energy >= 46
  if (trackId === "syn-arp-low") return energy >= 48
  if (trackId === "syn-arp-high") return energy >= 72 && (role === "final" || section.developmentStage !== 0)
  if (trackId === "syn-chord-wide") return energy >= 68
  if (trackId === "syn-pad-air") return ["intro", "breakdown", "bridge", "reprise", "final"].includes(role)
  if (trackId === "syn-pad-motion") return energy >= 48 && role !== "outro"
  if (trackId === "str-contrabass") return energy >= 52 && ["pre", "chorus", "bridge", "build", "final"].includes(role)
  if (trackId === "str-spiccato") return energy >= 60 && ["pre", "build", "final"].includes(role)
  return role === "final"
}

function padVoiceRanks(notes: GeneratedArrangementNote[]): Map<string, number> {
  const groups = new Map<string, GeneratedArrangementNote[]>()
  for (const note of notes) {
    const key = `${note.sectionId}:${note.startBeat.toFixed(3)}`
    groups.set(key, [...(groups.get(key) ?? []), note])
  }
  const ranks = new Map<string, number>()
  for (const group of groups.values()) {
    group.sort((left, right) => left.pitch - right.pitch)
    group.forEach((note, index) => ranks.set(note.id, index - (group.length - 1) / 2))
  }
  return ranks
}

function deriveArrangementLayerTrack(
  source: GeneratedArrangementTrack,
  trackId: ArrangementLayerTrackId,
  plan: ArrangementPlan,
  revision: number,
): GeneratedArrangementTrack {
  const sectionPlans = new Map(plan.sections.map((section) => [section.sectionId, section]))
  const eligible = source.notes.filter((note) => {
    const section = sectionPlans.get(note.sectionId)
    return section ? layerEnabledInSection(trackId, section) : false
  })
  const ranks = padVoiceRanks(eligible)
  const makeLayerNote = (
    note: GeneratedArrangementNote,
    index: number,
    changes: Partial<GeneratedArrangementNote>,
    suffix = "",
  ): GeneratedArrangementNote => ({
    ...note,
    ...changes,
    id: `${trackId}:${note.id}:${revision}:${index}${suffix}`,
    startBeat: Math.max(0, changes.startBeat ?? note.startBeat),
    pitch: Math.max(0, Math.min(127, Math.round(changes.pitch ?? note.pitch))),
    velocity: Math.max(1, Math.min(127, Math.round(changes.velocity ?? note.velocity))),
    durationBeats: Math.max(0.0625, changes.durationBeats ?? note.durationBeats),
    reason: TRACK_PURPOSE[trackId],
  })

  let notes: GeneratedArrangementNote[] = []
  if (trackId === "str-spiccato") {
    notes = eligible.flatMap((note, index) => {
      const count = Math.max(1, Math.floor(note.durationBeats))
      return Array.from({ length: count }, (_, pulse) => makeLayerNote(note, index, {
        startBeat: note.startBeat + pulse + (pulse % 2 === 0 ? .25 : .5),
        durationBeats: 0.34,
        velocity: note.velocity - 8 + (pulse % 2 === 0 ? 4 : -3),
      }, `:${pulse}`))
    })
  } else {
    notes = eligible.flatMap((note, index) => {
      if (trackId === "dr-kick-sub") return [makeLayerNote(note, index, { pitch: 35, durationBeats: 0.32, velocity: note.velocity - 12 })]
      if (trackId === "dr-kick-click") return [makeLayerNote(note, index, { pitch: 37, durationBeats: 0.07, velocity: note.velocity - 18 })]
      if (trackId === "dr-snare-body") return [makeLayerNote(note, index, { pitch: 40, durationBeats: 0.22, velocity: note.velocity - 9 })]
      if (trackId === "dr-clap") return [makeLayerNote(note, index, { pitch: 39, startBeat: note.startBeat + 0.018, durationBeats: 0.12, velocity: note.velocity - 14 })]
      if (trackId === "dr-shaker") return [makeLayerNote(note, index, { pitch: 82, startBeat: note.startBeat + (index % 2 === 0 ? -0.008 : 0.012), durationBeats: 0.07, velocity: note.velocity - 16 })]
      if (trackId === "dr-ride") {
        if (Math.abs(note.startBeat - Math.round(note.startBeat)) > 0.08) return []
        return [makeLayerNote(note, index, { pitch: 51, durationBeats: 0.28, velocity: note.velocity - 10 })]
      }
      if (trackId === "dr-percussion-high") return [makeLayerNote(note, index, { pitch: 63, startBeat: note.startBeat + 0.125, durationBeats: 0.14, velocity: note.velocity - 11 })]
      if (trackId === "dr-cymbal-swell") return [makeLayerNote(note, index, { pitch: 52, durationBeats: 1.5, velocity: note.velocity - 24 })]
      if (trackId === "dr-impact") return [makeLayerNote(note, index, { pitch: 41, durationBeats: 0.55, velocity: note.velocity - 8 })]
      if (trackId === "syn-sub-bass") {
        let pitch = note.pitch
        while (pitch > 35) pitch -= 12
        return [makeLayerNote(note, index, { pitch, durationBeats: Math.max(0.7, note.durationBeats), velocity: note.velocity - 15 })]
      }
      if (trackId === "syn-bass-mid") {
        if (index % 2 === 1 && note.durationBeats < 0.7) return []
        return [makeLayerNote(note, index, { pitch: note.pitch + 12, durationBeats: Math.min(0.48, note.durationBeats), velocity: note.velocity - 12 })]
      }
      if (trackId === "syn-arp-low") {
        if (index % 2 !== 0) return []
        return [makeLayerNote(note, index, { pitch: note.pitch - 12, startBeat: note.startBeat + .25, durationBeats: 0.16, velocity: note.velocity - 11 })]
      }
      if (trackId === "syn-arp-high") {
        if (index % 2 === 0) return []
        return [makeLayerNote(note, index, { pitch: note.pitch + 12, startBeat: note.startBeat + .25, durationBeats: 0.12, velocity: note.velocity - 16 })]
      }
      if (trackId === "syn-chord-wide") {
        const rank = ranks.get(note.id) ?? 0
        const shift = rank < 0 ? -12 : rank > 0 ? 12 : 0
        return [makeLayerNote(note, index, { pitch: note.pitch + shift, startBeat: note.startBeat + .25, durationBeats: note.durationBeats * 0.82, velocity: note.velocity - 13 })]
      }
      if (trackId === "syn-pad-air") {
        if ((ranks.get(note.id) ?? 0) <= 0) return []
        return [makeLayerNote(note, index, { pitch: note.pitch + 12, startBeat: note.startBeat + .25, durationBeats: note.durationBeats * 1.02, velocity: note.velocity - 18 })]
      }
      if (trackId === "syn-pad-motion") {
        if (Math.abs(ranks.get(note.id) ?? 0) > 0.6) return []
        return [makeLayerNote(note, index, { startBeat: note.startBeat + .5, durationBeats: note.durationBeats * 0.72, velocity: note.velocity - 12 })]
      }
      if (trackId === "str-contrabass") return [makeLayerNote(note, index, { pitch: note.pitch - 12, velocity: note.velocity - 10 })]
      if (trackId === "str-high-octave") {
        if (index % 2 !== 0) return []
        return [makeLayerNote(note, index, { pitch: note.pitch + 12, startBeat: note.startBeat + .25, durationBeats: note.durationBeats * 0.9, velocity: note.velocity - 12 })]
      }
      return []
    })
  }
  return {
    ...emptyTrack(trackId, revision),
    notes: notes.sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch),
  }
}

function layerTrackIdsFor(baseTrackIds: ArrangementTrackId[]): ArrangementLayerTrackId[] {
  const active = new Set(baseTrackIds)
  return (Object.entries(ARRANGEMENT_LAYER_SOURCES) as Array<[ArrangementLayerTrackId, ArrangementTrackId]>)
    .filter(([, source]) => active.has(source))
    .map(([trackId]) => trackId)
}

function generateTrack(
  project: ComposerProject,
  plan: ArrangementPlan,
  trackId: ArrangementTrackId,
  revision = 0,
  onlySectionId?: string,
  variationSeed = plan.seed,
): GeneratedArrangementTrack {
  if (isArrangementLayerTrackId(trackId)) {
    const sourceId = ARRANGEMENT_LAYER_SOURCES[trackId]
    return deriveArrangementLayerTrack(
      generateTrack(project, plan, sourceId, revision, onlySectionId, variationSeed),
      trackId,
      plan,
      revision,
    )
  }
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
      generated = generateDrums(
        trackId,
        sectionPlan,
        offset,
        length,
        beatsPerBar,
        revision,
        material.lead,
        plan.directive?.soundInstruction,
        plan.directive?.sectionId,
      )
    } else {
      const chords = project.chords.filter((chord) => chord.sectionId === section.id).sort((a, b) => a.startBeat - b.startBeat)
      generated = generateTonalTrack(
        trackId,
        sectionPlan,
        section,
        chords,
        material.lead,
        beatsPerBar,
        revision,
        variationSeed,
        plan.directive?.soundInstruction,
        plan.directive?.sectionId,
      )
    }
    const echoes = !plan.directive?.soundInstruction && (
      trackId === "syn-bass" && sectionPlan.motifEcho === "bass" || trackId === "str-viola" && sectionPlan.motifEcho === "inner")
    if (echoes) {
      const chords = project.chords.filter((chord) => chord.sectionId === section.id).sort((a, b) => a.startBeat - b.startBeat)
      generated = applyMotifEcho(generated, trackId, sectionPlan, offset, length, chords, material.lead, beatsPerBar)
    }
    const boundaryDrop = sectionPlan.preBoundaryDropBeats ?? 0
    if (boundaryDrop > 0 && ["syn-bass", "syn-pulse", "syn-stabs"].includes(trackId)) {
      const dropStart = offset + length - boundaryDrop
      generated = generated.flatMap((note) => {
        if (note.startBeat >= dropStart) return []
        if (note.startBeat + note.durationBeats <= dropStart) return [note]
        return [{ ...note, durationBeats: Math.max(.0625, dropStart - note.startBeat), reason: `${note.reason}。次のSection直前は休ませる` }]
      })
    }
    track.notes.push(...generated.filter((note) => note.startBeat + 0.001 >= entryBeat))
  }
  return track
}

/**
 * 主旋律の休みに、核(セクション冒頭の3〜4音)のリズムだけを既存パートが一度受け継ぐ。
 * 音はその場の和音の構成音から、核の上下の向きをなぞって選ぶ(旋律を複製せず、リズムと輪郭だけを渡す)。
 * 休みが足りなければ何もしない。
 */
function applyMotifEcho(
  generated: GeneratedArrangementNote[],
  trackId: ArrangementTrackId,
  section: ArrangementSectionPlan,
  offset: number,
  length: number,
  chords: ChordEvent[],
  lead: MelodyNote[],
  beatsPerBar: number,
): GeneratedArrangementNote[] {
  const melody = lead.filter((note) => note.startBeat >= offset && note.startBeat < offset + length).sort((a, b) => a.startBeat - b.startBeat)
  const head = melody.slice(0, 3)
  if (head.length < 3) return generated
  const span = head.at(-1)!.startBeat - head[0].startBeat + Math.min(1, head.at(-1)!.durationBeats)
  if (span > beatsPerBar / 2) return generated
  // 最初のフレーズの後で、主旋律が休むか長く伸ばしている間(2拍以上)に核が収まる所を探す
  let echoStart: number | null = null
  for (let index = 0; index < melody.length; index++) {
    const note = melody[index]
    if (note.startBeat < offset + beatsPerBar * 2) continue
    const next = melody[index + 1]?.startBeat ?? offset + length
    const from = note.durationBeats >= 2 ? note.startBeat + .5 : note.startBeat + note.durationBeats
    const start = Math.ceil((from - 1e-6) * 2) / 2
    if (next - start >= span) {
      echoStart = start
      break
    }
  }
  if (echoStart === null) return generated
  const echoEnd = echoStart + span
  const center = trackId === "syn-bass" ? 43 : 62
  const kept = generated.filter((note) => note.startBeat + note.durationBeats <= echoStart! || note.startBeat >= echoEnd)
  let previous: number | undefined
  const echo = head.map((note, index) => {
    const beat = echoStart! + (note.startBeat - head[0].startBeat)
    const pcs = chordTonePcs(chordAtBeat(chords, beat - offset))
    const wanted = previous === undefined ? center : previous + (note.pitch - head[index - 1].pitch)
    const pitch = pcs
      .flatMap((pc) => [-12, 0, 12].map((octave) => midiForPc(pc, wanted) + octave))
      .filter((candidate) => Math.abs(candidate - center) <= 9)
      .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0] ?? midiForPc(pcs[0], center)
    previous = pitch
    const duration = Math.max(.25, Math.min(note.durationBeats, (head[index + 1]?.startBeat ?? note.startBeat + note.durationBeats) - note.startBeat))
    return makeNote(trackId, section.sectionId, 900 + index, beat, duration, pitch, 46 + section.energy * .25, trackId === "syn-bass"
      ? "主旋律の休みで、核のリズムを低音が一度だけ受け継ぐ"
      : "主旋律の休みで、核のリズムを内声が一度だけ受け継ぐ", "safe")
  })
  return [...kept, ...echo].sort((a, b) => a.startBeat - b.startBeat)
}

const HARMONIC_REVIEW_TRACKS = new Set<ArrangementTrackId>([
  "syn-bass", "syn-sub-bass", "syn-bass-mid", "syn-pulse", "syn-arp-low", "syn-arp-high",
  "syn-stabs", "syn-chord-wide", "syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-high-glass",
  "str-cello", "str-viola", "str-violin-2", "str-violin-1", "str-upper",
  "str-contrabass", "str-spiccato", "str-high-octave",
])

function allowedPitchClassesAtNote(project: ComposerProject, note: GeneratedArrangementNote, trackId: ArrangementTrackId): Set<number> | null {
  const section = project.sections.find((candidate) => candidate.id === note.sectionId)
  if (!section) return null
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const localBeat = note.startBeat - sectionOffset(section.startBar, beatsPerBar)
  const chords = project.chords.filter((chord) => chord.sectionId === section.id)
  const chord = chordAtBeat(chords, localBeat)
  const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
  return parsed ? new Set([
    ...[...parsed.tones, ...parsed.tensions].map((tone) => tone.pitchClass),
    ...(TRACK_FAMILY[trackId] === "bass" ? [parsed.bassPc] : []),
  ]) : null
}

function countMelodyCollisions(project: ComposerProject, plan: ArrangementPlan, tracks: GeneratedArrangementTrack[]): number {
  const material = buildSongPlaybackMaterial(project, plan.directive?.timelineConstraints)
  const lead = [
    ...material.lead,
    ...material.counterLayers,
    ...material.decorationLayers,
    ...material.phraseLayers,
    ...material.signaturePhraseLayers,
  ]
  return tracks.reduce((sum, track) => {
    if (track.family === "drums" || track.family === "bass") return sum
    return sum + track.notes.filter((note) => note.character === "safe" && lead.some((melodyNote) =>
      melodyNote.startBeat < note.startBeat + note.durationBeats
      && melodyNote.startBeat + melodyNote.durationBeats > note.startBeat
      && Math.abs(melodyNote.pitch - note.pitch) <= 2,
    )).length
  }, 0)
}

export function reviewGeneratedArrangement(
  arrangement: Pick<FullSongArrangement, "analysis" | "plan" | "tracks">,
  project?: ComposerProject,
) {
  const roleSignatures = arrangement.plan.sections.map((section) => [...section.activeRoles].sort().join("|"))
  const distinctSectionTextures = new Set(roleSignatures).size
  const stagedEntryCount = arrangement.plan.sections.reduce(
    (sum, section) => sum + Object.values(section.roleEntryBeats ?? {}).filter((beat) => (beat ?? 0) > 0).length,
    0,
  )
  const peakIndex = arrangement.analysis.sections.findIndex((section) => section.sectionId === arrangement.analysis.peakSectionId)
  const peakIsLate = peakIndex >= Math.floor(arrangement.analysis.sections.length * 0.6)
  const overfilledSectionCount = arrangement.plan.sections.filter((section) => section.activeRoles.length > 16).length
  const silentRoleCount = arrangement.plan.sections.reduce((sum, section) => sum + section.activeRoles.filter((role) => {
    if (isArrangementLayerTrackId(role)) return false
    return !arrangement.tracks.some((track) => track.id === role && track.notes.some((note) => note.sectionId === section.sectionId))
  }).length, 0)
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
  const largeSupportLeapCount = arrangement.plan.sections.reduce((sum, section) => sum + arrangement.tracks.reduce((trackSum, track) => {
    if (track.id !== "syn-dark-pad" && !["str-cello", "str-viola", "str-violin-1", "str-violin-2"].includes(track.id)) return trackSum
    const notes = track.notes.filter((note) => note.sectionId === section.sectionId && !note.reason.startsWith("指定を実音化"))
    const stride = track.id === "syn-dark-pad" ? 3 : 1
    return trackSum + notes.reduce((count, note, index) =>
      count + (index >= stride && Math.abs(note.pitch - notes[index - stride].pitch) > 9 ? 1 : 0), 0)
  }, 0), 0)
  const sectionNoteCounts = arrangement.plan.sections.map((section) => arrangement.tracks.reduce(
    (sum, track) => sum + track.notes.filter((note) => note.sectionId === section.sectionId).length,
    0,
  ))
  const sectionDensities = arrangement.plan.sections.map((section, index) => {
    const sourceSection = project?.sections.find((candidate) => candidate.id === section.sectionId)
    const lengthBeats = sourceSection ? sourceSection.lengthBars * beatsPerBar : 1
    return sectionNoteCounts[index] / Math.max(1, lengthBeats)
  })
  const energyDensityCorrelation = pearsonCorrelation(
    arrangement.plan.sections.map((section) => section.energy),
    sectionDensities,
  )
  const averageActiveRoleCount = arrangement.plan.sections.reduce(
    (sum, section) => sum + section.activeRoles.length,
    0,
  ) / Math.max(1, arrangement.plan.sections.length)
  const generatedNotesPerBeat = arrangement.tracks.reduce((sum, track) => sum + track.notes.length, 0)
    / Math.max(1, arrangement.analysis.totalBeats)
  const normalizedSectionEvents = (sectionId: string) => {
    const source = project?.sections.find((section) => section.id === sectionId)
    const start = source ? sectionOffset(source.startBar, beatsPerBar) : 0
    return new Set(arrangement.tracks.flatMap((track) => track.notes
      .filter((note) => note.sectionId === sectionId)
      .map((note) => `${track.id}:${Math.round((note.startBeat - start) * 4)}:${Math.round(note.durationBeats * 4)}:${pc(note.pitch)}`)))
  }
  let repeatedSectionCopyCount = 0
  let repeatedTrackCopyRatio = 0
  const lastByRole = new Map<string, string>()
  for (const section of arrangement.plan.sections) {
    const role = section.semanticRole ?? section.sectionRole
    const previousId = lastByRole.get(role)
    if (previousId) {
      const similarity = setSimilarity(normalizedSectionEvents(previousId), normalizedSectionEvents(section.sectionId))
      if (similarity >= .86) repeatedSectionCopyCount += 1
      const sourcePrevious = project?.sections.find((candidate) => candidate.id === previousId)
      const sourceCurrent = project?.sections.find((candidate) => candidate.id === section.sectionId)
      const previousStart = sourcePrevious ? sectionOffset(sourcePrevious.startBar, beatsPerBar) : 0
      const currentStart = sourceCurrent ? sectionOffset(sourceCurrent.startBar, beatsPerBar) : 0
      let comparable = 0
      let copied = 0
      for (const track of arrangement.tracks) {
        const signature = (sectionId: string, start: number) => track.notes
          .filter((note) => note.sectionId === sectionId)
          // 演奏強弱ではなく、音型・音域・発音位置が同じかを判定する。
          .map((note) => `${Math.round((note.startBeat - start) * 8)}:${Math.round(note.durationBeats * 8)}:${note.pitch}`)
          .sort()
          .join("|")
        const left = signature(previousId, previousStart)
        const right = signature(section.sectionId, currentStart)
        if (!left && !right) continue
        comparable += 1
        if (left === right) copied += 1
      }
      repeatedTrackCopyRatio = Math.max(repeatedTrackCopyRatio, copied / Math.max(1, comparable))
    }
    lastByRole.set(role, section.sectionId)
  }
  const boundaryContrasts = arrangement.plan.sections.slice(1).map((section, index) => {
    const previous = arrangement.plan.sections[index]
    const roleDifference = 1 - setSimilarity(new Set(previous.activeRoles), new Set(section.activeRoles))
    const previousDensity = sectionDensities[index] ?? 0
    const density = sectionDensities[index + 1] ?? 0
    const densityDifference = Math.abs(density - previousDensity) / Math.max(1, density, previousDensity)
    const energyDifference = Math.abs(section.energy - previous.energy) / 100
    return Math.max(roleDifference, densityDifference, energyDifference)
  })
  const boundaryContrastScore = boundaryContrasts.length > 0
    ? boundaryContrasts.filter((contrast) => contrast >= .16).length / boundaryContrasts.length
    : 1
  const motifDevelopmentCount = arrangement.plan.sections.filter((section) =>
    section.motifTreatment && section.motifTreatment !== "none"
    && arrangement.tracks.some((track) => track.notes.some((note) =>
      note.sectionId === section.sectionId && /核|応答|発展|前回/.test(note.reason),
    )),
  ).length
  const harmonicViolationCount = project
    ? arrangement.tracks.reduce((sum, track) => sum + (HARMONIC_REVIEW_TRACKS.has(track.id)
      ? track.notes.filter((note) => {
          if (note.character !== "safe") return false
          const allowed = allowedPitchClassesAtNote(project, note, track.id)
          return allowed !== null && !allowed.has(pc(note.pitch))
        }).length
      : 0), 0)
    : 0
  const melodyCollisionCount = project ? countMelodyCollisions(project, arrangement.plan, arrangement.tracks) : 0
  const leadAttacks = project
    ? buildSongPlaybackMaterial(project, arrangement.plan.directive?.timelineConstraints).lead.map((note) => note.startBeat)
    : []
  const rhythmLeadAttackConflictCount = arrangement.tracks.reduce((sum, track) => {
    if (!["dr-kick", "dr-field-drum", "dr-low-tom", "dr-high-tom"].includes(track.id)) return sum
    return sum + track.notes.filter((note) => {
      if (note.reason.startsWith("指定を実音化")) return false
      const source = project?.sections.find((section) => section.id === note.sectionId)
      if (!source) return false
      const barOffset = ((note.startBeat - sectionOffset(source.startBar, beatsPerBar)) % beatsPerBar + beatsPerBar) % beatsPerBar
      if (track.id === "dr-kick" && barOffset < 0.08) return false
      return leadAttacks.some((beat) => Math.abs(beat - note.startBeat) <= 0.12)
    }).length
  }, 0)
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
  if (largeSupportLeapCount > 0) recommendations.push("背景声部の大きな跳躍を共通音または順次進行へ戻す")
  if (arrangement.plan.sections.length >= 4 && densityContrastRatio < 1.8) recommendations.push("Section間の実音密度差を増やす")
  if (harmonicViolationCount > 0) recommendations.push("Safeパートのコード外音を解決可能な音へ修正する")
  if (melodyCollisionCount > 0) recommendations.push("主旋律と同音域で接触する補助声部を整理する")
  if (rhythmLeadAttackConflictCount > 0) recommendations.push("主旋律のアタックに重なるKick/Fillを引く")
  if (arrangement.plan.sections.length >= 4 && energyDensityCorrelation < 0.2) recommendations.push("Energy Curveと実際の発音密度を一致させる")
  if (repeatedSectionCopyCount > 0) recommendations.push("再登場するVerse/Chorusのリズム・低音・内声を発展させる")
  if (repeatedTrackCopyRatio > .6) recommendations.push("再登場するSectionで同じ演奏を繰り返すパートを減らす")
  if (arrangement.plan.sections.length >= 4 && boundaryContrastScore < .55) recommendations.push("Section境界で一度引くか、新しい役割の入口を明確にする")
  const score = Math.max(0, Math.min(100,
    24
    + Math.min(18, distinctSectionTextures * 1.5)
    + Math.min(10, stagedEntryCount * 1.5)
    + (peakIsLate ? 12 : 0)
    - overfilledSectionCount * 8
    - silentRoleCount * 5
    - mechanicalLoopCount * 4
    - Math.min(12, largeSupportLeapCount * 2)
    + (densityContrastRatio >= 2.5 ? 6 : densityContrastRatio >= 1.8 ? 3 : -6)
    + Math.round(clamp01((energyDensityCorrelation + 0.2) / 1.1) * 20)
    - Math.max(0, averageActiveRoleCount - 8) * 1.8
    - Math.max(0, generatedNotesPerBeat - 7) * 1.5
    - Math.min(28, harmonicViolationCount * 7)
    - Math.min(20, melodyCollisionCount * 2)
    - Math.min(12, rhythmLeadAttackConflictCount * 1.5)
    - repeatedSectionCopyCount * 8
    - Math.max(0, repeatedTrackCopyRatio - .35) * 20
    + Math.round(boundaryContrastScore * 5)
    + Math.min(4, motifDevelopmentCount * .5),
  ))
  return {
    score,
    passed: score >= ARRANGEMENT_QUALITY_FLOOR
      && harmonicViolationCount === 0
      && melodyCollisionCount === 0
      && repeatedTrackCopyRatio <= .65,
    summary: score >= 88 ? "Sectionごとの役割差と後半の解放が成立しています" : score >= 75 ? "全曲の起伏は成立しています。試聴で役割密度を確認してください" : "全曲の役割差を再調整する余地があります",
    metrics: {
      distinctSectionTextures,
      stagedEntryCount,
      peakSectionId: arrangement.analysis.peakSectionId,
      peakIsLate,
      overfilledSectionCount,
      silentRoleCount,
      mechanicalLoopCount,
      largeSupportLeapCount,
      densityContrastRatio,
      harmonicViolationCount,
      melodyCollisionCount,
      rhythmLeadAttackConflictCount,
      energyDensityCorrelation,
      averageActiveRoleCount,
      generatedNotesPerBeat,
      repeatedSectionCopyCount,
      repeatedTrackCopyRatio,
      boundaryContrastScore,
      motifDevelopmentCount,
    },
    recommendations,
  }
}

function setSimilarity(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 1
  let intersection = 0
  left.forEach((value) => { if (right.has(value)) intersection += 1 })
  return intersection / union.size
}

function arrangementSimilarity(left: FullSongArrangement, right: FullSongArrangement): number {
  const sectionIds = [...new Set([...left.plan.sections, ...right.plan.sections].map((section) => section.sectionId))]
  const roleSimilarity = sectionIds.reduce((sum, sectionId) => {
    const leftRoles = new Set(left.plan.sections.find((section) => section.sectionId === sectionId)?.activeRoles ?? [])
    const rightRoles = new Set(right.plan.sections.find((section) => section.sectionId === sectionId)?.activeRoles ?? [])
    return sum + setSimilarity(leftRoles, rightRoles)
  }, 0) / Math.max(1, sectionIds.length)
  const noteSignature = (arrangement: FullSongArrangement) => new Set(arrangement.tracks.flatMap((track) => track.notes.map((note) =>
    `${track.id}:${Math.round(note.startBeat * 4)}:${Math.round(note.durationBeats * 4)}:${pc(note.pitch)}`,
  )))
  const eventSimilarity = setSimilarity(noteSignature(left), noteSignature(right))
  const leftDensity = left.plan.sections.map((section) => left.tracks.reduce(
    (sum, track) => sum + track.notes.filter((note) => note.sectionId === section.sectionId).length, 0,
  ))
  const rightDensity = right.plan.sections.map((section) => right.tracks.reduce(
    (sum, track) => sum + track.notes.filter((note) => note.sectionId === section.sectionId).length, 0,
  ))
  const densitySimilarity = leftDensity.reduce((sum, value, index) => {
    const other = rightDensity[index] ?? 0
    return sum + (1 - Math.abs(value - other) / Math.max(1, value, other))
  }, 0) / Math.max(1, leftDensity.length)
  return clamp01(roleSimilarity * 0.35 + eventSimilarity * 0.45 + densitySimilarity * 0.2)
}

function intentionFitScore(approach: ArrangementCandidateApproach, directive?: ArrangementGenerationDirective): number {
  const preferred: Partial<Record<NonNullable<ArrangementGenerationDirective["character"]>, ArrangementCandidateApproach[]>> = {
    minimal: ["space-led", "dynamic-contrast"],
    cinematic: ["counterpoint-led", "dynamic-contrast"],
    rhythmic: ["rhythm-led", "motif-led"],
    "dark-experimental": ["motif-led", "counterpoint-led"],
    balanced: ["dynamic-contrast", "space-led"],
  }
  const matches = directive?.character ? preferred[directive.character] ?? [] : []
  if (matches[0] === approach) return 100
  if (matches[1] === approach) return 88
  return directive?.character ? 72 : 84
}

function candidateReason(summary: Omit<ArrangementCandidateSummary, "selected" | "reason">): string {
  if (summary.qualityScore < ARRANGEMENT_QUALITY_FLOOR) return "音楽品質の下限に届かなかったため除外"
  if (summary.originalityScore >= 45) return "品質を保ちながら、他案と異なる役割・リズム・音域展開を持つ"
  return "基礎品質は高いが、他案との実音差が比較的小さい"
}

function applyArrangementSoundImage(
  project: ComposerProject,
  tracks: GeneratedArrangementTrack[],
): GeneratedArrangementTrack[] {
  return tracks.map((track) => ({
    ...track,
    notes: track.notes.map((note) => {
      if (track.family === "drums" || note.soundImage) return note
      const image = resolveMusicContext(project, note.sectionId).aesthetic
      const rear = track.id.includes("pad") || track.family === "strings" || track.id.includes("glass")
      const depthShift = Math.max(0, image.depth - .5)
      const decayShift = Math.max(0, image.decay - .5)
      return {
        ...note,
        velocity: Math.max(1, Math.round(note.velocity - (rear ? 20 : 7) * depthShift)),
        durationBeats: note.durationBeats * (1 + (rear ? .42 : .14) * decayShift),
        soundImage: {
          depth: image.depth,
          decay: image.decay,
          transientSoftness: image.transientSoftness,
          stereoDiffusion: image.stereoDiffusion,
        },
      }
    }),
  }))
}

function reconcilePlanWithSoundingRoles(
  plan: ArrangementPlan,
  tracks: readonly GeneratedArrangementTrack[],
): ArrangementPlan {
  return {
    ...plan,
    sections: plan.sections.map((section) => {
      const activeRoles = section.activeRoles.filter((role) => tracks.some((track) =>
        track.id === role && track.notes.some((note) => note.sectionId === section.sectionId),
      ))
      const active = new Set(activeRoles)
      const roleEntryBeats = Object.fromEntries(Object.entries(section.roleEntryBeats ?? {})
        .filter(([role]) => active.has(role as ArrangementTrackId))) as Partial<Record<ArrangementTrackId, number>>
      return {
        ...section,
        activeRoles,
        ...(Object.keys(roleEntryBeats).length > 0 ? { roleEntryBeats } : { roleEntryBeats: undefined }),
      }
    }),
  }
}

/** 同じ役割の再登場を音量差だけにせず、少なくとも複数の演奏内容で発展させる。 */
function developRepeatedSectionPerformances(
  plan: ArrangementPlan,
  tracks: GeneratedArrangementTrack[],
): GeneratedArrangementTrack[] {
  const repeatedSections = new Set(plan.sections
    .filter((section) => (section.developmentStage ?? 0) > 0)
    .map((section) => section.sectionId))
  if (repeatedSections.size === 0) return tracks
  const developmentTargets = new Set<ArrangementTrackId>([
    "dr-closed-hat", "syn-pulse", "syn-bass", "syn-dark-pad", "str-viola", "str-violin-1",
  ])
  return tracks.map((track) => {
    if (!developmentTargets.has(track.id)) return track
    const sectionCounters = new Map<string, number>()
    const notes = track.notes.flatMap((note): GeneratedArrangementNote[] => {
      if (!repeatedSections.has(note.sectionId)) return [note]
      const index = sectionCounters.get(note.sectionId) ?? 0
      sectionCounters.set(note.sectionId, index + 1)
      if ((track.id === "dr-closed-hat" || track.id === "syn-pulse") && index % 12 === 10) return []
      if (track.id === "syn-bass" && index % 8 === 6) {
        const pitch = note.pitch <= 48 ? note.pitch + 12 : note.pitch >= 60 ? note.pitch - 12 : note.pitch
        return [{ ...note, pitch, reason: `${note.reason}。再登場Sectionでは低音の輪郭を発展` }]
      }
      if (["syn-dark-pad", "str-viola", "str-violin-1"].includes(track.id) && index % 4 === 3) {
        return [{ ...note, durationBeats: Math.max(.125, note.durationBeats * .75), reason: `${note.reason}。再登場Sectionでは余白を変えて発展` }]
      }
      return [note]
    })
    return { ...track, notes }
  })
}

function realignPhaseLockedDrumLayers(tracks: GeneratedArrangementTrack[]): GeneratedArrangementTrack[] {
  const byId = new Map(tracks.map((track) => [track.id, track]))
  return tracks.map((track) => {
    const sourceId = PHASE_LOCKED_LAYER_SOURCES.get(track.id)
    if (!sourceId) return track
    const source = byId.get(sourceId)
    if (!source) return track
    return {
      ...track,
      notes: track.notes.map((note) => {
        const nearest = source.notes
          .filter((candidate) => candidate.sectionId === note.sectionId)
          .sort((left, right) => Math.abs(left.startBeat - note.startBeat) - Math.abs(right.startBeat - note.startBeat))[0]
        return nearest ? { ...note, startBeat: nearest.startBeat } : note
      }),
    }
  })
}

/**
 * 全曲生成・部分再生成・AI相談後の差し替えを同じ最終工程へ通す。
 * 音像処理は付与済みの音へ重ねず、Criticは実際に保存・試聴・書き出しされる全トラックを見る。
 */
export function finalizeFullSongArrangement(
  project: ComposerProject,
  arrangement: FullSongArrangement,
  options: {
    editableTrackIds?: ReadonlySet<string>
    editableSectionIds?: ReadonlySet<string>
    refine?: boolean
  } = {},
): FullSongArrangement {
  const imageTracks = applyArrangementSoundImage(project, arrangement.tracks)
  const timelineTracks = applyArrangementTimelineToTracks(
    imageTracks,
    arrangement.plan.directive?.timelineConstraints,
    parseTimeSignature(project.song.timeSignature).beatsPerBar,
  )
  const audition = options.refine === false
    ? { tracks: timelineTracks, report: evaluateArrangementAudition(project, arrangement.plan, timelineTracks) }
    : refineArrangementByAudition(project, arrangement.plan, timelineTracks, 3, {
        editableTrackIds: options.editableTrackIds,
        editableSectionIds: options.editableSectionIds,
      })
  // Criticのタイミング移動後にも無音区間をもう一度適用し、書き出し制約を最終優先にする。
  const finalTracks = realignPhaseLockedDrumLayers(applyArrangementTimelineToTracks(
    audition.tracks,
    arrangement.plan.directive?.timelineConstraints,
    parseTimeSignature(project.song.timeSignature).beatsPerBar,
  ))
  const finalPlan = reconcilePlanWithSoundingRoles(arrangement.plan, finalTracks)
  const finalReport = evaluateArrangementAudition(project, finalPlan, finalTracks)
  const finalized = {
    ...arrangement,
    plan: finalPlan,
    tracks: finalTracks,
    audition: {
      ...finalReport,
      repairPasses: audition.report.repairPasses,
      removedNotes: audition.report.removedNotes,
      shiftedNotes: audition.report.shiftedNotes,
      velocityAdjustments: audition.report.velocityAdjustments,
    },
  }
  return { ...finalized, quality: reviewGeneratedArrangement(finalized, project) }
}

function generateArrangementCandidate(
  project: ComposerProject,
  analysis: ArrangementAnalysis,
  seed: number,
  brief: string | undefined,
  directive: ArrangementGenerationDirective | undefined,
  revision: number,
  approach: ArrangementCandidateApproach,
  variationSeed: number,
): FullSongArrangement {
  const plan = buildFullSongArrangementPlan(project, analysis, seed, brief, directive, approach)
  const activeTrackIds = [...new Set(plan.sections.flatMap((section) => section.activeRoles))]
  const coreTrackIds = [...new Set(activeTrackIds.map((trackId) => isArrangementLayerTrackId(trackId)
    ? ARRANGEMENT_LAYER_SOURCES[trackId]
    : trackId))]
  const generatedCoreTracks = developRepeatedSectionPerformances(
    plan,
    coreTrackIds.map((trackId) => generateTrack(project, plan, trackId, revision, undefined, variationSeed)),
  )
  const coreById = new Map(generatedCoreTracks.map((track) => [track.id, track]))
  const generatedLayerTracks = layerTrackIdsFor(coreTrackIds).flatMap((trackId) => {
    const source = coreById.get(ARRANGEMENT_LAYER_SOURCES[trackId])
    return source ? [deriveArrangementLayerTrack(source, trackId, plan, revision)] : []
  })
  const performedTracks = applyArrangementPerformanceDirector(
    project,
    plan,
    [...generatedCoreTracks, ...generatedLayerTracks],
  )
  return finalizeFullSongArrangement(project, {
    version: "1.0.0",
    orchestrationVersion: 3,
    id: `arrangement:${seed}`,
    createdAt: new Date().toISOString(),
    analysis,
    plan,
    tracks: performedTracks,
  })
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
  const baseSeed = options.seed ?? hashText(`${project.projectId}:${project.title}:${project.song.tempo}`)
  const revision = Math.max(0, Math.round(options.revision ?? 0))
  let candidates = Array.from({ length: ARRANGEMENT_CANDIDATE_POOL_SIZE }, (_, index) => generateArrangementCandidate(
    project,
    analysis,
    (baseSeed + index * ARRANGEMENT_CANDIDATE_SEED_STEP) >>> 0,
    options.brief,
    options.directive,
    revision + index,
    ARRANGEMENT_APPROACHES[index % ARRANGEMENT_APPROACHES.length],
    baseSeed,
  ))
  const scoreCandidates = (pool: FullSongArrangement[]) => pool.map((candidate, index) => {
    const comparisons = pool.filter((_, otherIndex) => otherIndex !== index)
    const originalityScore = comparisons.length === 0
      ? 100
      : (1 - comparisons.reduce((sum, other) => sum + arrangementSimilarity(candidate, other), 0) / comparisons.length) * 100
    const qualityScore = candidate.quality?.score ?? 0
    const intentionFit = intentionFitScore(candidate.plan.candidateApproach ?? "dynamic-contrast", options.directive)
    const contextualFit = candidate.plan.sections.reduce((sum, section) => {
      const { genre, aesthetic } = resolveMusicContext(project, section.sectionId)
      const active = section.activeRoles
      const rhythm = active.filter((id) => id.startsWith("dr-") || id === "syn-pulse").length / 7
      const support = active.filter((id) => id === "syn-transition-phrase" || id === "syn-high-glass" || id.startsWith("str-")).length / 6
      const targetRhythm = genre.rhythmDensity * .7
      const targetSupport = Math.max(0, (genre.phraseDensity + genre.decorationDensity) * .35 - (aesthetic.layerTransparency - .5) * .3)
      return sum + Math.max(0, 100 - Math.abs(rhythm - targetRhythm) * 90 - Math.abs(support - targetSupport) * 70)
    }, 0) / Math.max(1, candidate.plan.sections.length)
    const hasExplicitContext = resolveMusicContext(project).styleActive
    const auditionScore = candidate.audition?.score ?? 0
    const selectionScore = hasExplicitContext
      ? qualityScore * 0.55 + originalityScore * 0.10 + intentionFit * 0.10 + contextualFit * 0.07 + auditionScore * 0.18
      : qualityScore * 0.60 + originalityScore * 0.12 + intentionFit * 0.10 + auditionScore * 0.18
    const draft = {
      seed: candidate.plan.seed,
      approach: candidate.plan.candidateApproach ?? "dynamic-contrast" as ArrangementCandidateApproach,
      qualityScore,
      originalityScore: Math.round(originalityScore),
      intentionFitScore: intentionFit,
      auditionScore,
      selectionScore: Math.round(selectionScore * 10) / 10,
    }
    return { candidate, summary: { ...draft, selected: false, reason: candidateReason(draft) } }
  })
  const eligibleCandidates = (items: ReturnType<typeof scoreCandidates>) => items.filter(({ candidate }) =>
    candidate.quality?.passed === true
    && (candidate.audition?.score ?? 0) >= 72,
  )
  let scored = scoreCandidates(candidates)
  let eligible = eligibleCandidates(scored)
  // 最初の候補がすべて下限未満なら黙って不合格案を採用せず、別seedでもう一度だけ探索する。
  if (eligible.length === 0) {
    const retry = Array.from({ length: ARRANGEMENT_CANDIDATE_POOL_SIZE }, (_, index) => {
      const candidateIndex = ARRANGEMENT_CANDIDATE_POOL_SIZE + index
      return generateArrangementCandidate(
        project,
        analysis,
        (baseSeed + candidateIndex * ARRANGEMENT_CANDIDATE_SEED_STEP) >>> 0,
        options.brief,
        options.directive,
        revision + candidateIndex,
        ARRANGEMENT_APPROACHES[candidateIndex % ARRANGEMENT_APPROACHES.length],
        baseSeed,
      )
    })
    candidates = [...candidates, ...retry]
    scored = scoreCandidates(candidates)
    eligible = eligibleCandidates(scored)
  }
  const ranked = [...(eligible.length > 0 ? eligible : scored)].sort((left, right) =>
    right.summary.selectionScore - left.summary.selectionScore
    || right.summary.qualityScore - left.summary.qualityScore,
  )
  const winner = ranked[0]
  const selectedSeed = winner.candidate.plan.seed
  const summaries = scored.map(({ summary }) => summary.seed === selectedSeed
    ? { ...summary, selected: true, reason: "実音品質・聴感上の明瞭さ・制作意図への適合を総合して採用" }
    : summary)
  return {
    ...winner.candidate,
    id: `arrangement:${baseSeed}:${selectedSeed}`,
    plan: { ...winner.candidate.plan, seed: baseSeed, candidateSeed: selectedSeed },
    tracks: winner.candidate.tracks.map((track) => ({ ...track, generationRevision: revision })),
    selection: {
      poolSize: candidates.length,
      qualityFloor: ARRANGEMENT_QUALITY_FLOOR,
      eligibleCount: eligible.length,
      selectedSeed,
      ...(eligible.length === 0
        ? { qualityWarning: "品質基準を満たす案を作れませんでした。Section区切り・コード・主旋律を確認してください。" }
        : {}),
      candidates: summaries.sort((left, right) => right.selectionScore - left.selectionScore),
    },
  }
}

/**
 * 以前の版で保存された全曲案へ、当時の主パートを一切作り直さずに
 * 現行のオーケストレーション層だけを追加する。
 *
 * アプリ更新後も保存済みの曲が旧トラック数のまま残る問題を防ぎつつ、
 * 個別再生成・ミュート・採用済みの音符はそのまま保持する。
 */
export function upgradeFullSongArrangementOrchestration(
  project: ComposerProject,
  arrangement: FullSongArrangement | null | undefined = project.fullSongArrangement,
): FullSongArrangement | undefined {
  if (!arrangement || arrangement.orchestrationVersion === 3) return arrangement ?? undefined

  const existingById = new Map(arrangement.tracks.map((track) => [track.id, track]))
  const coreTracks = arrangement.tracks.filter((track) => !isArrangementLayerTrackId(track.id))
  const revision = Math.max(0, ...arrangement.tracks.map((track) => track.generationRevision))
  const refreshedLayers = layerTrackIdsFor(coreTracks.map((track) => track.id))
    .flatMap((trackId) => {
      const source = existingById.get(ARRANGEMENT_LAYER_SOURCES[trackId])
      return source ? [deriveArrangementLayerTrack(source, trackId, arrangement.plan, revision)] : []
    })
  const performedLayers = applyArrangementTimelineToTracks(
    applyArrangementPerformanceDirector(project, arrangement.plan, refreshedLayers),
    arrangement.plan.directive?.timelineConstraints,
    parseTimeSignature(project.song.timeSignature).beatsPerBar,
  ).map((track) => ({ ...track, muted: existingById.get(track.id)?.muted ?? false }))

  return finalizeFullSongArrangement(project, {
    ...arrangement,
    orchestrationVersion: 3,
    tracks: [...coreTracks, ...performedLayers],
  }, { editableTrackIds: new Set(refreshedLayers.map((track) => track.id)) })
}

export function regenerateFullSongArrangementTarget(
  project: ComposerProject,
  current: FullSongArrangement,
  target: ArrangementRegenerationTarget,
): FullSongArrangement {
  let plan = current.plan
  const roleToActivate = isArrangementLayerTrackId(target.trackId)
    ? ARRANGEMENT_LAYER_SOURCES[target.trackId]
    : target.trackId
  if (target.energyDelta && target.sectionId) {
    plan = {
      ...plan,
      sections: plan.sections.map((section) => section.sectionId === target.sectionId
        ? {
            ...section,
            energy: Math.max(10, Math.min(100, section.energy + target.energyDelta!)),
            activeRoles: [...new Set([...section.activeRoles, roleToActivate])],
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
            activeRoles: [...new Set([...section.activeRoles, roleToActivate])],
          }
        : section),
    }
  }
  const currentTrack = current.tracks.find((track) => track.id === target.trackId) ?? emptyTrack(target.trackId)
  const revision = currentTrack.generationRevision + 1
  const regenerated = applyArrangementPerformanceDirector(
    project,
    plan,
    [generateTrack(project, plan, target.trackId, revision, target.sectionId)],
  )[0]
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
          performance: regenerated.performance && track.performance
            ? {
                ...track.performance,
                changedVelocityCount: track.performance.changedVelocityCount
                  - track.performance.sectionPlans.filter((section) => section.sectionId === target.sectionId).reduce((sum, section) => sum + section.diagnostics.changedVelocityCount, 0)
                  + regenerated.performance.changedVelocityCount,
                changedDurationCount: track.performance.changedDurationCount
                  - track.performance.sectionPlans.filter((section) => section.sectionId === target.sectionId).reduce((sum, section) => sum + section.diagnostics.changedDurationCount, 0)
                  + regenerated.performance.changedDurationCount,
                changedOnsetCount: track.performance.changedOnsetCount
                  - track.performance.sectionPlans.filter((section) => section.sectionId === target.sectionId).reduce((sum, section) => sum + section.diagnostics.changedOnsetCount, 0)
                  + regenerated.performance.changedOnsetCount,
                sectionPlans: [
                  ...track.performance.sectionPlans.filter((section) => section.sectionId !== target.sectionId),
                  ...regenerated.performance.sectionPlans,
                ],
              }
            : regenerated.performance ?? track.performance,
        }
      })
    : [...current.tracks, regenerated]
  const updated = { ...current, plan, tracks, selection: undefined }
  return finalizeFullSongArrangement(project, updated, {
    editableTrackIds: new Set([target.trackId]),
    ...(target.sectionId ? { editableSectionIds: new Set([target.sectionId]) } : {}),
  })
}

export function setArrangementTrackMuted(
  current: FullSongArrangement,
  trackId: ArrangementTrackId,
  muted: boolean,
): FullSongArrangement {
  return { ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, muted } : track) }
}
