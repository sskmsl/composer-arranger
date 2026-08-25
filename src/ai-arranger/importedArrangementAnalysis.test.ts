import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import { analyzeImportedArrangementSection } from "./importedArrangementAnalysis"

function project() {
  const value = createEmptyProject("Imported Analysis")
  value.sections = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 2 },
    { id: "verse", name: "Verse", role: "verse", startBar: 3, lengthBars: 2 },
  ]
  value.importedArrangement = {
    version: "1.0.0",
    sourceKind: "external-song",
    totalBeats: 16,
    tracks: [
      {
        sourceTrackIndex: 0, name: "Lead", role: "melody",
        notes: [
          [0, 2, 69, 82, 1],
          [8, 1, 72, 86, 1],
        ],
      },
      {
        sourceTrackIndex: 1, name: "Bass", role: "bass",
        notes: [
          [0, 1, 45, 72, 1],
          [8, 1, 48, 74, 1],
        ],
      },
      {
        sourceTrackIndex: 2, name: "Strings", role: "strings",
        notes: [[8, 4, 71, 60, 1]],
      },
    ],
  }
  return value
}

describe("Imported Arrangement Analysis", () => {
  it("外部曲の原演奏をSection位置で分割して役割・密度・余白を解析する", () => {
    const intro = analyzeImportedArrangementSection(project(), "intro")
    const verse = analyzeImportedArrangementSection(project(), "verse")
    expect(intro).toMatchObject({
      sourceKind: "external-song",
      totalNotes: 2,
      activeRoles: ["melody", "bass"],
    })
    expect(verse?.activeRoles).toEqual(["melody", "bass", "strings"])
    expect(verse?.roles.find((role) => role.role === "strings")?.pitchRange).toEqual({ lowest: 71, highest: 71 })
    expect(verse?.silenceRatio).toBeGreaterThanOrEqual(0)
  })

  it("主旋律と補助パートの半音以内の重なりを検出する", () => {
    const value = project()
    value.importedArrangement!.tracks[1].notes[0][2] = 70
    expect(analyzeImportedArrangementSection(value, "intro")?.melodyCollisionCount).toBe(1)
  })
})
