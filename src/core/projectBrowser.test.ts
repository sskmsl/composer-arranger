import { describe, expect, it } from "vitest"
import {
  duplicateProjectData,
  nextLastOpenedAfterDelete,
  sortSummariesByRecency,
  filterSummaries,
  summarizeProject,
  type ProjectSummary,
} from "./projectBrowser"
import { createEmptyProject, TIME_BASE, type ComposerProject } from "./project"
import type { MelodyVariant, SongMotifDNA } from "./melody"

function richProject(): ComposerProject {
  const base = createEmptyProject("Song A")
  const dna: SongMotifDNA = {
    intervalCells: [0, 2, -2],
    rhythmCells: [1, 0.5],
    repeatedNoteTendency: 0.4,
    approachNoteTendency: 0.6,
    contourTendency: 0.2,
    phraseEndingTendency: 0.7,
    characteristicRests: [0.5],
    climaxDirection: "ascending",
  }
  const variant: MelodyVariant = {
    id: "v1",
    name: "Elegiac · Pattern 1",
    sectionId: "s1",
    sourceMode: "generate",
    notes: [{ id: "n1", startBeat: 0, durationBeats: 2, pitch: 64, velocity: 80, locks: [] }],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "2.0",
    seed: 123,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "b1",
    createdAt: new Date().toISOString(),
    generatorProfile: "elegiac-cantabile",
    patternIndex: 1,
    advancedMetrics: { stepwiseMotionRatio: 0.8 },
    prosodyPlan: { syllableSlots: [{ beat: 0, durationBeats: 2, accent: "primary" }], breathPositions: [4] },
    openingIntent: { entryType: "suspension", emotionalFunction: "hesitation", register: "middle", initialDirection: "descending" },
  }
  return {
    ...base,
    sections: [{ id: "s1", name: "A", role: "verse", startBar: 1, lengthBars: 4 }],
    melodyVariants: [variant],
    songMotifDNA: dna,
    generatorProfileRoles: { "elegiac-cantabile": "primary" },
  }
}

describe("duplicateProjectData: 新しいprojectIdと全データ保持", () => {
  it("新しいprojectIdを持ち、タイトルはコピー名になる", () => {
    const src = richProject()
    const dup = duplicateProjectData(src)
    expect(dup.projectId).not.toBe(src.projectId)
    expect(dup.title).toBe("Song A のコピー")
  })

  it("Song Motif DNA / generatorProfileRoles / Variantの新規メタデータを保持する", () => {
    const dup = duplicateProjectData(richProject())
    expect(dup.songMotifDNA).toEqual(richProject().songMotifDNA)
    expect(dup.generatorProfileRoles).toEqual({ "elegiac-cantabile": "primary" })
    const v = dup.melodyVariants[0]
    expect(v.generatorProfile).toBe("elegiac-cantabile")
    expect(v.patternIndex).toBe(1)
    expect(v.advancedMetrics).toEqual({ stepwiseMotionRatio: 0.8 })
    expect(v.prosodyPlan?.breathPositions).toEqual([4])
    expect(v.openingIntent?.entryType).toBe("suspension")
  })

  it("深いコピーで元と参照を共有しない", () => {
    const src = richProject()
    const dup = duplicateProjectData(src)
    dup.melodyVariants[0].notes[0].pitch = 72
    expect(src.melodyVariants[0].notes[0].pitch).toBe(64)
  })

  it("timeBaseを保持する(再変換対象にならない)", () => {
    const dup = duplicateProjectData(richProject())
    expect(dup.timeBase).toBe(TIME_BASE)
  })

  it("AI PartnerのSection別会話をProject複製でも保持する", () => {
    const src = richProject()
    src.aiPartnerSessions = {
      s1: {
        sectionId: "s1",
        updatedAt: "2026-08-19T00:00:00.000Z",
        confirmedConstraints: ["メロディは変えない"],
        turns: [],
      },
    }
    const dup = duplicateProjectData(src)
    expect(dup.aiPartnerSessions?.s1?.confirmedConstraints).toEqual([
      "メロディは変えない",
    ])
  })
})

describe("summarizeProject: 生JSONと保存レコードの両方を同じく扱う", () => {
  it("保存レコード(savedAt付き)からメタデータを作る", () => {
    const rec = { ...richProject(), savedAt: "2026-07-25T00:00:00.000Z" }
    const s = summarizeProject(rec)
    expect(s).toMatchObject({ title: "Song A", tempo: 96, key: "Am", sectionCount: 1, savedAt: "2026-07-25T00:00:00.000Z", timingAmbiguous: false })
  })

  it("JSON Import相当の生オブジェクト(savedAtなし)でもsavedAt=nullで扱える", () => {
    const s = summarizeProject(richProject())
    expect(s.savedAt).toBeNull()
    expect(s.title).toBe("Song A")
  })

  it("schemaVersion 1.0相当(song欠落)でも正規化して一覧化できる", () => {
    const legacy = { projectId: "p-legacy", title: "Legacy", sections: [], chords: [], melodyVariants: [] }
    const s = summarizeProject(legacy)
    expect(s.projectId).toBe("p-legacy")
    expect(s.title).toBe("Legacy")
    expect(s.sectionCount).toBe(0)
  })

  it("時間単位が曖昧な旧6/8・1.1データは timingAmbiguous=true(かつ再スケールしない)", () => {
    const base = createEmptyProject("Old 6/8")
    const ambiguous = {
      ...base,
      schemaVersion: "1.1",
      timeBase: undefined,
      song: { ...base.song, timeSignature: "6/8" },
      sections: [{ id: "s1", name: "A", role: "verse", startBar: 1, lengthBars: 1 }],
      // 判定材料が無い(時間値なし)ので ambiguous になる
      chords: [],
    }
    const s = summarizeProject(ambiguous)
    expect(s.timingAmbiguous).toBe(true)
  })

  it("4/4データは timingAmbiguous=false", () => {
    const s = summarizeProject({ ...createEmptyProject("Std"), song: { ...createEmptyProject("Std").song, timeSignature: "4/4" } })
    expect(s.timingAmbiguous).toBe(false)
  })
})

describe("nextLastOpenedAfterDelete", () => {
  it("削除対象がlastOpenedでなければ据え置き", () => {
    expect(nextLastOpenedAfterDelete("b", "a", ["a", "c"])).toBe("a")
  })
  it("lastOpenedを削除したら残りの先頭へ", () => {
    expect(nextLastOpenedAfterDelete("a", "a", ["a", "b", "c"])).toBe("b")
  })
  it("最後の1件を削除したらnull", () => {
    expect(nextLastOpenedAfterDelete("a", "a", ["a"])).toBeNull()
  })
})

describe("並べ替え・絞り込み", () => {
  const items: ProjectSummary[] = [
    { projectId: "1", title: "Alpha", savedAt: "2026-07-24T00:00:00Z", tempo: 96, key: "Am", timeSignature: "4/4", sectionCount: 1, timingAmbiguous: false },
    { projectId: "2", title: "Beta", savedAt: "2026-07-25T00:00:00Z", tempo: 100, key: "C", timeSignature: "4/4", sectionCount: 2, timingAmbiguous: false },
  ]
  it("更新日時の新しい順", () => {
    expect(sortSummariesByRecency(items).map((s) => s.projectId)).toEqual(["2", "1"])
  })
  it("タイトル部分一致で絞り込み", () => {
    expect(filterSummaries(items, "alph").map((s) => s.title)).toEqual(["Alpha"])
  })
})
