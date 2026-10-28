import { it } from "vitest"
import { writeFileSync } from "node:fs"
import { createEmptyProject } from "@/core/project"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
it("records generation timings without changing production or fixtures", () => {
  const p = createEmptyProject("Riff performance measurement")
  p.projectId = "riff-performance"
  p.song.key = "Am"
  p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
  const roles = ["intro", "verse", "pre-chorus", "chorus", "verse", "pre-chorus", "chorus", "breakdown-chorus", "bridge", "pre-chorus", "grand-chorus", "outro", "outro"] as const
  p.sections = roles.map((role, index) => ({ id: `p${index}`, name: `Section ${index}`, role, startBar: 1 + 16 * index, lengthBars: 16 }))
  p.chords = p.sections.flatMap((section) => Array.from({ length: 8 }, (_, index) => ({ id: `${section.id}:${index}`, sectionId: section.id, startBeat: index * 8, durationBeats: 8, symbol: ["Am", "F", "C", "G"][index % 4], bass: null })))
  generateFullSongArrangement(p, { seed: 19 })
  const times: number[] = []
  for (let index = 0; index < 5; index++) {
    const start = performance.now()
    generateFullSongArrangement(p, { seed: 19 })
    times.push(performance.now() - start)
  }
  writeFileSync(`/private/tmp/pr209-performance-${process.env.MEASURE_TAG}.json`, JSON.stringify({ times, median: [...times].sort((a,b)=>a-b)[2] }, null, 2))
}, 120_000)
