import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote } from "@/core/melody"
import { buildHarmonicMap } from "./harmonicMap"
import { applyMelodicCraft } from "./melodicCraft"
import { measureMelodyCraft } from "./melodyCraftMetrics"

const chords = parseChordInputText("C | F | G | C", "s1", 4, "c")
const base = { harmonicMap: buildHarmonicMap(chords), range: { low: 55, high: 79 }, totalBeats: 16, key: "C" }

function n(startBeat: number, pitch: number, durationBeats = 1, extra: Partial<MelodyNote> = {}): MelodyNote {
  return { id: `${startBeat}`, startBeat, durationBeats, pitch, velocity: 90, locks: [], plannedToneRole: "chord-tone", ...extra }
}

describe("主旋律の仕上げ", () => {
  it("同じ音の3連打は、間の音を動かしてほどく", () => {
    // 2小節目(F)で A4 を4回続ける
    const notes = [n(0, 64), n(1, 67), n(2, 72), n(3, 67), n(4, 69), n(5, 69), n(6, 69), n(7, 69), n(8, 71), n(12, 72, 4)]
    const crafted = applyMelodicCraft(notes, { ...base, sectionRole: "verse", profile: "standard" })
    const bar2 = crafted.filter((note) => note.startBeat >= 4 && note.startBeat < 8).map((note) => note.pitch)
    expect(new Set(bar2).size).toBeGreaterThan(1)
  })

  it("5半音以上跳んだら、次の音は逆向きへ戻る", () => {
    // G4 → E5(9半音上) → G5 とさらに上へ行く所を、E5 から下へ戻す
    const notes = [n(0, 64), n(1, 67), n(2, 67), n(3, 64), n(4, 65), n(5, 69), n(6, 72), n(7, 69), n(8, 67), n(9, 76), n(10, 79), n(12, 72, 4)]
    const crafted = applyMelodicCraft(notes, { ...base, sectionRole: "verse", profile: "standard" })
    const at = (beat: number) => crafted.find((note) => note.startBeat === beat)!.pitch
    expect(at(10)).toBeLessThan(at(9))
    expect(at(9) - at(10)).toBeLessThanOrEqual(3)
  })

  it("サビは主音で、少し伸ばして終わる", () => {
    const notes = [n(0, 67), n(1, 69), n(2, 72), n(4, 72), n(6, 69), n(8, 71), n(10, 74), n(12, 67), n(13, 64, 0.5)]
    const crafted = applyMelodicCraft(notes, { ...base, sectionRole: "chorus", profile: "standard" })
    const last = crafted.at(-1)!
    expect(last.pitch % 12).toBe(0)
    expect(last.durationBeats).toBeGreaterThanOrEqual(1.5)
  })

  it("作り方が表情として置いた音(掛留など)とその解決先には触らない", () => {
    const suspension = n(9, 72, 1, { plannedToneRole: "suspension", plannedResolution: { targetPitchClass: 11, targetBeat: 10, maximumDelayBeats: 1 } })
    const resolution = n(10, 71)
    const notes = [n(0, 64), n(1, 64), n(2, 64), n(3, 64), n(4, 65), n(8, 72), suspension, resolution, n(12, 72, 4)]
    const crafted = applyMelodicCraft(notes, { ...base, sectionRole: "verse", profile: "standard" })
    expect(crafted.find((note) => note.startBeat === 9)!.pitch).toBe(72)
    expect(crafted.find((note) => note.startBeat === 10)!.pitch).toBe(71)
  })

  it("語りの作り方(speech-rhythmic)の連打や、選んだ音域の外へは動かさない", () => {
    const notes = [n(4, 69), n(5, 69), n(6, 69), n(7, 69), n(12, 72, 4)]
    const crafted = applyMelodicCraft(notes, { ...base, sectionRole: "verse", profile: "speech-rhythmic" })
    expect(crafted.slice(0, 4).map((note) => note.pitch)).toEqual([69, 69, 69, 69])
    const narrow = applyMelodicCraft([n(0, 60), n(1, 67), n(2, 67), n(3, 67), n(4, 65), n(12, 64, 4)], { ...base, range: { low: 60, high: 67 }, sectionRole: "chorus", profile: "standard" })
    expect(narrow.every((note) => note.pitch >= 60 && note.pitch <= 67)).toBe(true)
  })

  describe("旋律の基本原理", () => {
    const at = (notes: MelodyNote[], beat: number) => notes.find((note) => note.startBeat === beat)!.pitch

    it("拍頭で旋律とベースが同じ向きに動いて5度が続く所(平行5度)をほどく", () => {
      // C上のG(5度) → F上のC(5度)。旋律もベースも上がる
      const notes = [n(0, 64, 2), n(2, 67, 2), n(4, 72, 2), n(6, 69, 2), n(8, 71, 2), n(10, 74, 2), n(12, 72, 4)]
      const crafted = applyMelodicCraft(notes, { ...base, sectionRole: "bridge", profile: "minimal" })
      expect(at(crafted, 4)).not.toBe(72)
      expect(measureMelodyCraft(crafted, chords, "C").parallelPerfectRate).toBe(0)
    })

    it("属和音の上の導音は、コードが変わったら主音へ上がる", () => {
      const cgcc = parseChordInputText("C | G | C | C", "s1", 4, "c")
      const notes = [n(0, 64, 2), n(2, 67, 2), n(4, 74, 2), n(6, 74, 1), n(7, 71, 1), n(8, 67, 2), n(10, 64, 2), n(12, 60, 4)]
      const crafted = applyMelodicCraft(notes, { ...base, harmonicMap: buildHarmonicMap(cgcc), sectionRole: "bridge", profile: "minimal" })
      expect(at(crafted, 8)).toBe(72)
    })

    it("16拍以上のセクションは、前半を主音で閉じずに後半へつなぐ", () => {
      const notes = [n(0, 64, 2), n(2, 67, 2), n(4, 69, 2), n(6, 72, 2), n(8, 71, 2), n(10, 74, 2), n(12, 72, 4)]
      const crafted = applyMelodicCraft(notes, { ...base, sectionRole: "bridge", profile: "minimal" })
      expect(at(crafted, 6) % 12).not.toBe(0)
    })

    it("ため息(上の音から下がって入る倚音)は1か所だけ、解決先を付けて置く", () => {
      const five = parseChordInputText("C | F | G | C | C", "s1", 4, "c")
      const notes = [n(0, 64, 2), n(2, 67, 2), n(4, 69, 2), n(6, 65, 2), n(8, 67, 2), n(10, 67, 2), n(12, 64, 2), n(14, 67, 2), n(16, 64, 4)]
      const crafted = applyMelodicCraft(notes, { ...base, harmonicMap: buildHarmonicMap(five), totalBeats: 20, sectionRole: "bridge", profile: "standard" })
      const sighs = crafted.filter((note) => note.plannedToneRole === "appoggiatura")
      expect(sighs).toHaveLength(1)
      const resolution = crafted.find((note) => note.startBeat === sighs[0].plannedResolution!.targetBeat)!
      expect(sighs[0].pitch - resolution.pitch).toBeGreaterThanOrEqual(1)
      expect(sighs[0].pitch - resolution.pitch).toBeLessThanOrEqual(2)
      expect(measureMelodyCraft(crafted, five, "C").sighCount).toBe(1)
      expect(crafted.map((note) => note.id)).toHaveLength(new Set(crafted.map((note) => note.id)).size)
    })
  })
})
