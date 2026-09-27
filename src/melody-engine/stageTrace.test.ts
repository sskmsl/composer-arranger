import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote } from "@/core/melody"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { recordStage, traceStages, withStageContext } from "./stageTrace"

/** 音の id は生成のたびに乱数(randomUUID)で振られるので、比べるときは除く */
const withoutIds = (value: unknown) => JSON.stringify(value, (key, inner) => (key === "id" ? undefined : inner))

const note = (pitch: number): MelodyNote => ({ id: "n0", startBeat: 0, durationBeats: 1, pitch, velocity: 80, locks: [] })

describe("段階の記録", () => {
  it("記録していないときは何も残さず、文脈の関数はそのまま結果を返す", () => {
    expect(() => recordStage("unused", [note(60)])).not.toThrow()
    expect(withStageContext({ phase: "x" }, () => 42)).toBe(42)
  })

  it("記録は写しなので、後で音を書き換えても前の記録は変わらない", () => {
    const { records } = traceStages(() => {
      const notes = [note(60)]
      recordStage("before", notes)
      notes[0].pitch = 72
      recordStage("after", notes)
    })
    expect(records.map((record) => record.notes[0].pitch)).toEqual([60, 72])
  })

  it("文脈は入れ子で重なり、抜けると元に戻る", () => {
    const { records } = traceStages(() => {
      withStageContext({ poolIndex: 1 }, () => {
        withStageContext({ phase: "craft" }, () => recordStage("inner", []))
        recordStage("outer", [])
      })
      recordStage("top", [])
    })
    expect(records.map((record) => record.context)).toEqual([{ poolIndex: 1, phase: "craft" }, { poolIndex: 1 }, {}])
  })
})

describe("記録しても生成結果は変わらない(実験2の 03・05・07 の条件)", () => {
  const cases = [
    { key: "C", progression: "Dm7 G7 Cmaj7 Am7", seed: 7003 },
    { key: "Am", progression: "Am Dm Em Am", seed: 7005 },
    { key: "G", progression: "C G D Em", seed: 7007 },
  ]
  for (const { key, progression, seed } of cases) for (const style of ["varied", "plain"] as const) {
    it(`${progression} / ${style}`, () => {
      const bars = progression.split(" ")
      const chords = parseChordInputText([...bars, ...bars].join(" | "), "s1", 4, "c")
      const run = () => generateFromChordsWithProfiles({
        chords, sectionId: "s1", sectionRole: "chorus", songProfile: "dark-romantic", density: "balanced",
        range: RANGE_PRESETS.middle, drama: "growing", totalBeats: 32, seed, profiles: ["standard"], key, coreRhythmOverride: style,
      })
      const plain = run()
      const traced = traceStages(run)
      // 候補プール・順位・最終の音・診断がすべて同じ(音の id を除く)
      expect(withoutIds(traced.result)).toBe(withoutIds(plain))
      // 最後に出した音は、その候補の "output" の記録と同じ
      traced.result.candidates.forEach((candidate) => {
        const output = traced.records.filter((record) => record.stage === "output" && record.context.patternIndex === candidate.patternIndex)
        expect(output).toHaveLength(1)
        expect(output[0].notes).toEqual(candidate.notes.map(({ id, startBeat, durationBeats, pitch }) => ({ id, startBeat, durationBeats, pitch })))
      })
    })
  }
})
