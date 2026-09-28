import { it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import { allUsablePitchClasses, isChordTone } from "@/core/chord"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { PhraseCandidate } from "@/core/phrase"
import type { SignaturePhraseCandidate } from "@/core/signaturePhrase"
import { createEmptyProject } from "@/core/project"
import { parseKey, keyScalePitchClasses } from "@/core/scale"
import type { SectionRole } from "@/core/section"
import { resolvePublicComposerRules } from "@/composer-intelligence"
import { generatePhraseCandidates } from "@/phrase-engine/generatePhrases"
import { generateSignaturePhraseCandidates } from "@/phrase-engine/generateSignaturePhrases"
import { counterGenerationInput, decorationGenerationInput, phraseGenerationInput, signaturePhraseGenerationInput } from "@/store/generationInputs"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { generateCounterCandidates } from "./counterGenerator"
import { DEFAULT_DECORATION_SETTINGS, generateDecorationCandidates } from "./decorationGenerator"
import { buildHarmonicMap, chordAtBeat } from "./harmonicMap"
import { isIsolatedLeap, measureMelodyCraft } from "./melodyCraftMetrics"
import { classicalLikeness } from "./classicalLikeness"
import { CLASSICAL_MODELS } from "./classicalModels"

/**
 * 記録用(ARRANGEMENT_BASELINE_OUT を指定したときだけ動く): 主旋律と、アレンジの4パート(イントロ・短いフレーズ・対旋律・装飾)を
 * 同じ条件で作り、同じ物差しで数える。アプリと同じ入力の組み立て(generationInputs)を使う。
 * イントロは単独と主旋律に重ねる条件、装飾は単独と採用済みのレイヤー(短いフレーズ・イントロ・対旋律の1案目)と組み合わせる条件でも数える。
 */
const SONGS = [
  { key: "C", chords: "C | Am | F | G | C | Am | Dm G | C" },
  { key: "Am", chords: "Am | F | C | G | Am | F | E7 | Am" },
  { key: "Eb", chords: "Eb | Cm | Ab | Bb | Gm | Cm | Ab Bb | Eb" },
  { key: "Em", chords: "Em | C | D | Bm | Em | Am | B7 | Em" },
]
const SEEDS = [11, 22, 33]
const pc = (pitch: number) => ((pitch % 12) + 12) % 12

type Part = "melody" | "signature 単独" | "signature 主旋律と重ねる" | "phrase" | "counter" | "decoration 単独" | "decoration 採用済みと組み合わせ"
interface Tally { candidates: number; notes: number; lineNotes: number; otherLayerOverlap: number; otherLayerClash: number; strong: number; strongChord: number; chromaticNonChord: number; isolated: number;
  overlapNotes: number; semitoneClash: number; parallelPairs: number; parallels: number; classicalTotal: number; classicalCount: number; leadCrossing: number }
const empty = (): Tally => ({ candidates: 0, notes: 0, lineNotes: 0, otherLayerOverlap: 0, otherLayerClash: 0, strong: 0, strongChord: 0, chromaticNonChord: 0, isolated: 0, overlapNotes: 0, semitoneClash: 0,
  parallelPairs: 0, parallels: 0, classicalTotal: 0, classicalCount: 0, leadCrossing: 0 })

/** others: 主旋律のほかに同時に鳴る採用済みのレイヤー(組み合わせ条件だけ) */
function tally(t: Tally, notes: readonly MelodyNote[], lead: readonly MelodyNote[] | null, chordsText: string, key: string, others: readonly MelodyNote[] = []) {
  const chords = parseChordInputText(chordsText, "s1", 4, "c")
  const map = buildHarmonicMap(chords)
  const scale = new Set(keyScalePitchClasses(key))
  const parsed = parseKey(key)!
  if (parsed.isMinor) { scale.add(pc(parsed.rootPc + 9)); scale.add(pc(parsed.rootPc + 11)) }
  // 同じ開始の音は最高音だけ(和音の装飾を1本の線として見る)
  const byStart = new Map<number, MelodyNote>()
  for (const note of notes) if (!byStart.has(note.startBeat) || byStart.get(note.startBeat)!.pitch < note.pitch) byStart.set(note.startBeat, note)
  const line = [...byStart.values()].sort((a, b) => a.startBeat - b.startBeat)
  t.candidates += 1
  t.notes += notes.length
  t.lineNotes += line.length
  for (const note of notes) {
    const entry = chordAtBeat(map, note.startBeat)
    if (!entry) continue
    if (Math.abs(note.startBeat % 2) < 1e-6) {
      t.strong += 1
      if (isChordTone(entry.parsed, pc(note.pitch))) t.strongChord += 1
    }
    if (!scale.has(pc(note.pitch)) && !allUsablePitchClasses(entry.parsed).includes(pc(note.pitch))) t.chromaticNonChord += 1
    if (lead) {
      const against = lead.filter((other) => Math.min(other.startBeat + other.durationBeats, note.startBeat + note.durationBeats) - Math.max(other.startBeat, note.startBeat) >= .5 - 1e-6)
      if (against.length > 0) t.overlapNotes += 1
      if (against.some((other) => [1, 11].includes(pc(note.pitch - other.pitch)))) t.semitoneClash += 1
    }
    const againstOthers = others.filter((other) => Math.min(other.startBeat + other.durationBeats, note.startBeat + note.durationBeats) - Math.max(other.startBeat, note.startBeat) >= .5 - 1e-6)
    if (againstOthers.length > 0) t.otherLayerOverlap += 1
    if (againstOthers.some((other) => [1, 11].includes(pc(note.pitch - other.pitch)))) t.otherLayerClash += 1
  }
  t.isolated += line.filter((_, index) => isIsolatedLeap(line, index)).length
  if (lead && lead.length > 0) {
    const leadAt = (beat: number) => lead.find((other) => other.startBeat <= beat + 1e-6 && beat < other.startBeat + other.durationBeats - 1e-6)
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1], b = line[index]
      const la = leadAt(a.startBeat), lb = leadAt(b.startBeat)
      if (!la || !lb || la === lb) continue
      const partMove = b.pitch - a.pitch, leadMove = lb.pitch - la.pitch
      if (partMove === 0 || leadMove === 0 || Math.sign(partMove) !== Math.sign(leadMove)) continue
      t.parallelPairs += 1
      const i1 = pc(a.pitch - la.pitch), i2 = pc(b.pitch - lb.pitch)
      if (i1 === i2 && (i1 === 0 || i1 === 7)) t.parallels += 1
    }
    t.leadCrossing += line.filter((note) => { const other = leadAt(note.startBeat); return other ? note.pitch > other.pitch : false }).length
  }
  if (line.length >= 8) {
    t.classicalTotal += classicalLikeness(measureMelodyCraft(line as MelodyNote[], chords, key), CLASSICAL_MODELS).score
    t.classicalCount += 1
  }
}

