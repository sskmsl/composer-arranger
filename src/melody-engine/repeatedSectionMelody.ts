import type { ComposerProject } from "@/core/project"
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
  totalBeats: number, beatsPerBar: number, range: RangeSetting, seed: number,
): MelodyNote[] {
  const notes = notesByPartRole(source, "lead").slice().sort((a, b) => a.startBeat - b.startBeat)
  const tailStart = Math.max(0, totalBeats - beatsPerBar * 2)
  const map = buildHarmonicMap(project.chords.filter((c) => c.sectionId === sectionId))
  const tail = notes.filter((n) => n.startBeat >= tailStart)
  // フレーズをまとめて移調することで輪郭を維持し、末尾だけ新しい着地にする。
  const shifts = seed % 2 ? [2, -2, 1, -1] : [-2, 2, -1, 1]
  const shift = shifts.find((delta) => tail.every((n) => n.pitch + delta >= range.low && n.pitch + delta <= range.high)) ?? 0
  return notes.flatMap((note, index) => {
    const isTail = note.startBeat >= tailStart
    const startBeat = note.startBeat + (isTail ? 0.5 : 0)
    if (startBeat >= totalBeats) return []
    let pitch = note.pitch + (isTail ? shift : 0)
    const chord = chordAtBeat(map, startBeat)
    if (isTail && chord && Math.abs(startBeat - chord.chord.startBeat) < 0.06) {
      const tones = chord.parsed.tones.map((t) => t.pitchClass)
      const choices = Array.from({ length: range.high - range.low + 1 }, (_, i) => range.low + i).filter((p) => tones.includes(p % 12))
      pitch = choices.sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch))[0] ?? pitch
    }
    return [{ ...note, id: `${sectionId}:variation:${seed}:${index}`, locks: [], pitch, startBeat,
      durationBeats: Math.min(note.durationBeats, totalBeats - startBeat) }]
  })
}
