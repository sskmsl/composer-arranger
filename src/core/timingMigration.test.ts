import { describe, expect, it } from "vitest"
import { convertProjectTiming, resolveAmbiguousTiming, resolveProjectTiming } from "./timingMigration"
import { createEmptyProject, TIME_BASE, type ChordEvent, type ComposerProject } from "./project"
import type { Section } from "./section"
import type { MelodyVariant } from "./melody"

function rawProjectWith(overrides: {
  timeSignature: string
  sections: Section[]
  chords: ChordEvent[]
  melodyVariants?: MelodyVariant[]
  timeBase?: "quarter"
  schemaVersion?: string
}): unknown {
  const base = createEmptyProject("Test")
  return {
    ...base,
    schemaVersion: overrides.schemaVersion ?? "1.1",
    timeBase: overrides.timeBase,
    song: { ...base.song, timeSignature: overrides.timeSignature },
    sections: overrides.sections,
    chords: overrides.chords,
    melodyVariants: overrides.melodyVariants ?? [],
  }
}

const section1Bar: Section = { id: "s1", name: "A", role: "verse", startBar: 1, lengthBars: 1 }

describe("resolveProjectTiming: 分母4(4/4, 3/4)は無条件で変換しない", () => {
  it("4/4のデータは値が変化しない", () => {
    const raw = rawProjectWith({
      timeSignature: "4/4",
      sections: [section1Bar],
      chords: [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "C", bass: null }],
    })
    const result = resolveProjectTiming(raw)
    expect(result.status).toBe("no-op")
    expect(result.project.chords[0].durationBeats).toBe(4)
    expect(result.project.timeBase).toBe(TIME_BASE)
  })

  it("3/4のデータは値が変化しない", () => {
    const raw = rawProjectWith({
      timeSignature: "3/4",
      sections: [section1Bar],
      chords: [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 3, symbol: "C", bass: null }],
    })
    const result = resolveProjectTiming(raw)
    expect(result.status).toBe("no-op")
    expect(result.project.chords[0].durationBeats).toBe(3)
  })
})

describe("resolveProjectTiming: 6/8などの旧形式データを新しい単位へ変換する", () => {
  it("Issue #16のrepro: 6/8・1小節・durationBeats=6(旧形式)は変換後1小節分(3拍)になる", () => {
    const raw = rawProjectWith({
      timeSignature: "6/8",
      sections: [section1Bar],
      chords: [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 6, symbol: "C", bass: null }],
    })
    const result = resolveProjectTiming(raw)
    expect(result.status).toBe("auto-converted")
    expect(result.factor).toBeCloseTo(0.5)
    expect(result.project.chords[0].durationBeats).toBeCloseTo(3)
    expect(result.project.chords[0].startBeat).toBeCloseTo(0)
    expect(result.project.timeBase).toBe(TIME_BASE)
  })

  it("新形式(PR#7後)の正しい6/8データは誤って再変換されない", () => {
    const raw = rawProjectWith({
      timeSignature: "6/8",
      sections: [section1Bar],
      chords: [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 3, symbol: "C", bass: null }],
    })
    const result = resolveProjectTiming(raw)
    expect(result.status).toBe("no-op")
    expect(result.project.chords[0].durationBeats).toBe(3)
  })

  it("MelodyNote/PhrasePlan/ProsodyPlanも同じ倍率で変換され、相対位置が保たれる", () => {
    const variant: MelodyVariant = {
      id: "v1",
      name: "v1",
      sectionId: "s1",
      sourceMode: "generate",
      notes: [
        { id: "n1", startBeat: 0, durationBeats: 2, pitch: 60, velocity: 80, locks: [] },
        { id: "n2", startBeat: 2, durationBeats: 4, pitch: 62, velocity: 80, locks: [] },
      ],
      phrasePlans: [
        { phraseStartBeat: 0, phraseLengthBeats: 6, climaxBeat: 4, contour: "arch", restBeats: [2], endTension: 0.2 },
      ],
      lockedBars: [0],
      motifLocked: false,
      features: null,
      generatorVersion: "1.0",
      seed: 1,
      songProfile: "original-custom",
      parentMelodyId: null,
      batchId: "b1",
      createdAt: new Date().toISOString(),
      prosodyPlan: { syllableSlots: [{ beat: 0, durationBeats: 2, accent: "primary" }], breathPositions: [4] },
    }
    const raw = rawProjectWith({
      timeSignature: "6/8",
      sections: [section1Bar],
      chords: [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 6, symbol: "C", bass: null }],
      melodyVariants: [variant],
    })
    const result = resolveProjectTiming(raw)
    expect(result.status).toBe("auto-converted")
    const v = result.project.melodyVariants[0]
    // 元の比率(n2のstartBeat/durationBeats合計=区間の1/3)が変換後も保たれる
    expect(v.notes[0]).toMatchObject({ startBeat: 0, durationBeats: 1 })
    expect(v.notes[1]).toMatchObject({ startBeat: 1, durationBeats: 2 })
    expect(v.phrasePlans[0]).toMatchObject({ phraseStartBeat: 0, phraseLengthBeats: 3, climaxBeat: 2, restBeats: [1] })
    expect(v.prosodyPlan?.syllableSlots[0]).toMatchObject({ beat: 0, durationBeats: 1 })
    expect(v.prosodyPlan?.breathPositions[0]).toBeCloseTo(2)
    // lockedBarsは小節インデックスであり拍値ではないため変換されない
    expect(v.lockedBars).toEqual([0])
  })

  it("何度resolveProjectTimingを通しても再変換されない(冪等性)", () => {
    const raw = rawProjectWith({
      timeSignature: "6/8",
      sections: [section1Bar],
      chords: [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 6, symbol: "C", bass: null }],
    })
    const once = resolveProjectTiming(raw)
    const twice = resolveProjectTiming(once.project)
    expect(twice.status).toBe("no-op")
    expect(twice.project.chords[0].durationBeats).toBeCloseTo(3)
  })
})

