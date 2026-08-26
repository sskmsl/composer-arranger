import { describe, expect, it } from "vitest"
import { createEmptyProject, type ImportedArrangementTrackRole } from "@/core/project"
import { recommendImportNextStep } from "./importStartGuideRecommendation"

function importedProject(roles: ImportedArrangementTrackRole[]) {
  const project = createEmptyProject("Imported")
  project.sections = [{ id: "s1", name: "Verse", role: "verse", startBar: 1, lengthBars: 4 }]
  project.importedArrangement = {
    version: "1.0.0",
    sourceKind: "external-song",
    totalBeats: 16,
    tracks: roles.filter((role) => role !== "ignore").map((role, index) => ({
      sourceTrackIndex: index,
      name: role,
      role: role as Exclude<ImportedArrangementTrackRole, "ignore">,
      notes: [],
    })),
  }
  return project
}

describe("import start guide", () => {
  it("主旋律がなければ最初にMelodyを勧める", () => {
    expect(recommendImportNextStep(importedProject(["harmony"])).target).toBe("melody")
  })

  it("Melodyとコードだけなら音を足す前にリズム設計を勧める", () => {
    const project = importedProject(["melody", "harmony"])
    expect(recommendImportNextStep(project)).toMatchObject({
      target: "rhythm",
      title: "リズム設計",
    })
  })

  it("DrumsがあってBassがなければ低域設計を勧める", () => {
    expect(recommendImportNextStep(importedProject(["melody", "harmony", "drums"])).target).toBe("bass")
  })

  it("主要パートが揃えば第二の顔、さらに揃えば全体整理を勧める", () => {
    expect(recommendImportNextStep(importedProject(["melody", "harmony", "drums", "bass"])).target).toBe("counter")
    expect(recommendImportNextStep(importedProject(["melody", "harmony", "drums", "bass", "counter"])).target).toBe("arrangement")
  })
})
