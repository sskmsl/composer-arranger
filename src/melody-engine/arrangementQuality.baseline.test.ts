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
import { counterGenerationInput, decorationGenerationInput, performGeneratedNotes, phraseGenerationInput, signaturePhraseGenerationInput } from "@/store/generationInputs"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { generateCounterCandidates } from "./counterGenerator"
import { DEFAULT_DECORATION_SETTINGS, generateDecorationCandidates } from "./decorationGenerator"
import { buildHarmonicMap, chordAtBeat } from "./harmonicMap"
import { isIsolatedLeap } from "./melodyCraftMetrics"
import { observeClashes, observeParallels, observeRegister, silentShare, topLine } from "./arrangementObservation"

/**
 * 記録用(ARRANGEMENT_BASELINE_OUT を指定したときだけ動く): 主旋律と、アレンジの4パート(イントロ・短いフレーズ・対旋律・装飾)を
 * 同じ条件で作り、共通の観測(arrangementObservation)で数える。アプリと同じ入力の組み立て(generationInputs)と
 * 演奏処理(performGeneratedNotes)を通した後の音で数える。拍の位置は16分音符の格子に丸めて判定する。
 * - イントロは、単独と主旋律に重ねる条件の両方で数える
 * - 装飾は、単独と、短いフレーズ・イントロ・対旋律の1案目を採用した組み合わせ条件の両方で数える
 * - 候補全体(pool)と、先頭の1案(first)を分けて数える
 * 条件は2組: ARRANGEMENT_CONDITIONS=development(既定。数値を見て議論した開発用)と confirmation(施策の確認用。先に固定した)。
 */
const CONDITIONS = {
  development: {
    songs: [
      { key: "C", chords: "C | Am | F | G | C | Am | Dm G | C" },
      { key: "Am", chords: "Am | F | C | G | Am | F | E7 | Am" },
      { key: "Eb", chords: "Eb | Cm | Ab | Bb | Gm | Cm | Ab Bb | Eb" },
      { key: "Em", chords: "Em | C | D | Bm | Em | Am | B7 | Em" },
    ],
    seeds: [11, 22, 33],
  },
  confirmation: {
    songs: [
      { key: "F", chords: "F | Dm | Bb | C | F | Dm | Gm C | F" },
      { key: "Bm", chords: "Bm | G | D | A | Bm | G | Em F#7 | Bm" },
      { key: "Db", chords: "Db | Bbm | Gb | Ab | Db | Fm | Gb Ab | Db" },
      { key: "Cm", chords: "Cm | Fm | Bb | Eb | Ab | Fm | G7 | Cm" },
    ],
    seeds: [404, 505, 606],
  },
} as const
const pc = (pitch: number) => ((pitch % 12) + 12) % 12

interface Tally {
  candidates: number; notes: number; lineNotes: number; strong: number; strongChord: number; chromaticNonChord: number; isolated: number
  overlapNotes: number; overlapBeats: number; minorSecond: number; minorSecondBeats: number; majorSeventh: number; compound: number
  minorSecondOnBeat: number; minorSecondResolved: number
  movingPairs: number; similarMotionPairs: number; parallelPerfect: number
  compared: number; above: number; crossings: number
  otherOverlapNotes: number; otherMinorSecond: number
  silentTotal: number
}
const empty = (): Tally => ({
  candidates: 0, notes: 0, lineNotes: 0, strong: 0, strongChord: 0, chromaticNonChord: 0, isolated: 0,
  overlapNotes: 0, overlapBeats: 0, minorSecond: 0, minorSecondBeats: 0, majorSeventh: 0, compound: 0, minorSecondOnBeat: 0, minorSecondResolved: 0,
  movingPairs: 0, similarMotionPairs: 0, parallelPerfect: 0, compared: 0, above: 0, crossings: 0, otherOverlapNotes: 0, otherMinorSecond: 0, silentTotal: 0,
})

