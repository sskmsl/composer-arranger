import { describe, expect, it } from "vitest"
import type { MelodyNote } from "@/core/melody"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { judgeCoreMotif, rhythmicHookQuality } from "./hookFirst"
import { subtleHookVariation } from "./hookDevelopment"

function notes(pitches: number[], starts: number[], durations: number[]): MelodyNote[] {
  return pitches.map((pitch, index) => ({
    id: `n${index}`, pitch, startBeat: starts[index], durationBeats: durations[index],
    velocity: 80, locks: [],
  }))
}

describe("Hook-first Melody Generator", () => {
  it("少ない音数だけをHookとせず、歌唱可能な輪郭とリズムの識別性を別々に評価する", () => {
    const flat = judgeCoreMotif(notes([64, 64, 64], [0, 1, 2], [1, 1, 1]), 4)
    const shaped = judgeCoreMotif(notes([64, 64, 67, 65], [.5, 1, 2.5, 3], [.5, 1, .5, .5]), 4)
    expect(shaped.rhythmicIdentity).toBeGreaterThan(flat.rhythmicIdentity)
    expect(shaped.hookability).toBeGreaterThan(flat.hookability)
    expect(shaped.humability).toBeGreaterThan(flat.humability)
  })

  it("変形では核の頭を維持し、末尾1音または小さな休符だけを変える", () => {
    const source = {
      pitches: [64, 64, 67, 65], lengthBeats: 4,
      events: [0, .5, 1.5, 2.5].map((offsetBeats, index) => ({
        offsetBeats, durationBeats: index === 1 ? 1 : .5, isRest: false,
      })),
    }
    const tail = subtleHookVariation(source, "tail")
    const breath = subtleHookVariation(source, "breath")
    expect(tail.pitches.slice(0, -1)).toEqual(source.pitches.slice(0, -1))
    expect(tail.pitches.at(-1)).not.toBe(source.pitches.at(-1))
    expect(breath.pitches).toHaveLength(3)
    expect(source.events.every((event) => !event.isRest)).toBe(true)
  })

  it("サビは短い核を選んで展開し、理論評価と別に記憶性・残存を記録する", () => {
    const chords = ["Am(add9)", "Fmaj7", "Cmaj7", "E7", "Am(add9)", "Fmaj7", "Dm9", "E7"]
      .map((symbol, i) => ({ id: `c${i}`, sectionId: "s", startBeat: i * 4, durationBeats: 4, symbol, bass: null }))
    const result = generateFromChordsWithProfiles({
      chords, sectionId: "s", sectionRole: "chorus", songProfile: "dark-romantic",
      density: "balanced", range: { low: 60, high: 77 }, drama: "growing",
      totalBeats: 32, seed: 7, profiles: ["standard"], key: "Am",
    })
    expect(result.candidates).toHaveLength(3)
    for (const candidate of result.candidates) {
      expect(candidate.coreHumability).toBeGreaterThan(.6)
      expect(candidate.coreHookability).toBeGreaterThan(.6)
      expect(candidate.coreRetention).toBeGreaterThan(.5)
      expect(candidate.notes.every((note) => note.pitch >= 60 && note.pitch <= 77)).toBe(true)
    }
    expect(result.diagnostics.filter((item) => item.selected).every((item) =>
      item.qualityScore >= 45 && (item.coreHookability ?? 0) > .6,
    )).toBe(true)
  })
})

/**
 * リズムの覚えやすさの対照(Codex のレビュー、PR #173)。作曲者とCodexのブラインド比較(サビ8組)で使った核のリズム。
 * 音高は結果に関係しないので、すべて同じ高さにしている。[開始拍, 長さ]
 */
describe("リズムの覚えやすさは、種類の多さではなく短い単位のくり返しで測る", () => {
  const core = (rhythm: [number, number][]): MelodyNote[] =>
    rhythm.map(([startBeat, durationBeats], index) => ({ id: `r${index}`, startBeat, durationBeats, pitch: 64, velocity: 80, locks: [] }))
  // 1拍・2拍の組が2回くり返される(Codex の対照「単純なリズムをくり返しで明確にする」)
  const repeatedCell = core([[0, 1], [1, 2], [3.5, 1], [4.5, 2]])
  // 種類は多いが、くり返す単位が見えない(対照「種類数では高いが短い単位が分からない」)
  const oneOffs = core([[0, 2], [2, 1], [3, 1], [5.5, 0.5], [6, 2]])
  it("くり返す単位のある核は、種類の多い核より高い(種類数の指標では逆になる)", () => {
    expect(rhythmicHookQuality(repeatedCell)).toBeGreaterThan(rhythmicHookQuality(oneOffs))
    expect(judgeCoreMotif(repeatedCell, 8).rhythmicIdentity).toBeLessThan(judgeCoreMotif(oneOffs, 8).rhythmicIdentity)
  })
  it("同じ音数で種類数も近くても、拍の頭と弱起で錨を下ろした核は、裏拍の入りが続く核より高い", () => {
    const anchored = core([[1, 1], [2, 2], [4, 1.5], [5.5, 0.5], [6, 1]])
    const offbeat = core([[0, 2], [2.5, 1.5], [4.5, 1], [5.5, 1], [6.5, 0.5]])
    expect(rhythmicHookQuality(anchored)).toBeGreaterThan(rhythmicHookQuality(offbeat))
  })
  it("3音だけの骨組みより、くり返しのある5音の核が高い", () => {
    const skeletal = core([[1, 1], [2, 2], [4, 2]])
    const fuller = core([[1, 1], [2, 2], [4, 1], [5, 2], [7.5, 0.5]])
    expect(rhythmicHookQuality(fuller)).toBeGreaterThan(rhythmicHookQuality(skeletal))
  })
  it("ブラインド比較の8組で、Codex が選んだ側を高くする", () => {
    const pairs: [[number, number][], [number, number][]][] = [
      [[[0, 1], [1, .5], [1.5, .5], [4, 1], [5, .5], [5.5, .5], [6, 1], [7, .5], [7.5, .5]], [[0, 2], [2, 1], [3, 1], [4, .5], [4.5, 1], [6, 2]]],
      [[[0, 1.5], [1.5, 1], [2.5, 2], [4.5, 1.25], [6, 1.5], [7.5, 1]], [[1, 1], [2, 2], [4, 2]]],
      [[[1, 1], [2, 1], [3, 1.5], [4.5, 1], [5.5, 1]], [[0, 2], [2, 1], [3, 1], [5.5, .5], [6, 2]]],
      [[[.5, 1], [1.5, 2], [3.5, .5], [4, 1], [5, 2], [7, .5], [7.5, .5]], [[1, 1], [2, 2], [4, 1], [5, 1]]],
      [[[0, 1], [1, 2], [3.5, 1], [4.5, 2]], [[0, 2], [2, 1], [3, 1], [5.5, .5], [6, 2]]],
      [[[1, 1], [2, 2], [4, 1.5], [5.5, .5], [6, 1]], [[0, 2], [2.5, 1.5], [4.5, 1], [5.5, 1], [6.5, .5]]],
      [[[0, 1], [1, 2], [3.5, 1], [4.5, 2]], [[1, .5], [1.5, 1], [2.5, 1.5], [4, 1], [5, .75], [6, .5], [6.5, 1], [7.5, 1.5]]],
      [[[1, 1], [2, 2], [4, 1], [5, 2], [7.5, .5]], [[1, 1], [2, 2], [4, 2]]],
    ]
    for (const [preferred, other] of pairs) expect(rhythmicHookQuality(core(preferred))).toBeGreaterThan(rhythmicHookQuality(core(other)))
  })
})

