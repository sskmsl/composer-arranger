import { describe, expect, it } from "vitest"
import principles from "../melody-engine/reference/arrangementEmotionPrinciples.json"
import {
  EMOTIONAL_DIMENSIONS,
  EMOTIONAL_MEANS,
  EMOTIONAL_MECHANISMS,
  emotionalMeansById,
  emotionalRequestsFromText,
  intentionWithMeans,
  meansOfMechanism,
  mergeEmotionalRequests,
  recommendMeans,
} from "./emotionalMechanism"

describe("emotional mechanism vocabulary", () => {
  it("states what each mechanism does to the listener and how to see it in the sound", () => {
    expect(Object.keys(EMOTIONAL_DIMENSIONS).sort()).toEqual(["brightness", "density", "energy", "weight"])
    for (const mechanism of EMOTIONAL_MECHANISMS) {
      expect(mechanism.effect.length, mechanism.id).toBeGreaterThan(10)
      expect(mechanism.signature, mechanism.id).toMatch(/dB|小節/)
    }
  })

  it("reads each means from its own wording and from no other means' wording", () => {
    for (const means of EMOTIONAL_MEANS) {
      expect(means.phrase, means.id).not.toContain("。")
      const read = emotionalRequestsFromText(means.phrase)
      expect(read, `${means.id}: 自分の文言だけを読む`).toEqual([{ mechanism: means.mechanism, means: means.id }])
    }
  })

  it("reads several means from one free-text intention, and de-duplicates typed and written requests", () => {
    const text = ["主旋律を守る", ...EMOTIONAL_MEANS.map((means) => means.phrase)].join("。")
    expect(emotionalRequestsFromText(text).map((request) => request.means).sort()).toEqual(EMOTIONAL_MEANS.map((means) => means.id).sort())
    const merged = mergeEmotionalRequests(
      [{ mechanism: "closure-decay", means: "level-fade" }, { mechanism: "expectation-arrival" }],
      emotionalMeansById("level-fade").phrase,
    )
    expect(merged).toEqual([{ mechanism: "closure-decay", means: "level-fade" }, { mechanism: "expectation-arrival" }])
  })

  it("appends the chosen wording to an intention and leaves it alone when nothing is chosen", () => {
    expect(intentionWithMeans("主旋律を守る。", ["level-fade"])).toBe("主旋律を守る。終わりはフェードアウトで終える")
    expect(intentionWithMeans("主旋律を守る", [])).toBe("主旋律を守る")
  })

  it("keeps the observed counts equal to the reference summary, and leaves out what was not observed", () => {
    const counts = principles.meansObservedIn as Record<string, number>
    for (const means of EMOTIONAL_MEANS) {
      expect(means.observedIn, means.id).toBe(counts[means.id])
      expect(means.observedIn).toBeLessThanOrEqual(principles.recordings.count)
    }
    for (const id of Object.keys(principles.notObserved)) {
      expect(EMOTIONAL_MEANS.some((means) => means.id === id), `${id} は観察されていないので手段に入れない`).toBe(false)
    }
    for (const mechanism of EMOTIONAL_MECHANISMS) {
      const strongest = Math.max(0, ...meansOfMechanism(mechanism.id).map((means) => means.observedIn))
      const mechanismCount = (principles.mechanismObservedIn as Record<string, number>)[mechanism.id]
      expect(mechanismCount, `${mechanism.id}: 仕組みの本数は手段の最大以上`).toBeGreaterThanOrEqual(strongest)
    }
  })
})



describe("recommending the means a measured arrangement lacks", () => {
  it("recommends only well-observed means, and only for what the song can take", () => {
    const lacking = { "expectation-arrival": 0.1, "closure-decay": 0.0 }
    expect(recommendMeans(lacking, { hasIntro: true, endsInOutro: true }).map((item) => item.means)).toEqual(["bass-withheld", "level-fade"])
    expect(recommendMeans(lacking, { hasIntro: false, endsInOutro: false })).toEqual([])
    expect(recommendMeans({ "expectation-arrival": 0.9, "closure-decay": 0.9 }, { hasIntro: true, endsInOutro: true })).toEqual([])
    expect(recommendMeans(undefined, { hasIntro: true, endsInOutro: true })).toEqual([])
  })
})

describe("wording shown to the person using the app", () => {
  it("keeps development vocabulary (references, counts, dB, drafts, proxies) out of everything the screen shows", () => {
    const internal = /参照|観察|本中|dB|Draft|代理|seed|Technique|署名|artifact/i
    const shown = [
      ...EMOTIONAL_MECHANISMS.flatMap((mechanism) => [mechanism.label, mechanism.effect]),
      ...EMOTIONAL_MEANS.flatMap((means) => [means.label, means.description]),
      ...recommendMeans({ "expectation-arrival": 0, "closure-decay": 0 }, { hasIntro: true, endsInOutro: true }).map((item) => item.reason),
    ]
    for (const text of shown) expect(text, text).not.toMatch(internal)
  })
})
