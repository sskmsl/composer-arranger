import { describe, expect, it } from "vitest"
import { MAX_BLEND, applyReferenceArc, parseReferenceProfile, resolveReferenceInfluence, type ReferenceProfile } from "./referenceProfile"
import { createEmptyProject, normalizeProject } from "./project"

const profile = (id: string, value: number): ReferenceProfile => parseReferenceProfile({
  version: 1, id, label: id,
  source: { kind: "audio", durationSeconds: 100, tempoBpm: 120 },
  melody: { motifLength: value, repetition: value, noteDensity: value, restDensity: value, rhythmicIdentity: value, registerExpansion: value, climaxTiming: value },
  harmony: { harmonicRhythm: value, tension: value, resolutionStrength: value, bassMovement: value, modalTendency: value },
  rhythm: { density: value, syncopation: value, grooveTendency: value },
  arrangement: { foregroundDensity: value, backgroundSustain: value, phraseFrequency: value, sectionContrast: value, registerBalance: value },
  aesthetic: { depth: value, decay: value, transientSoftness: value, stereoDiffusion: value, darkLuminousBalance: value, textureDensity: value },
  emotion: { restraint: value, tensionCurve: [0, .2, .4, .6, .8, 1, .8, .6], climaxTiming: value, release: value, afterglow: value },
  confidence: {},
})

describe("Reference Profile", () => {
  it("数値の特徴だけを受け付け、音列・コード・音型を含むものは拒否する", () => {
    expect(profile("a", .7).melody.noteDensity).toBe(.7)
    for (const key of ["notes", "chords", "progression", "riff", "pattern", "pitches"]) {
      expect(() => parseReferenceProfile({ ...profile("a", .5), extra: { [key]: [1, 2, 3] } })).toThrow()
    }
    expect(() => parseReferenceProfile({ ...profile("a", .5), version: 2 })).toThrow()
    // 範囲外は 0〜1 に収める
    expect(parseReferenceProfile({ ...profile("a", .5), rhythm: { density: 3, syncopation: -1, grooveTendency: .5 } }).rhythm)
      .toEqual({ density: 1, syncopation: 0, grooveTendency: .5 })
  })

  it("複数の参考曲を用途ごとに別々に使い、同じ用途では特徴の値を重み付きで合わせる", () => {
    const resolved = resolveReferenceInfluence([profile("a", .2), profile("b", .8), profile("c", 1)], [
      { profileId: "a", targets: { melody: "high", rhythm: .3 } },
      { profileId: "b", targets: { rhythm: .1 } },
      { profileId: "c", targets: { aesthetic: "moderate" } },
    ])!
    expect(resolved.melody?.traits.noteDensity).toBeCloseTo(.2)
    expect(resolved.rhythm?.traits.density).toBeCloseTo((.2 * .3 + .8 * .1) / .4)
    expect(resolved.rhythm?.strength).toBeCloseTo(.4)
    expect(resolved.aesthetic?.traits.depth).toBe(1)
    expect(resolved.harmony).toBeUndefined()
    // 重ねても上限を超えない
    const stacked = resolveReferenceInfluence([profile("a", .2), profile("b", .8)], [
      { profileId: "a", targets: { bass: "high" } }, { profileId: "b", targets: { bass: "high" } },
    ])!
    expect(stacked.bass?.strength).toBe(MAX_BLEND)
    expect(resolveReferenceInfluence([profile("a", .2)], [{ profileId: "a", targets: {} }])).toBeNull()
  })

  it("確からしさが低い特徴は弱く効く", () => {
    const unsure = { ...profile("a", .9), confidence: { melody: .5 } }
    expect(resolveReferenceInfluence([unsure], [{ profileId: "a", targets: { melody: "high" } }])?.melody?.strength).toBeCloseTo(.3)
  })

  it("感情の弧は役割から決めたエネルギーを最大12だけ寄せる", () => {
    const arc = { traits: profile("a", .5).emotion, strength: .6 }
    expect(applyReferenceArc(50, 0, true, undefined)).toBe(50)
    expect(Math.abs(applyReferenceArc(90, 0, true, arc) - 90)).toBeLessThanOrEqual(12)
    expect(applyReferenceArc(30, .7, true, arc)).toBeGreaterThan(30)
  })

  it("保存した曲を開き直しても、特徴だけが残る", () => {
    const project = createEmptyProject("t")
    const raw = JSON.parse(JSON.stringify({
      ...project,
      song: { ...project.song, referenceProfiles: [profile("a", .4), { ...profile("b", .4), notes: [60] }], referenceInfluences: [{ profileId: "a", targets: { melody: "low" } }] },
    }))
    const restored = normalizeProject(raw)
    expect(restored.song.referenceProfiles?.map((item) => item.id)).toEqual(["a"])
    expect(restored.song.referenceInfluences).toEqual([{ profileId: "a", targets: { melody: "low" } }])
  })
})
