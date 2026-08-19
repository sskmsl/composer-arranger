import { describe, expect, it } from "vitest"
import { parseChordSymbol } from "./chord"
import {
  applyAccompanimentPattern,
  accompanimentPatternNotesForSection,
  createDefaultAccompanimentPatterns,
  resolveAccompanimentDegree,
  type AccompanimentPatternTemplate,
} from "./accompanimentPattern"
import type { ChordEvent } from "./project"
import { createEmptyProject, normalizeProject } from "./project"

const sustainedRoot: AccompanimentPatternTemplate = {
  id: "sustained-root",
  name: "Sustained Root",
  lengthBeats: 2,
  events: [
    { offsetBeats: 0, durationBeats: 2, degree: 1, octaveOffset: 1, velocity: 80 },
  ],
}

function chord(symbol: string, startBeat = 0, durationBeats = 4): ChordEvent {
  return { id: `${symbol}:${startBeat}`, sectionId: "s", startBeat, durationBeats, symbol, bass: null }
}

function melody(pitch: number, startBeat = 0, durationBeats = 1): import("./melody").MelodyNote {
  return { id: `melody:${pitch}:${startBeat}`, pitch, startBeat, durationBeats, velocity: 88, locks: [] }
}

describe("Accompaniment Pattern / コード度数解決", () => {
  it.each([
    ["C", 3, 52],
    ["Cm", 3, 51],
    ["C7", 7, 58],
    ["Cmaj7", 7, 59],
    ["Cdim", 5, 54],
    ["Cadd9", 9, 62],
  ] as const)("%s の %i度をコード品質に合わせてMIDIへ変換する", (symbol, degree, expected) => {
    const parsed = parseChordSymbol(symbol)!
    expect(resolveAccompanimentDegree(parsed, degree, 1)).toBe(expected)
  })

  it("コード境界をまたぐイベントは分割し、新しいコードの同じ度数へ解決する", () => {
    const notes = applyAccompanimentPattern(
      sustainedRoot,
      [chord("C", 0, 1), chord("Dm", 1, 1)],
      2,
    )
    expect(notes.map(({ startBeat, durationBeats, pitch }) => ({ startBeat, durationBeats, pitch }))).toEqual([
      { startBeat: 0, durationBeats: 1, pitch: 48 },
      { startBeat: 1, durationBeats: 1, pitch: 50 },
    ])
  })

  it("コード境界では固定オクターブの大跳躍を避け、近い声部へ接続する", () => {
    const notes = applyAccompanimentPattern(
      sustainedRoot,
      [chord("C", 0, 1), chord("B", 1, 1)],
      2,
    )
    expect(notes.map((note) => note.pitch)).toEqual([48, 47])
  })

  it("同じテンプレートを別コード進行へ適用してもリズムを保持し、音高だけを再解決する", () => {
    const pattern = createDefaultAccompanimentPatterns().find((candidate) => candidate.id === "arpeggio-up")!
    const first = applyAccompanimentPattern(pattern, [chord("C")], 4)
    const second = applyAccompanimentPattern(pattern, [chord("F#m")], 4)

    expect(first.map((note) => [note.startBeat, note.durationBeats])).toEqual(
      second.map((note) => [note.startBeat, note.durationBeats]),
    )
    expect(first.map((note) => note.pitch)).not.toEqual(second.map((note) => note.pitch))
  })

  it("コード編集後は保存実音を使わず、その場で新しい音高へ追従する", () => {
    const before = applyAccompanimentPattern(sustainedRoot, [chord("C")], 2)
    const after = applyAccompanimentPattern(sustainedRoot, [chord("E")], 2)
    expect(before[0].pitch).toBe(48)
    expect(after[0].pitch).toBe(52)
  })

  it("メロディとのユニゾン・半音衝突を避け、伴奏を下の音域へ配置する", () => {
    const highRoot: AccompanimentPatternTemplate = {
      id: "high-root",
      name: "High Root",
      lengthBeats: 1,
      events: [{ offsetBeats: 0, durationBeats: 1, degree: 1, octaveOffset: 2, velocity: 76 }],
    }
    const notes = applyAccompanimentPattern(highRoot, [chord("C")], 1, {
      melodyNotes: [melody(61)],
    })
    const pitchClassDistance = Math.min(
      Math.abs(notes[0].pitch - 61) % 12,
      12 - (Math.abs(notes[0].pitch - 61) % 12),
    )

    expect(notes[0].pitch).toBeLessThanOrEqual(56)
    expect(pitchClassDistance).toBeGreaterThan(1)
  })

  it("メロディ発音中は伴奏を弱くし、上部テンションの同時アタックを間引く", () => {
    const pattern: AccompanimentPatternTemplate = {
      id: "melody-aware-density",
      name: "Melody Aware Density",
      lengthBeats: 2,
      events: [
        { offsetBeats: 0, durationBeats: 1, degree: 1, octaveOffset: 1, velocity: 76 },
        { offsetBeats: 0, durationBeats: 1, degree: 9, octaveOffset: 1, velocity: 68 },
      ],
    }
    const withoutMelody = applyAccompanimentPattern(pattern, [chord("C")], 2)
    const withMelody = applyAccompanimentPattern(pattern, [chord("C")], 2, {
      melodyNotes: [melody(72)],
    })

    expect(withMelody).toHaveLength(1)
    expect(withMelody[0].velocity).toBeLessThan(withoutMelody[0].velocity)
  })

  it("和音開始の声部が衝突回避によって同じ音へ潰れない", () => {
    const pattern = createDefaultAccompanimentPatterns().find((candidate) => candidate.id === "chord-entry")!
    const notes = applyAccompanimentPattern(pattern, [chord("C")], 4, {
      melodyNotes: [melody(64, 0, 1.5)],
    })
    const openingChord = notes.filter((note) => note.startBeat === 0).map((note) => note.pitch)

    expect(new Set(openingChord).size).toBe(3)
    expect(openingChord).toEqual([...openingChord].sort((a, b) => a - b))
  })

  it("4周期の強弱アークとフレーズ末尾の呼吸を決定論的に生成する", () => {
    const pattern = createDefaultAccompanimentPatterns().find((candidate) => candidate.id === "arpeggio-up")!
    const first = applyAccompanimentPattern(pattern, [chord("C", 0, 16)], 16)
    const second = applyAccompanimentPattern(pattern, [chord("C", 0, 16)], 16)
    const downbeats = first.filter((note) => note.startBeat % 4 === 0)

    expect(first).toEqual(second)
    expect(first).toHaveLength(15)
    expect(new Set(downbeats.map((note) => note.velocity)).size).toBeGreaterThanOrEqual(3)
    expect(first.find((note) => note.startBeat === 3)?.pitch).not.toBe(
      first.find((note) => note.startBeat === 7)?.pitch,
    )
    expect(first.some((note) => note.startBeat === 15)).toBe(false)
  })

  it("メジャーコードの回避音11thは安全な色彩音へ替え、マイナーでは保持する", () => {
    const pattern = createDefaultAccompanimentPatterns().find((candidate) => candidate.id === "arpeggio-six")!
    const major = applyAccompanimentPattern(pattern, [chord("C")], 4)
    const minor = applyAccompanimentPattern(pattern, [chord("Cm")], 4)
    const finalMajorPitchClass = major.at(-1)!.pitch % 12
    const finalMinorPitchClass = minor.at(-1)!.pitch % 12

    expect(finalMajorPitchClass).toBe(9)
    expect(finalMinorPitchClass).toBe(5)
  })

  it("初期テンプレートはIDが一意で、全イベントが周期内に収まる", () => {
    const patterns = createDefaultAccompanimentPatterns()
    expect(new Set(patterns.map((pattern) => pattern.id)).size).toBe(patterns.length)
    for (const pattern of patterns) {
      expect(pattern.lengthBeats).toBeGreaterThan(0)
      for (const event of pattern.events) {
        expect(event.offsetBeats).toBeGreaterThanOrEqual(0)
        expect(event.offsetBeats).toBeLessThan(pattern.lengthBeats)
        expect(event.durationBeats).toBeGreaterThan(0)
      }
    }
  })

  it("和音開始・5音・6音アルペジオを標準テンプレートとして提供する", () => {
    const patterns = createDefaultAccompanimentPatterns()
    const chordEntry = patterns.find((pattern) => pattern.id === "chord-entry")!
    const fiveNotes = patterns.find((pattern) => pattern.id === "arpeggio-five")!
    const sixNotes = patterns.find((pattern) => pattern.id === "arpeggio-six")!

    expect(chordEntry.events.filter((event) => event.offsetBeats === 0).map((event) => event.degree)).toEqual([
      1, 3, 5,
    ])
    expect(new Set(fiveNotes.events.map((event) => event.offsetBeats)).size).toBe(5)
    expect(fiveNotes.events.map((event) => event.degree)).toEqual([1, 3, 5, 7, 9])
    expect(new Set(sixNotes.events.map((event) => event.offsetBeats)).size).toBe(6)
    expect(sixNotes.events.map((event) => event.degree)).toEqual([1, 3, 5, 7, 9, 11])
  })

  it("保存済みProjectへ不足している新しい標準テンプレートを補完する", () => {
    const project = createEmptyProject("legacy-patterns")
    project.accompanimentPatterns = project.accompanimentPatterns.filter(
      (pattern) => !["chord-entry", "arpeggio-five", "arpeggio-six"].includes(pattern.id),
    )

    const restored = normalizeProject(JSON.parse(JSON.stringify(project)))
    expect(restored.accompanimentPatterns.map((pattern) => pattern.id)).toEqual(
      expect.arrayContaining(["chord-entry", "arpeggio-five", "arpeggio-six"]),
    )
  })

  it("Project JSONのテンプレートとセクション割り当てを正規化後も保持する", () => {
    const project = createEmptyProject("pattern")
    project.sections = [{ id: "s", name: "A", role: "verse", startBar: 1, lengthBars: 4 }]
    project.sectionAccompanimentPatternAssignments = { s: "syncopated" }

    const restored = normalizeProject(JSON.parse(JSON.stringify(project)))
    expect(restored.accompanimentPatterns).toEqual(project.accompanimentPatterns)
    expect(restored.sectionAccompanimentPatternAssignments).toEqual({ s: "syncopated" })
  })

  it("AI PartnerのPerformance Planを動的伴奏の試聴・MIDI材料へ反映する", () => {
    const project = createEmptyProject("performance")
    project.sections = [{ id: "s", name: "A", role: "verse", startBar: 1, lengthBars: 1 }]
    project.chords = [chord("C", 0, 4)]
    project.accompanimentPatterns = [...project.accompanimentPatterns, sustainedRoot]
    project.sectionAccompanimentPatternAssignments = { s: sustainedRoot.id }
    const original = accompanimentPatternNotesForSection(project, "s")
    project.sectionPerformancePlans = {
      s: {
        "pulse-foundation": {
          role: "pulse-foundation",
          velocityRange: [42, 58],
          articulation: "detached",
          timing: "strict",
        },
      },
    }
    const performed = accompanimentPatternNotesForSection(project, "s")

    expect(performed.map((note) => note.pitch)).toEqual(original.map((note) => note.pitch))
    expect(performed[0].durationBeats).toBeLessThan(original[0].durationBeats)
    expect(performed[0].velocity).toBeGreaterThanOrEqual(42)
    expect(performed[0].velocity).toBeLessThanOrEqual(58)
    expect(normalizeProject(JSON.parse(JSON.stringify(project))).sectionPerformancePlans)
      .toEqual(project.sectionPerformancePlans)
  })
})
