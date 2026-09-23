import type { CandidateMelodyDNA, MelodyGeneratorProfile, MelodyNote, PhrasePlan } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"

/**
 * 頂点後の終止で音数を減らし、最後の和声音を保持して伴奏へ余韻を渡す。
 * 前半のフックと各和声の入りは残す。Middle-climax の解決型だけに適用し、
 * 他の候補が持つ終盤の推進力も選択肢として保つ。
 */
export function shapeMelodicRelease(
  source: MelodyNote[],
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  profile: MelodyGeneratorProfile = "standard",
  sectionRole?: SectionRole,
  dna?: CandidateMelodyDNA,
  plans?: PhrasePlan[],
): MelodyNote[] {
  if (
    totalBeats < 24 ||
    (profile !== "standard" && profile !== "cinematic") ||
    (sectionRole !== "chorus" && sectionRole !== "grand-chorus") ||
    dna?.climaxPlan.position !== "middle" ||
    dna.endingStrategy !== "resolved" ||
    source.length < 10
  ) return source

  const notes = [...source].sort((a, b) => a.startBeat - b.startBeat)
  const finalChord = chordAtBeat(harmonicMap, totalBeats - 0.01)
  if (!finalChord || totalBeats - finalChord.chord.startBeat < 2) return source
  const finalChordStart = finalChord.chord.startBeat
  // 終盤を間引く場合も、A/Bそれぞれの再登場部分はリズムの目印として残す。
  const hookHeadIds = new Set((plans ?? []).flatMap(plan =>
    notes.filter(note => note.startBeat >= plan.phraseStartBeat &&
      note.startBeat < plan.phraseStartBeat + plan.phraseLengthBeats &&
      note.startBeat < finalChordStart).slice(0, 3).map(note => note.id)))
  const tailStart = Math.max(0, totalBeats - 16)
  const tail = notes.filter(note => note.startBeat >= tailStart)
  const landingNotes = tail.filter(note => note.startBeat >= finalChordStart)
  const resolutionTargets = tail.flatMap(note => note.plannedResolution ? [note.plannedResolution.targetBeat] : [])
  const isProtected = (note: MelodyNote): boolean =>
    note.locks.length > 0 || hookHeadIds.has(note.id) || Boolean(note.plannedResolution) ||
    resolutionTargets.some(beat => Math.abs(beat - note.startBeat) < 0.01)
  if (landingNotes.length < 2 || landingNotes.some(isProtected)) return source

  const landingSource = landingNotes[landingNotes.length - 1]
  const landing = { ...landingNotes[0], pitch: landingSource.pitch, plannedToneRole: landingSource.plannedToneRole }
  const landingEnd = Math.min(totalBeats - 0.75, landing.startBeat + 3)
  if (landingEnd - landing.startBeat < 0.75) return source
  landing.durationBeats = landingEnd - landing.startBeat

  const kept: MelodyNote[] = []
  for (const note of tail) {
    if (note.startBeat >= finalChordStart) break
    const entry = chordAtBeat(harmonicMap, note.startBeat)
    const previous = kept[kept.length - 1]
    // 各コードの入りを残し、同じ和声では概ね二拍以上の間隔を作る。
    if (isProtected(note) || !previous || entry !== chordAtBeat(harmonicMap, previous.startBeat) || note.startBeat - previous.startBeat >= 2) {
      kept.push({ ...note })
    }
  }
  kept.push(landing)
  for (let i = 0; i < kept.length - 1; i++) {
    const note = kept[i]
    const next = kept[i + 1]
    if (isProtected(note)) continue
    const entry = chordAtBeat(harmonicMap, note.startBeat)
    const chordEnd = entry ? entry.chord.startBeat + entry.chord.durationBeats : totalBeats
    const maximumEnd = Math.min(chordEnd, next.startBeat - 0.25, note.startBeat + 2.5)
    if (maximumEnd > note.startBeat + 0.25) note.durationBeats = maximumEnd - note.startBeat
  }
  return [...notes.filter(note => note.startBeat < tailStart), ...kept]
}
