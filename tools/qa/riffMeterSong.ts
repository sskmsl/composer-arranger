import { createEmptyProject } from "../../src/core/project"
import { parseTimeSignature } from "../../src/core/section"

/** 拍子・保存・主旋律との近接を確認するための固定入力。製品のプリセットではない。 */
export function riffMeterSong(meter: string) {
  const p = createEmptyProject("Riff meter review")
  p.projectId = `riff-meter-${meter}`
  p.song.timeSignature = meter
  p.song.key = "Am"
  p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
  const roles = ["intro", "verse", "pre-chorus", "chorus", "verse", "pre-chorus", "chorus", "breakdown-chorus", "bridge", "pre-chorus", "grand-chorus", "outro", "outro"] as const
  p.sections = roles.map((role, i) => ({ id: `m${i}`, name: `区間${i + 1}`, role, startBar: 1 + i * 16, lengthBars: 16 }))
  const bpb = parseTimeSignature(meter).beatsPerBar
  p.chords = p.sections.flatMap(s => Array.from({ length: 8 }, (_, i) => ({
    id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * 2 * bpb, durationBeats: 2 * bpb,
    symbol: ["Am", "F", "C", "G"][i % 4], bass: null,
  })))
  for (const section of p.sections.filter(s => s.role === "chorus" || s.role === "grand-chorus")) {
    const id = `lead-${section.id}`
    p.melodyVariants.push({ id, name: "近接確認", sectionId: section.id, sourceMode: "generate",
      notes: [{ id: `${id}:n`, startBeat: 2 * bpb + .25, durationBeats: .5, pitch: 49, velocity: 80, locks: [] }],
      phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "qa", seed: 19,
      songProfile: "original-custom", parentMelodyId: null, batchId: "meter-review", createdAt: "2026-01-01T00:00:00.000Z" })
    p.sectionMelodyAssignments[section.id] = id
  }
  return p
}
