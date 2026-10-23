import { expect, it } from "vitest"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { generateFullSongArrangement, regenerateFullSongArrangementTarget } from "./arrangementGenerator"

it("preserves a saved whole-track instrument in both section and track regeneration", () => {
  const p = arrangementReviewSong("A")
  const a = generateFullSongArrangement(p, { seed: 19 })
  const source = a.tracks.find((t) => t.id === "syn-pulse")!
  source.instrument = { program: 24, reason: "Saved accompaniment" }
  for (const sectionId of [p.sections[1].id, undefined]) {
    const result = regenerateFullSongArrangementTarget(p, a, { trackId: "syn-pulse", sectionId })
    expect(result.tracks.find((t) => t.id === "syn-pulse")!.instrument).toEqual(source.instrument)
    expect(result.tracks.filter((t) => t.id !== "syn-pulse")).toEqual(a.tracks.filter((t) => t.id !== "syn-pulse"))
  }
})
