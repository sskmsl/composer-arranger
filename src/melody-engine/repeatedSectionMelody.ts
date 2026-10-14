import { effectiveSectionKey, type ComposerProject } from "@/core/project"
import { allUsablePitchClasses } from "@/core/chord"
import { keyScalePitchClasses, parseKey } from "@/core/scale"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import { notesByPartRole, resolvedLeadContent } from "@/core/sectionLayers"
import { buildHarmonicMap, chordAtBeat } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"

/** 初回生成だけ、同じ構成の前のセクションを参照する。採用済み候補は変更しない。 */
export function repeatedSectionSource(project: ComposerProject, sectionId: string): MelodyVariant | undefined {
  if (project.melodyVariants.some((v) => v.sectionId === sectionId)) return undefined
  const index = project.sections.findIndex((s) => s.id === sectionId)
  const target = project.sections[index]
  if (!target || !["verse", "chorus"].includes(target.role)) return undefined
  const signature = (id: string) => JSON.stringify(project.chords.filter((c) => c.sectionId === id)
    .sort((a, b) => a.startBeat - b.startBeat).map((c) => [c.symbol, c.bass, c.startBeat, c.durationBeats]))
  return project.sections.slice(0, index).filter((s) => s.role === target.role && s.lengthBars === target.lengthBars && signature(s.id) === signature(sectionId))
    .map((s) => project.melodyVariants.find((v) => v.id === project.sectionMelodyAssignments[s.id]))
    .find((v) => v?.sourceMode === "generate" && resolvedLeadContent(v) === "melody" && notesByPartRole(v, "lead").length > 0)
}

export function varyRepeatedSection(
  source: MelodyVariant, project: ComposerProject, sectionId: string,
  totalBeats: number, beatsPerBar: number, range: RangeSetting, seed: number, pattern: 1 | 2 | 3 = 1,
): MelodyNote[] {
  const notes = notesByPartRole(source, "lead").slice().sort((a, b) => a.startBeat - b.startBeat)
  const tailStart = Math.max(0, totalBeats - beatsPerBar * 2)
  const map = buildHarmonicMap(project.chords.filter((c) => c.sectionId === sectionId))
  const key = effectiveSectionKey(project, sectionId)
  const scale = new Set(keyScalePitchClasses(key))
  const parsedKey = parseKey(key)
  if (parsedKey?.isMinor) scale.add((parsedKey.rootPc + 11) % 12)
  const hookEnd = Math.min(totalBeats, beatsPerBar * 2)
  const restBoundaries = new Set<number>()
  notes.forEach((n, index) => {
    const next = notes[index + 1]
    if (next && next.startBeat - n.startBeat - n.durationBeats >= 1 - 1e-6) {
      restBoundaries.add(index)
      restBoundaries.add(index + 1)
    }
  })
  const result = notes.map((note, index): MelodyNote => {
    if (note.startBeat < hookEnd) return { ...note }
    const last = index === notes.length - 1
    const tail = note.startBeat >= tailStart
    const change = tail || (pattern === 2 ? note.startBeat >= totalBeats / 2 : pattern === 3 && index % 2 === 0)
    let startBeat = note.startBeat
    const originalChord = chordAtBeat(map, note.startBeat)!
    const chordEnd = Math.min(totalBeats, originalChord.chord.startBeat + originalChord.chord.durationBeats)
    // 各案で変更箇所を変え、和音の境界を越えない短い入りの変化を使う。
    const move = pattern === 1 ? tail && index % 2 === 0
      : pattern === 2 ? note.startBeat >= totalBeats / 2 && index % 3 === 0
        : index % 3 === 1
    if (move && !last && !restBoundaries.has(index)) {
      const next = notes[index + 1]?.startBeat ?? totalBeats
      if (note.startBeat + 0.25 < Math.min(chordEnd, next)) startBeat += 0.25
    }
    if (last) startBeat = Math.min(startBeat, totalBeats - 1)
    const chord = chordAtBeat(map, startBeat)!
    const strong = Math.abs(startBeat / 2 - Math.round(startBeat / 2)) < 0.03
      || Math.abs(startBeat - chord.chord.startBeat) < 0.06 || last
    const tones = chord.parsed.tones.map((t) => t.pitchClass)
    const usable = allUsablePitchClasses(chord.parsed)
    // スケールとコード双方に入る音を優先し、強拍・終止は必ず和声音にする。
    const allowed = strong ? tones : usable.filter((p) => scale.has(p))
    const choices = Array.from({ length: range.high - range.low + 1 }, (_, i) => range.low + i)
      .filter((p) => (allowed.length ? allowed : tones).includes(p % 12))
    const previous = notes[index - 1]
    const following = notes[index + 1]
    const cost = (pitch: number) => {
      const distance = Math.abs(pitch - note.pitch)
      const contourCost = (previous && Math.sign(pitch - previous.pitch) !== Math.sign(note.pitch - previous.pitch) ? 4 : 0)
        + (following && Math.sign(following.pitch - pitch) !== Math.sign(following.pitch - note.pitch) ? 4 : 0)
      return distance + Math.max(0, distance - 2) * 3 + contourCost
        + (change && pitch === note.pitch ? 3.5 : 0)
        + (pattern === 2 && pitch < note.pitch || pattern === 3 && pitch > note.pitch ? 0.7 : 0)
    }
    const pitch = change || last ? choices.sort((a, b) => cost(a) - cost(b))[0] ?? note.pitch : note.pitch
    return { ...note, id: `${sectionId}:variation:${seed}:${index}`, locks: [], pitch, startBeat,
      durationBeats: last ? totalBeats - startBeat : Math.min(note.durationBeats, chordEnd - startBeat) }
  })
  // 最後の音を1拍確保するために移した場合、直前の音を重ねない。
  const last = result.at(-1)
  return result.filter((note, index) => index === result.length - 1 || !last || note.startBeat < last.startBeat)
    .map((note, index, all) => note.startBeat < hookEnd ? note
      : { ...note, durationBeats: Math.max(0.01, Math.min(note.durationBeats, (all[index + 1]?.startBeat ?? totalBeats) - note.startBeat)) })
}