/** others: 主旋律のほかに同時に鳴る採用済みのレイヤー(組み合わせ条件だけ) */
function tally(t: Tally, notes: readonly MelodyNote[], lead: readonly MelodyNote[] | null, chordsText: string, key: string, others: readonly MelodyNote[] = []) {
  const map = buildHarmonicMap(parseChordInputText(chordsText, "s1", 4, "c"))
  const scale = new Set(keyScalePitchClasses(key))
  const parsed = parseKey(key)!
  if (parsed.isMinor) { scale.add(pc(parsed.rootPc + 9)); scale.add(pc(parsed.rootPc + 11)) }
  const line = topLine(notes)
  t.candidates += 1
  t.notes += notes.length
  t.lineNotes += line.length
  for (const note of notes) {
    const nominal = Math.round(note.startBeat * 4) / 4
    const entry = chordAtBeat(map, nominal)
    if (!entry) continue
    if (Math.abs(nominal % 2) < 1e-6) {
      t.strong += 1
      if (isChordTone(entry.parsed, pc(note.pitch))) t.strongChord += 1
    }
    if (!scale.has(pc(note.pitch)) && !allUsablePitchClasses(entry.parsed).includes(pc(note.pitch))) t.chromaticNonChord += 1
  }
  t.isolated += line.filter((_, index) => isIsolatedLeap(line, index)).length
  t.silentTotal += silentShare([notes, ...(lead ? [lead] : []), others], 32)
  if (lead) {
    const clash = observeClashes(notes, lead)
    t.overlapNotes += clash.overlapNotes
    t.overlapBeats += clash.overlapBeats
    t.minorSecond += clash.minorSecond
    t.minorSecondBeats += clash.minorSecondBeats
    t.majorSeventh += clash.majorSeventh
    t.compound += clash.compound
    t.minorSecondOnBeat += clash.minorSecondOnBeat
    t.minorSecondResolved += clash.minorSecondResolved
    const parallel = observeParallels(line, lead)
    t.movingPairs += parallel.movingPairs
    t.similarMotionPairs += parallel.similarMotionPairs
    t.parallelPerfect += parallel.parallelPerfect
    const register = observeRegister(line, lead)
    t.compared += register.compared
    t.above += register.above
    t.crossings += register.crossings
  }
  if (others.length > 0) {
    const clash = observeClashes(notes, others)
    t.otherOverlapNotes += clash.overlapNotes
    t.otherMinorSecond += clash.minorSecond
  }
}