it.runIf(Boolean(process.env.ARRANGEMENT_BASELINE_OUT))("アレンジの4パートを、主旋律と同じ物差しで数える(記録専用)", () => {
  const tallies: Record<string, Tally> = {}
  const add = (part: Part, role: SectionRole) => (tallies[`${part} ${role}`] ??= empty())
  const settings = { density: "balanced" as const, rangePreset: "middle" as const, customRange: RANGE_PRESETS.middle, drama: "growing" as const,
    selectedGeneratorProfiles: ["standard" as const], techniqueExperimentPresetId: null }
  for (const song of SONGS) for (const role of ["verse", "chorus"] as SectionRole[]) for (const seed of SEEDS) {
    const project = createEmptyProject("baseline")
    project.song = { ...project.song, key: song.key }
    project.sections = [{ id: "s1", name: "S", role, startBar: 1, lengthBars: 8 }]
    project.chords = parseChordInputText(song.chords, "s1", 4, "c")
    const melodyNotes = generateFromChordsWithProfiles({
      chords: project.chords, sectionId: "s1", sectionRole: role, songProfile: "original-custom", density: "balanced", range: RANGE_PRESETS.middle,
      drama: "growing", totalBeats: 32, seed, profiles: ["standard"], key: song.key,
      composerRules: resolvePublicComposerRules({ generatorTarget: "melody", sectionRole: role }),
    }).candidates[0].notes
    tally(add("melody", role), melodyNotes, null, song.chords, song.key)
    const variant = { id: "lead", name: "lead", sectionId: "s1", sourceMode: "generate", notes: melodyNotes, phrasePlans: [], lockedBars: [], motifLocked: false,
      features: null, generatorVersion: "t", seed, songProfile: "original-custom", parentMelodyId: null, batchId: "b", createdAt: "2026-01-01T00:00:00.000Z" } as MelodyVariant
    project.melodyVariants = [variant]
    project.sectionMelodyAssignments = { s1: "lead" }
    // イントロは、単独で鳴らす条件と、主旋律と同じセクションで重ねる条件の両方で数える(生成は主旋律を参照する)
    const signatureInput = signaturePhraseGenerationInput(project, "s1", settings, seed)
    const signatures = signatureInput ? generateSignaturePhraseCandidates(signatureInput) : []
    for (const candidate of signatures) {
      tally(add("signature 単独", role), candidate.notes, null, song.chords, song.key)
      tally(add("signature 主旋律と重ねる", role), candidate.notes, melodyNotes, song.chords, song.key)
    }
    const phraseInput = phraseGenerationInput(project, "s1", settings, seed)
    const phrases = phraseInput ? generatePhraseCandidates(phraseInput) : []
    for (const candidate of phrases) tally(add("phrase", role), candidate.notes, melodyNotes, song.chords, song.key)
    const counterInput = counterGenerationInput(project, "s1", seed)
    const counters = counterInput ? generateCounterCandidates(counterInput) : []
    for (const candidate of counters) tally(add("counter", role), candidate.notes, melodyNotes, song.chords, song.key)
    const decorationInput = decorationGenerationInput(project, "s1", seed, DEFAULT_DECORATION_SETTINGS)
    if (decorationInput) for (const candidate of generateDecorationCandidates(decorationInput)) tally(add("decoration 単独", role), candidate.notes, melodyNotes, song.chords, song.key)
    // 組み合わせ条件: 短いフレーズ・イントロ・対旋律の1案目を採用した上で、装飾を作る(アプリの採用後の経路)
    const combined = structuredClone(project)
    const others: MelodyNote[] = []
    if (phrases[0]) {
      combined.phraseCandidates = [{ ...phrases[0], id: "phrase-1", batchId: "b", createdAt: "2026-01-01T00:00:00.000Z" } as PhraseCandidate]
      combined.sectionPhraseAssignments = { s1: "phrase-1" }
      others.push(...phrases[0].notes)
    }
    if (signatures[0]) {
      combined.signaturePhraseCandidates = [{ ...signatures[0], id: "signature-1", batchId: "b", createdAt: "2026-01-01T00:00:00.000Z" } as SignaturePhraseCandidate]
      combined.sectionSignaturePhraseAssignments = { s1: "signature-1" }
      others.push(...signatures[0].notes)
    }
    if (counters[0]) {
      combined.reactiveLayerCandidates = [counters[0]]
      combined.sectionReactiveLayerAssignments = { s1: counters[0].id }
      others.push(...counters[0].notes)
    }
    const combinedInput = decorationGenerationInput(combined, "s1", seed, DEFAULT_DECORATION_SETTINGS)
    if (combinedInput) for (const candidate of generateDecorationCandidates(combinedInput)) {
      tally(add("decoration 採用済みと組み合わせ", role), candidate.notes, melodyNotes, song.chords, song.key, others)
    }
  }
  const r = (value: number) => Math.round(value * 1000) / 1000
  const report = Object.fromEntries(Object.entries(tallies).map(([name, t]) => [name, {
    candidates: t.candidates,
    notesPerCandidate: r(t.notes / t.candidates),
    strongBeatChordTone: r(t.strongChord / Math.max(1, t.strong)),
    chromaticNonChordPer100: r(100 * t.chromaticNonChord / Math.max(1, t.notes)),
    // 飛び出す音は、同じ開始の音を最高音1つにした線で数えるので、分母もその線の音数
    isolatedLeapPer100: r(100 * t.isolated / Math.max(1, t.lineNotes)),
    semitoneClashWithLeadShare: r(t.semitoneClash / Math.max(1, t.overlapNotes)),
    parallelPerfectWithLeadRate: r(t.parallels / Math.max(1, t.parallelPairs)),
    aboveLeadShare: r(t.leadCrossing / Math.max(1, t.lineNotes)),
    semitoneClashWithOtherLayersShare: t.otherLayerOverlap ? r(t.otherLayerClash / t.otherLayerOverlap) : null,
    classicalMean: t.classicalCount ? r(t.classicalTotal / t.classicalCount) : null,
    classicalCount: t.classicalCount,
  }]))
  writeFileSync(process.env.ARRANGEMENT_BASELINE_OUT!, JSON.stringify(report, null, 1))
}, 900000)
