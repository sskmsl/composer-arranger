import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { AiArrangementIntent } from "./types"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import {
  directionAuditionDirectiveForIntent,
  directionAuditionRanges,
  directionAuditionSeed,
  directionAuditionTracks,
} from "./directionAudition"

function testIntent(
  id: string,
  generator: AiArrangementIntent["generator"],
  overrides: Partial<AiArrangementIntent> = {},
): AiArrangementIntent {
  return {
    id,
    title: id,
    generator,
    emotionalFunction: "曲の流れを変える",
    density: "balanced",
    register: "middle",
    drama: "growing",
    motion: "wave",
    rhythmCharacter: "flowing",
    silenceStrategy: "breathing",
    creativeRisk: "focused",
    lengthBars: 4,
    techniques: [],
    soundPalette: "synth",
    performanceDirection: "必要な場所だけ鳴らす",
    why: "違いを作る",
    generationBrief: "主旋律を残して別の役割を加える",
    soundSourceSuggestions: [],
    accompanimentPatternId: generator === "accompaniment" ? "pulse-root-fifth" : "none",
    rhythmPlan: {
      enabled: false,
      subdivision: "eighth",
      feel: "straight",
      kickPattern: "",
      snarePattern: "",
      hatPattern: "",
      percussionPattern: "",
      variation: "",
      bars: 1,
      events: [],
    },
    ...overrides,
  }
}

function arrangement(totalBeats: number, peakSectionId: string | null): FullSongArrangement {
  return {
    version: "1.0.0",
    id: "preview",
    createdAt: "2026-01-01T00:00:00.000Z",
    analysis: {
      version: "1.0.0",
      bpm: 120,
      key: "Am",
      timeSignature: "4/4",
      totalBeats,
      peakSectionId,
      sections: [],
    },
    plan: { version: "1.0.0", brief: "", seed: 1, sections: [] },
    tracks: [],
  }
}

describe("Direction audition ranges", () => {
  it("同じ比較条件として冒頭と頂点Sectionを各4小節返す", () => {
    const project = createEmptyProject("Audition")
    project.sections = [
      { ...project.sections[0], id: "intro", name: "Intro", lengthBars: 8 },
      { ...project.sections[0], id: "chorus", name: "Chorus", startBar: 9, lengthBars: 8 },
    ]
    expect(directionAuditionRanges(project, arrangement(64, "chorus"))).toEqual([
      { startBeat: 0, endBeat: 16, label: "冒頭4小節" },
      { startBeat: 32, endBeat: 48, label: "Chorusの冒頭4小節" },
    ])
  })

  it("短い曲や冒頭が頂点の曲では同じ範囲を二度鳴らさない", () => {
    const project = createEmptyProject("Short")
    project.sections[0] = { ...project.sections[0], id: "peak", lengthBars: 4 }
    expect(directionAuditionRanges(project, arrangement(16, "peak"))).toHaveLength(1)
  })

  it("3案へ異なる再現可能なseedを割り当てる", () => {
    const project = createEmptyProject("Direction seed")
    const intent = {
      id: "direction",
      generator: "accompaniment",
      density: "balanced",
      register: "low",
      motion: "static",
      rhythmCharacter: "pulsed",
      silenceStrategy: "breathing",
      creativeRisk: "focused",
      generationBrief: "低音を短く鳴らす",
    } as AiArrangementIntent
    const seeds = [0, 1, 2].map((index) => directionAuditionSeed(project, "request", intent, index))
    expect(new Set(seeds).size).toBe(3)
    expect(directionAuditionSeed(project, "request", intent, 1)).toBe(seeds[1])
  })

  it("案固有の追加パートだけを試聴対象にする", () => {
    const tracks = [
      { id: "dr-kick", notes: [{ startBeat: 0 }] },
      { id: "syn-bass", notes: [{ startBeat: 0 }] },
      { id: "syn-dark-pad", notes: [{ startBeat: 0 }] },
    ] as FullSongArrangement["tracks"]
    expect(directionAuditionTracks(tracks, ["syn-bass"]).map((track) => track.id)).toEqual(["syn-bass"])
    expect(directionAuditionTracks(tracks, [])).toEqual([])
  })

  it("提案音がセクション末尾にある場合も、その音を含む範囲を返す", () => {
    const project = createEmptyProject("Focused audition")
    project.sections = [
      { ...project.sections[0], id: "intro", name: "Intro", lengthBars: 8 },
      { ...project.sections[0], id: "chorus", name: "Chorus", startBar: 9, lengthBars: 8 },
    ]
    const tracks = [{
      id: "syn-transition-phrase",
      name: "SYN_TransitionPhrase",
      family: "transition",
      muted: false,
      generationRevision: 0,
      purpose: "次へつなぐ",
      notes: [{
        id: "transition",
        sectionId: "intro",
        character: "safe",
        reason: "次へつなぐ",
        pitch: 72,
        startBeat: 30,
        durationBeats: 1,
        velocity: 70,
        locks: [],
      }],
    }] as FullSongArrangement["tracks"]
    const ranges = directionAuditionRanges(project, arrangement(64, "chorus"), tracks)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].startBeat).toBeLessThanOrEqual(30)
    expect(ranges[0].endBeat).toBeGreaterThan(30)
    expect(ranges[0].label).toContain("提案音")
  })

  it("代表的な3方向では実際に異なる音符列を試聴する", () => {
    const project = createEmptyProject("Three directions")
    project.sections = [
      { ...project.sections[0], id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
      { ...project.sections[0], id: "chorus", name: "Chorus", role: "chorus", startBar: 5, lengthBars: 4 },
    ]
    project.chords = project.sections.flatMap((section) => [
      { id: `${section.id}:1`, sectionId: section.id, startBeat: 0, durationBeats: 8, symbol: "Am(add9)", bass: null },
      { id: `${section.id}:2`, sectionId: section.id, startBeat: 8, durationBeats: 8, symbol: "Fmaj7", bass: null },
    ])
    const intents = [
      testIntent("bass", "accompaniment", { density: "balanced", register: "low", rhythmCharacter: "pulsed" }),
      testIntent("drums", "rhythm", { density: "active", rhythmCharacter: "syncopated" }),
      testIntent("mark", "signature", { density: "sparse", register: "high", creativeRisk: "bold" }),
    ]
    const signatures = intents.map((intent, index) => {
      const directive = directionAuditionDirectiveForIntent(intent)
      const arrangement = generateFullSongArrangement(project, {
        seed: directionAuditionSeed(project, "request", intent, index),
        brief: intent.generationBrief,
        directive,
      })
      const tracks = directionAuditionTracks(arrangement.tracks, directive.add ?? [])
      const ranges = directionAuditionRanges(project, arrangement, tracks)
      return tracks.flatMap((track) => track.notes
        .filter((note) => ranges.some((range) => note.startBeat < range.endBeat && note.startBeat + note.durationBeats > range.startBeat))
        .map((note) => `${track.id}:${note.startBeat}:${note.durationBeats}:${note.pitch}`))
        .join("|")
    })
    expect(signatures.every((signature) => signature.length > 0)).toBe(true)
    expect(new Set(signatures).size).toBe(3)
  })
})