describe("resolveProjectTiming: 判定できない場合は変換せずambiguousを返す", () => {
  it("時間値のデータが存在せず判定材料がない場合", () => {
    const raw = rawProjectWith({ timeSignature: "6/8", sections: [section1Bar], chords: [] })
    const result = resolveProjectTiming(raw)
    expect(result.status).toBe("ambiguous")
    expect(result.ambiguity?.timeSignature).toBe("6/8")
    // 判定できない間はデータを書き換えない
    expect(result.project.timeBase).toBeUndefined()
  })

  it("セクション間で新旧の判定が割れる場合", () => {
    const section2: Section = { id: "s2", name: "B", role: "chorus", startBar: 2, lengthBars: 1 }
    const raw = rawProjectWith({
      timeSignature: "6/8",
      sections: [section1Bar, section2],
      chords: [
        { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 6, symbol: "C", bass: null }, // 旧形式的
        { id: "c2", sectionId: "s2", startBeat: 0, durationBeats: 3, symbol: "F", bass: null }, // 新形式的
      ],
    })
    const result = resolveProjectTiming(raw)
    expect(result.status).toBe("ambiguous")
  })
})

describe("resolveAmbiguousTiming", () => {
  function ambiguousProject(): ComposerProject {
    const raw = rawProjectWith({ timeSignature: "6/8", sections: [section1Bar], chords: [] })
    return resolveProjectTiming(raw).project
  }

  it("変換を選ぶとfactor=4/denominatorで変換され、timeBaseが付与される", () => {
    const project = { ...ambiguousProject(), chords: [{ id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 6, symbol: "C", bass: null }] }
    const resolved = resolveAmbiguousTiming(project, true)
    expect(resolved.timeBase).toBe(TIME_BASE)
    expect(resolved.chords[0].durationBeats).toBeCloseTo(3)
  })

  it("変換しない選択でも、再度確認を求めないようtimeBaseは付与される", () => {
    const project = ambiguousProject()
    const resolved = resolveAmbiguousTiming(project, false)
    expect(resolved.timeBase).toBe(TIME_BASE)
    expect(resolved.chords).toEqual(project.chords)
  })
})

describe("convertProjectTiming", () => {
  it("factor=1のときは何もしない(同一参照を返す)", () => {
    const project = createEmptyProject("Test")
    expect(convertProjectTiming(project, 1)).toBe(project)
  })
})