it.runIf(Boolean(process.env.ARRANGEMENT_BASELINE_OUT))("アレンジの4パートを、主旋律と同じ観測で数える(記録専用)", () => {
  const conditions = CONDITIONS[(process.env.ARRANGEMENT_CONDITIONS ?? "development") as keyof typeof CONDITIONS]
  const tallies: Record<string, Tally> = {}
  const add = (part: string, scope: "pool" | "first", role: SectionRole) => (tallies[`${part} ${role} ${scope}`] ??= empty())
  /** 候補が返らなかった(生成を見送った)回数と、返った候補数 */
  const returned: Record<string, { runs: number; empty: number; candidates: number }> = {}
  const count = (part: string, role: SectionRole, length: number) => {
    const entry = (returned[`${part} ${role}`] ??= { runs: 0, empty: 0, candidates: 0 })
    entry.runs += 1
    entry.candidates += length
    if (length === 0) entry.empty += 1
  }
  const record = (part: string, role: SectionRole, list: readonly MelodyNote[][], lead: readonly MelodyNote[] | null, song: { key: string; chords: string }, others: readonly MelodyNote[] = []) => {
    count(part, role, list.length)
    list.forEach((notes, index) => {
      tally(add(part, "pool", role), notes, lead, song.chords, song.key, others)
      if (index === 0) tally(add(part, "first", role), notes, lead, song.chords, song.key, others)
    })
  }
  const settings = { density: "balanced" as const, rangePreset: "middle" as const, customRange: RANGE_PRESETS.middle, drama: "growing" as const,
    selectedGeneratorProfiles: ["standard" as const], techniqueExperimentPresetId: null }
  for (const song of conditions.songs) for (const role of ["verse", "chorus"] as SectionRole[]) for (const seed of conditions.seeds) {
    const project = createEmptyProject("baseline")
    project.song = { ...project.song, key: song.key }
    project.sections = [{ id: "s1", name: "S", role, startBar: 1, lengthBars: 8 }]
    project.chords = parseChordInputText(song.chords, "s1", 4, "c")
    const rawMelody = generateFromChordsWithProfiles({
      chords: project.chords, sectionId: "s1", sectionRole: role, songProfile: "original-custom", density: "balanced", range: RANGE_PRESETS.middle,
      drama: "growing", totalBeats: 32, seed, profiles: ["standard"], key: song.key,
      composerRules: resolvePublicComposerRules({ generatorTarget: "melody", sectionRole: role }),
    }).candidates[0].notes
    // アプリは、生成した候補に演奏処理をかけてから保存する(主旋律は lead-focus)
    const perform = (notes: MelodyNote[], performRole: Parameters<typeof performGeneratedNotes>[3]) => performGeneratedNotes(project, "s1", notes, performRole).notes
    const melodyNotes = perform(rawMelody, "lead-focus")
    record("melody", role, [melodyNotes], null, song)
    const variant = { id: "lead", name: "lead", sectionId: "s1", sourceMode: "generate", notes: melodyNotes, phrasePlans: [], lockedBars: [], motifLocked: false,
      features: null, generatorVersion: "t", seed, songProfile: "original-custom", parentMelodyId: null, batchId: "b", createdAt: "2026-01-01T00:00:00.000Z" } as MelodyVariant
    project.melodyVariants = [variant]
    project.sectionMelodyAssignments = { s1: "lead" }

    const signatureInput = signaturePhraseGenerationInput(project, "s1", settings, seed)
    const signatures = (signatureInput ? generateSignaturePhraseCandidates(signatureInput) : []).map((candidate) => ({ ...candidate, notes: perform(candidate.notes, "lead-focus") }))
    record("signature 単独", role, signatures.map((candidate) => candidate.notes), null, song)
    record("signature 主旋律と重ねる", role, signatures.map((candidate) => candidate.notes), melodyNotes, song)
    const phraseInput = phraseGenerationInput(project, "s1", settings, seed)
    const phrases = (phraseInput ? generatePhraseCandidates(phraseInput) : []).map((candidate) => ({ ...candidate, notes: perform(candidate.notes, "lead-focus") }))
    record("phrase", role, phrases.map((candidate) => candidate.notes), melodyNotes, song)
    const counterInput = counterGenerationInput(project, "s1", seed)
    const counters = (counterInput ? generateCounterCandidates(counterInput) : []).map((candidate) => ({ ...candidate, notes: perform(candidate.notes, "counter-voice") }))
    record("counter", role, counters.map((candidate) => candidate.notes), melodyNotes, song)
    const decorationInput = decorationGenerationInput(project, "s1", seed, DEFAULT_DECORATION_SETTINGS)
    const decorations = decorationInput ? generateDecorationCandidates(decorationInput).map((candidate) => perform(candidate.notes, "transition-color")) : []
    record("decoration 単独", role, decorations, melodyNotes, song)

    // 組み合わせ条件: 短いフレーズ・イントロ・対旋律の1案目(演奏処理後)を採用した上で、装飾を作る(アプリの採用後の経路)
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
    const combinedDecorations = combinedInput
      ? generateDecorationCandidates(combinedInput).map((candidate) => performGeneratedNotes(combined, "s1", candidate.notes, "transition-color").notes)
      : []
    record("decoration 採用済みと組み合わせ", role, combinedDecorations, melodyNotes, song, others)
  }
  const r = (value: number) => Math.round(value * 1000) / 1000
  const share = (part: number, whole: number) => (whole > 0 ? r(part / whole) : null)
  const report = {
    returned,
    tallies: Object.fromEntries(Object.entries(tallies).map(([name, t]) => [name, {
      candidates: t.candidates,
      notesPerCandidate: r(t.notes / t.candidates),
      strongBeatChordTone: share(t.strongChord, t.strong),
      chromaticNonChordPer100: r(100 * t.chromaticNonChord / Math.max(1, t.notes)),
      // 飛び出す音は、同じ開始の音を最高音1つにした線で数えるので、分母もその線の音数
      isolatedLeapPer100: r(100 * t.isolated / Math.max(1, t.lineNotes)),
      silentShareMean: r(t.silentTotal / t.candidates),
      leadOverlapNotes: t.overlapNotes,
      leadOverlapBeats: r(t.overlapBeats),
      minorSecondShare: share(t.minorSecond, t.overlapNotes),
      minorSecondBeats: r(t.minorSecondBeats),
      minorSecondOnBeat: t.minorSecondOnBeat,
      minorSecondResolved: t.minorSecondResolved,
      majorSeventhShare: share(t.majorSeventh, t.overlapNotes),
      compoundShare: share(t.compound, t.overlapNotes),
      movingPairs: t.movingPairs,
      similarMotionPairs: t.similarMotionPairs,
      parallelPerfect: t.parallelPerfect,
      parallelPerfectRate: share(t.parallelPerfect, t.similarMotionPairs),
      comparedWithLead: t.compared,
      aboveLeadShare: share(t.above, t.compared),
      crossingsPerCandidate: t.compared > 0 ? r(t.crossings / t.candidates) : null,
      otherLayerOverlapNotes: t.otherOverlapNotes,
      otherLayerMinorSecondShare: share(t.otherMinorSecond, t.otherOverlapNotes),
    }])),
  }
  writeFileSync(process.env.ARRANGEMENT_BASELINE_OUT!, JSON.stringify(report, null, 1))
}, 900000)
