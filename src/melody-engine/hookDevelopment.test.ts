import { describe, expect, it } from "vitest"
import { answerHook, climaxHook, developHook, hookPhraseRole, restoreHookHeads, returningHook, shiftInScale } from "./hookDevelopment"
import { buildHarmonicMap } from "./harmonicMap"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import type { MotifCore } from "./motifCore"

const source: MotifCore = {
  pitches: [60, 64, 62, 67], lengthBeats: 4,
  events: [0.5, 0.5, 1, 2].map((durationBeats, i) => ({ offsetBeats: [0, 0.5, 1, 2][i], durationBeats, isRest: false })),
}

describe("planned hook development", () => {
  it("develops the hook (small variation, then development) and returns it, including abbreviated sections", () => {
    expect(Array.from({ length: 4 }, (_, i) => hookPhraseRole(i, 4))).toEqual(["statement", "answer", "develop", "return"])
    // 16小節: 提示と小変形を二度聴かせ、一段高い再提示から二段上の頂点(Verse は6割弱の位置)、頂点の後は余韻
    expect(Array.from({ length: 8 }, (_, i) => hookPhraseRole(i, 8))).toEqual(
      ["statement", "answer", "return", "answer", "rise", "climax", "answer", "return"])
    expect(Array.from({ length: 3 }, (_, i) => hookPhraseRole(i, 3))).toEqual(["statement", "answer", "return"])
    expect(Array.from({ length: 2 }, (_, i) => hookPhraseRole(i, 2))).toEqual(["statement", "answer"])
    expect(hookPhraseRole(0, 1)).toBeUndefined()
  })
  it("repeats both ideas in longer choruses while preserving other section roles", () => {
    expect(Array.from({ length: 4 }, (_, i) => hookPhraseRole(i, 4, "standard", "chorus")))
      .toEqual(["statement", "answer", "contrast", "contrast-answer"])
    expect(Array.from({ length: 8 }, (_, i) => hookPhraseRole(i, 8, "cinematic", "grand-chorus")))
      .toEqual(["statement", "answer", "return", "answer", "contrast", "contrast-answer", "contrast-return", "contrast-answer"])
    expect(Array.from({ length: 3 }, (_, i) => hookPhraseRole(i, 3, "standard", "chorus")))
      .toEqual(["statement", "answer", "return"])
    expect(Array.from({ length: 4 }, (_, i) => hookPhraseRole(i, 4, "standard", "verse")))
      .toEqual(["statement", "answer", "develop", "return"])
  })
  it("develops with the rhythm kept and restates it higher without new material", () => {
    const scale = [0, 2, 4, 5, 7, 9, 11]
    const developed = developHook(source, scale)
    expect(developed.events.map((event) => event.offsetBeats)).toEqual(source.events.map((event) => event.offsetBeats))
    expect(developed.pitches.slice(0, 3)).toEqual(source.pitches.slice(0, 3))
    expect(developed.pitches[3]).toBeGreaterThan(source.pitches[3])
    const climax = climaxHook(source, scale)
    expect(climax.events).toEqual(source.events)
    expect(climax.pitches).toEqual([64, 67, 65, 71])
    expect(climaxHook(source, scale, 1).pitches).toEqual([62, 65, 64, 69])
    expect(shiftInScale(71, 1, scale)).toBe(72)
  })
  it("restores the hook head moved by later polishing, only where its rhythm is still the same", () => {
    const map = buildHarmonicMap([
      { id: "a", sectionId: "s", startBeat: 0, durationBeats: 8, symbol: "C", bass: null },
      { id: "b", sectionId: "s", startBeat: 8, durationBeats: 8, symbol: "C", bass: null },
    ])
    const note = (startBeat: number, pitch: number, durationBeats = 1) => ({ id: `${startBeat}`, startBeat, durationBeats, pitch, velocity: 80, locks: [] })
    const first = [note(0, 60), note(1, 64), note(2, 67), note(3, 64, 2)]
    const changed = [note(8, 60), note(9, 62), note(10, 67), note(11, 64, 2)]
    const plan = { coreLengthBeats: 4, phrases: [{ startBeat: 0, lengthBeats: 8, role: "statement" as const }, { startBeat: 8, lengthBeats: 8, role: "return" as const }] }
    const restored = restoreHookHeads([...first, ...changed], plan, map, { low: 55, high: 79 }, [0, 2, 4, 5, 7, 9, 11])
    expect(restored.filter((n) => n.startBeat >= 8).slice(0, 2).map((n) => n.pitch)).toEqual([60, 64])
    // 対照側や、頭のリズムが違うフレーズには触らない
    const contrastPlan = { ...plan, phrases: [plan.phrases[0], { ...plan.phrases[1], role: "contrast" as const }] }
    expect(restoreHookHeads([...first, ...changed], contrastPlan, map, { low: 55, high: 79 }).map((n) => n.pitch)).toEqual([...first, ...changed].map((n) => n.pitch))
  })
  it("preserves the defining head and rhythm while varying the answer without mutating the source", () => {
    const original = structuredClone(source)
    const answer = answerHook(source)
    expect(answer.pitches.slice(0, -1)).toEqual(source.pitches.slice(0, -1))
    expect(answer.pitches.at(-1)).not.toBe(source.pitches.at(-1))
    expect(answer.events).toEqual(source.events)
    answer.events[0].durationBeats = 8
    expect(source).toEqual(original)
    expect(answerHook({ ...source, pitches: [60, 64] }).pitches).toEqual([60, 64])
  })
  it("does not repeat the opening wait but preserves the internal rhythm and rests", () => {
    const pickup = { ...source, lengthBeats: 6, events: [
      { offsetBeats: 0, durationBeats: 2, isRest: true },
      ...source.events.map(event => ({ ...event, offsetBeats: event.offsetBeats + 2 })),
    ] }
    expect(returningHook(pickup)).toEqual(source)
    expect(pickup.events[0].isRest).toBe(true)
  })
  it("leaves specialized profile grammars in control", () => {
    for (const profile of ["minimal", "leaping", "rhythmic", "chromatic", "elegiac-cantabile", "speech-rhythmic", "incantatory"] as const) {
      expect(hookPhraseRole(3, 4, profile)).toBeUndefined()
    }
    expect(hookPhraseRole(3, 4, "cinematic")).toBe("return")
  })
  it("keeps final melodies bounded and repeatable through changing harmony", () => {
    const input = {
      chords: ["Am", "F", "C", "G", "Dm", "E7", "Am", "Am"].map((symbol, i) => ({ id: `${i}`, sectionId: "s", startBeat: i * 4, durationBeats: 4, symbol, bass: null })),
      sectionId: "s", sectionRole: "chorus" as const, songProfile: "original-custom" as const,
      density: "balanced" as const, range: { low: 60, high: 77 }, drama: "growing" as const,
      totalBeats: 32, seed: 7, profiles: ["standard" as const],
    }
    const first = generateFromChordsWithProfiles(input).candidates
    const again = generateFromChordsWithProfiles(input).candidates
    expect(first).toHaveLength(3)
    const sounding = (candidates: typeof first) => candidates.map(c => c.notes.map(n => [n.pitch, n.startBeat, n.durationBeats]))
    expect(sounding(first)).toEqual(sounding(again))
    for (const candidate of first) {
      expect(candidate.notes.length).toBeGreaterThan(0)
      for (const note of candidate.notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(60)
        expect(note.pitch).toBeLessThanOrEqual(77)
        expect(note.startBeat).toBeGreaterThanOrEqual(0)
        expect(note.startBeat + note.durationBeats).toBeLessThanOrEqual(32)
      }
    }
  })
  it("brings back the contrasting chorus head on a later phrase", () => {
    const chords = ["Am", "F", "C", "G", "Am", "F", "C", "G"].map((symbol, i) => ({
      id: `c${i}`, sectionId: "s", startBeat: i * 4, durationBeats: 4, symbol, bass: null,
    }))
    const candidates = generateFromChordsWithProfiles({
      chords, sectionId: "s", sectionRole: "chorus", songProfile: "original-custom",
      density: "balanced", range: { low: 60, high: 77 }, drama: "growing",
      totalBeats: 32, seed: 7, profiles: ["standard"],
    }).candidates
    const head = (notes: typeof candidates[number]["notes"], start: number, length: number) => {
      const phrase = notes.filter(n => n.startBeat >= start && n.startBeat < start + length).slice(0, 3)
      return phrase.length < 3 ? [] : phrase.map(n => [n.startBeat - phrase[0].startBeat, n.durationBeats])
    }
    const hasDistinctRepeatedContrast = candidates.some(candidate => {
      const plans = candidate.plans
      if (plans.length < 4) return false
      const contrastIndex = Math.floor(plans.length / 2)
      const first = head(candidate.notes, plans[0].phraseStartBeat, plans[0].phraseLengthBeats)
      const contrast = head(candidate.notes, plans[contrastIndex].phraseStartBeat, plans[contrastIndex].phraseLengthBeats)
      const contrastAnswer = head(candidate.notes, plans[contrastIndex + 1].phraseStartBeat, plans[contrastIndex + 1].phraseLengthBeats)
      return contrast.length === 3 && JSON.stringify(first) !== JSON.stringify(contrast) &&
        JSON.stringify(contrast) === JSON.stringify(contrastAnswer)
    })
    expect(hasDistinctRepeatedContrast).toBe(true)
  })
})
