import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_PATTERNS, type ArrangementPatternId } from "@/core/arrangementPatterns"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from "@/core/arrangementGeneration"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { generateSelectedDirection } from "@/app/directionGeneration"
import { arrangementSoundInstructionFromText } from "@/core/arrangementIntent"
import { finalizeFullSongArrangement, generateFullSongArrangement } from "./arrangementGenerator"

// 「ドラムレスで広がるイントロから、頭でキックと低域が一斉に入る」を、
// 書き出したMIDIを再読込して独立に測る。計画の値は使わず、実際に鳴っている小節だけを見る。
type Role = ComposerProject["sections"][number]["role"]
const phraseOf = (id: ArrangementPatternId) => ARRANGEMENT_PATTERNS.find((pattern) => pattern.id === id)!.phrase
const INTENTION = phraseOf("drumless-intro-drop")
const BEATS_PER_BAR = 4
/** イントロで鳴らさない層(キック・スネア・低域)。 */
const HELD: readonly ArrangementTrackId[] = [
  "dr-kick", "dr-kick-sub", "dr-kick-click", "dr-snare", "dr-snare-body", "dr-clap",
  "syn-bass", "syn-sub-bass", "syn-bass-mid", "str-contrabass",
]
/** ドロップで必ず頭から鳴る重心。 */
const CORE: readonly ArrangementTrackId[] = ["dr-kick", "syn-bass"]

function fixture(spec: [Role, number][]): ComposerProject {
  const p = createEmptyProject("Intro drop")
  p.projectId = "intro-drop"
  p.song.key = "Cm"
  let bar = 1
  p.sections = spec.map(([role, bars], i) => {
    const section = { id: `s${i}`, name: `Section ${i + 1}`, role, startBar: bar, lengthBars: bars }
    bar += bars
    return section
  })
  p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({
    id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * s.lengthBars,
    durationBeats: s.lengthBars, symbol, bass: null,
  })))
  return p
}

type Arrangement = ReturnType<typeof generateFullSongArrangement>
type Notes = { startBeat: number, endBeat: number }[]

function exportedNotes(p: ComposerProject, arrangement: Arrangement) {
  const midi = parseMidi(exportArrangementMidi(p, arrangement))
  const idByName = new Map(Object.entries(ARRANGEMENT_TRACK_NAMES).map(([id, name]) => [name, id as ArrangementTrackId]))
  const byId = new Map<ArrangementTrackId, Notes>()
  for (const track of midi.tracks) {
    const id = idByName.get(track.name)
    if (!id || !track.notes.length) continue
    byId.set(id, [...(byId.get(id) ?? []), ...track.notes.map((n) => ({
      startBeat: n.startTick / midi.ppq, endBeat: (n.startTick + n.durationTicks) / midi.ppq,
    }))])
  }
  return byId
}

/** 区間の中で音が鳴っている小節(区間の先頭を0とする)。 */
function soundingBars(p: ComposerProject, sectionIndex: number, notes: Notes | undefined): number[] {
  const section = p.sections[sectionIndex]
  return Array.from({ length: section.lengthBars }, (_, k) => k).filter((k) => (notes ?? []).some((n) =>
    n.startBeat < (section.startBar - 1 + k + 1) * BEATS_PER_BAR && n.endBeat > (section.startBar - 1 + k) * BEATS_PER_BAR + .01))
}

const SEEDS = [1, 2, 3, 4, 5, 6]
const generate = (p: ComposerProject, seed: number, directive?: Parameters<typeof generateFullSongArrangement>[1] extends infer O ? O extends { directive?: infer D } ? D : never : never) =>
  generateFullSongArrangement(p, { seed, directive })

describe("intro drop: drumless, low-end-free intro and a simultaneous entrance", () => {
  for (const introBars of [4, 8, 16]) {
    const p = fixture([["intro", introBars], ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["outro", 4]])
    it(`keeps kick, snare and the low end out of a ${introBars}-bar intro and brings them in together on the first bar of the verse`, () => {
      for (const seed of SEEDS) {
        const notes = exportedNotes(p, generate(p, seed, { intention: INTENTION }))
        for (const id of HELD) {
          expect(soundingBars(p, 0, notes.get(id)), `seed ${seed} ${id}: イントロで鳴っている`).toEqual([])
        }
        for (const id of CORE) {
          expect(Math.min(...soundingBars(p, 1, notes.get(id))), `seed ${seed} ${id}: 頭から入らない`).toBe(0)
        }
        const enteringTogether = HELD.filter((id) => soundingBars(p, 1, notes.get(id)).includes(0))
        expect(enteringTogether.length, `seed ${seed}: 頭で一斉に入る層が少ない`).toBeGreaterThanOrEqual(3)
        expect(notes.has("syn-dark-pad") && soundingBars(p, 0, notes.get("syn-dark-pad")).length, `seed ${seed}: イントロの広がりの層が鳴らない`).toBeGreaterThan(0)
      }
    }, 60_000)
  }

  it("leaves a track alone that the director asked to preserve", () => {
    const p = fixture([["intro", 8], ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["outro", 4]])
    for (const seed of SEEDS) {
      const without = exportedNotes(p, generate(p, seed))
      const kept = exportedNotes(p, generate(p, seed, { intention: INTENTION, preserve: ["syn-bass"] }))
      expect(soundingBars(p, 0, kept.get("syn-bass")), `seed ${seed}: 保持を指定した主ベースが変わった`)
        .toEqual(soundingBars(p, 0, without.get("syn-bass")))
      expect(soundingBars(p, 0, kept.get("dr-kick")), `seed ${seed}: キックはイントロで鳴らない`).toEqual([])
    }
  }, 60_000)

  it("does not touch the output when the intention is absent or about something else", () => {
    const p = fixture([["intro", 8], ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["outro", 4]])
    const hash = (a: Arrangement) => JSON.stringify(a.tracks.map((t) => [t.id, t.notes.map((n) => [n.startBeat, n.durationBeats, n.pitch, n.velocity])]))
    for (const seed of SEEDS) {
      const base = hash(generate(p, seed))
      // 低域を控えるヴァースの指示は、イントロの入口を動かさない。
      const hold = generate(p, seed, { intention: "低域を控えたヴァースから、サビで広げる" })
      expect(soundingBars(p, 0, exportedNotes(p, hold).get("syn-bass")), `seed ${seed}: ヴァースの指示でイントロが変わった`)
        .toEqual(soundingBars(p, 0, exportedNotes(p, generate(p, seed)).get("syn-bass")))
      expect(hash(generate(p, seed)), `seed ${seed}: 同seedで一致しない`).toBe(base)
    }
  }, 60_000)

  it("does not apply when the instruction is scoped to another section", () => {
    const p = fixture([["intro", 8], ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["outro", 4]])
    for (const seed of SEEDS) {
      const scoped = exportedNotes(p, generate(p, seed, { intention: INTENTION, sectionId: "s3" }))
      const base = exportedNotes(p, generate(p, seed))
      expect(soundingBars(p, 0, scoped.get("syn-bass")), `seed ${seed}`).toEqual(soundingBars(p, 0, base.get("syn-bass")))
    }
  }, 60_000)

  it("does not push the entrance into a breakdown or an outro that follows the intro", () => {
    const p = fixture([["intro", 8], ["breakdown-chorus", 8], ["chorus", 8], ["outro", 4]])
    for (const seed of SEEDS) {
      const notes = exportedNotes(p, generate(p, seed, { intention: INTENTION }))
      for (const id of HELD) expect(soundingBars(p, 0, notes.get(id)), `seed ${seed} ${id}`).toEqual([])
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 途中で低域とキックを抜く区間と、戻りで一斉に大きく入れる型
// ---------------------------------------------------------------------------
const BREAK_INTENTION = phraseOf("low-end-break")
/** 途中で抜く層(キックと低域)。スネア・高域・空気の層は含めない。 */
const LOW_BREAK: readonly ArrangementTrackId[] = [
  "dr-kick", "dr-kick-sub", "dr-kick-click", "syn-bass", "syn-sub-bass", "syn-bass-mid", "str-contrabass",
]

describe("low-end break: kick and low end drop out for a section and return together", () => {
  const withBreakdown = fixture([["intro", 8], ["chorus", 8], ["breakdown-chorus", 8], ["verse", 8], ["outro", 4]])
  const BREAK = 2, RETURN = 3

  it("keeps kick and low end out of the breakdown and brings them in together on the first bar of the next section", () => {
    for (const seed of SEEDS) {
      const notes = exportedNotes(withBreakdown, generate(withBreakdown, seed, { intention: BREAK_INTENTION }))
      for (const id of LOW_BREAK) {
        expect(soundingBars(withBreakdown, BREAK, notes.get(id)), `seed ${seed} ${id}: 抜く区間で鳴っている`).toEqual([])
      }
      for (const id of CORE) {
        expect(Math.min(...soundingBars(withBreakdown, RETURN, notes.get(id))), `seed ${seed} ${id}: 戻りの頭から入らない`).toBe(0)
      }
      const together = LOW_BREAK.filter((id) => soundingBars(withBreakdown, RETURN, notes.get(id)).includes(0))
      expect(together.length, `seed ${seed}: 戻りの頭で一斉に入る層が少ない`).toBeGreaterThanOrEqual(3)
    }
  }, 60_000)

  it("marks the return with a crash on its first beat, which a plain verse does not get", () => {
    const returnStart = (withBreakdown.sections[RETURN].startBar - 1) * BEATS_PER_BAR
    for (const seed of SEEDS) {
      const crashAtStart = (arrangement: Arrangement) => (exportedNotes(withBreakdown, arrangement).get("dr-crash") ?? [])
        .some((n) => Math.abs(n.startBeat - returnStart) < .01)
      expect(crashAtStart(generate(withBreakdown, seed, { intention: BREAK_INTENTION })), `seed ${seed}: 戻りの頭にクラッシュが無い`).toBe(true)
      expect(crashAtStart(generate(withBreakdown, seed)), `seed ${seed}: 指示なしでクラッシュが入った`).toBe(false)
    }
  }, 60_000)

  it("leaves the sections before the breakdown as they are without the instruction", () => {
    for (const seed of SEEDS) {
      const base = exportedNotes(withBreakdown, generate(withBreakdown, seed))
      const patterned = exportedNotes(withBreakdown, generate(withBreakdown, seed, { intention: BREAK_INTENTION }))
      expect(soundingBars(withBreakdown, 0, patterned.get("syn-bass")), `seed ${seed}: イントロの主ベースが変わった`).toEqual(soundingBars(withBreakdown, 0, base.get("syn-bass")))
    }
  }, 60_000)

  it("falls back to a bridge when there is no breakdown, and does nothing when there is neither", () => {
    const bridge = fixture([["intro", 8], ["chorus", 8], ["bridge", 8], ["chorus", 8], ["outro", 4]])
    const none = fixture([["intro", 8], ["verse", 8], ["chorus", 8], ["outro", 4]])
    for (const seed of SEEDS) {
      const notes = exportedNotes(bridge, generate(bridge, seed, { intention: BREAK_INTENTION }))
      for (const id of LOW_BREAK) expect(soundingBars(bridge, 2, notes.get(id)), `seed ${seed} ${id}: ブリッジで鳴っている`).toEqual([])
      expect(Math.min(...soundingBars(bridge, 3, notes.get("syn-bass"))), `seed ${seed}: 戻りの頭から入らない`).toBe(0)
      const hash = (a: Arrangement) => JSON.stringify(a.tracks.map((t) => [t.id, t.notes.map((n) => [n.startBeat, n.pitch, n.velocity])]))
      expect(hash(generate(none, seed, { intention: BREAK_INTENTION })), `seed ${seed}: 抜く区間が無い曲が変わった`).toBe(hash(generate(none, seed)))
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 終わりをフェードアウトで終える型
// ---------------------------------------------------------------------------
const FADE_INTENTION = phraseOf("fade-out-ending")

describe("fade-out ending: the last bars of the song step down in level", () => {
  const song = fixture([["verse", 8], ["chorus", 8], ["outro", 8]])
  const outro = song.sections[2]
  const fadeStart = (outro.startBar - 1 + outro.lengthBars - 4) * BEATS_PER_BAR

  /** MIDIから読み直した、各小節で鳴っている音の velocity の平均(全トラック)。 */
  function barMeans(arrangement: Arrangement): number[] {
    const midi = parseMidi(exportArrangementMidi(song, arrangement))
    return Array.from({ length: 4 }, (_, bar) => {
      const from = fadeStart + bar * BEATS_PER_BAR, to = from + BEATS_PER_BAR
      const sounding = midi.tracks.flatMap((track) => track.notes.filter((note) => {
        const startBeat = note.startTick / midi.ppq
        return startBeat < to - .01 && startBeat + note.durationTicks / midi.ppq > from + .01
      }))
      return sounding.length ? sounding.reduce((sum, note) => sum + note.velocity, 0) / sounding.length : 0
    })
  }

  it("lowers the level bar by bar and ends far below where it started, leaving everything before the fade untouched", () => {
    for (const seed of SEEDS) {
      const faded = generate(song, seed, { intention: FADE_INTENTION })
      const base = generate(song, seed)
      const means = barMeans(faded)
      for (let bar = 1; bar < 4; bar++) {
        expect(means[bar], `seed ${seed} bar ${bar}: 前の小節より下がっていない`).toBeLessThan(means[bar - 1])
      }
      expect(means[3], `seed ${seed}: 最後の小節が十分に下がっていない`).toBeLessThanOrEqual(means[0] * .45)
      const before = (a: Arrangement) => JSON.stringify(a.tracks.map((t) => [t.id, t.notes.filter((n) => n.startBeat < fadeStart).map((n) => [n.startBeat, n.pitch, n.velocity])]))
      expect(before(faded), `seed ${seed}: フェードより前が変わった`).toBe(before(base))
    }
  }, 60_000)

  it("gives the same result when the finishing step runs again (the ceiling does not stack)", () => {
    for (const seed of [1, 2, 3]) {
      const faded = generate(song, seed, { intention: FADE_INTENTION })
      const again = finalizeFullSongArrangement(song, faded, { refine: false })
      expect(barMeans(again), `seed ${seed}`).toEqual(barMeans(faded))
    }
  }, 60_000)

  it("does not fade without the instruction", () => {
    for (const seed of SEEDS) {
      const means = barMeans(generate(song, seed))
      expect(means[3], `seed ${seed}: 指示なしで下がった`).toBeGreaterThan(means[0] * .45)
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 画面(方向選び)から3つの型を同時に選んだとき
// ---------------------------------------------------------------------------
describe("patterns chosen together from the direction picker", () => {
  const song = fixture([["intro", 8], ["chorus", 8], ["breakdown-chorus", 8], ["verse", 8], ["outro", 8]])
  const chosen = {
    id: "balanced-architecture" as const,
    title: "Balanced",
    summary: "Melodyを唯一の前景として守り、Pulse・Counter・Transitionを必要なSectionだけへ配置します。",
    character: "balanced" as const,
  }
  const allPatterns: ArrangementPatternId[] = ARRANGEMENT_PATTERNS.map((pattern) => pattern.id)

  /** 画面と同じ経路で、生成へ渡る brief と directive を作る。 */
  function viaPicker(patterns: ArrangementPatternId[]) {
    let call: { brief: string, directive: NonNullable<Parameters<typeof generate>[2]> } | undefined
    generateSelectedDirection(chosen, () => undefined, (_label, brief, directive) => { call = { brief, directive } }, 0, patterns)
    return call!
  }

  it("keeps the pattern wording out of the brief so that it is not read as a sound instruction", () => {
    const { brief, directive } = viaPicker(allPatterns)
    expect(arrangementSoundInstructionFromText(brief)).toBeUndefined()
    for (const pattern of ARRANGEMENT_PATTERNS) expect(directive.intention).toContain(pattern.phrase)
    expect(viaPicker([]).directive.intention).toBe(chosen.summary)
  })

  it("applies the intro drop, the low-end break and the fade-out in one song", () => {
    const { brief, directive } = viaPicker(allPatterns)
    for (const seed of [1, 2, 3]) {
      const arrangement = generateFullSongArrangement(song, { seed, brief, directive })
      const notes = exportedNotes(song, arrangement)
      for (const id of HELD) expect(soundingBars(song, 0, notes.get(id)), `seed ${seed} ${id}: イントロで鳴っている`).toEqual([])
      for (const id of LOW_BREAK) expect(soundingBars(song, 2, notes.get(id)), `seed ${seed} ${id}: 抜く区間で鳴っている`).toEqual([])
      expect(Math.min(...soundingBars(song, 1, notes.get("syn-bass"))), `seed ${seed}: イントロ明けが頭から入らない`).toBe(0)
      expect(Math.min(...soundingBars(song, 3, notes.get("syn-bass"))), `seed ${seed}: 戻りが頭から入らない`).toBe(0)
      const outro = song.sections[4]
      const fadeStart = (outro.startBar - 1 + outro.lengthBars - 4) * BEATS_PER_BAR
      const midi = parseMidi(exportArrangementMidi(song, arrangement))
      const meanAt = (bar: number) => {
        const from = fadeStart + bar * BEATS_PER_BAR, to = from + BEATS_PER_BAR
        const sounding = midi.tracks.flatMap((track) => track.notes.filter((n) => n.startTick / midi.ppq < to - .01
          && n.startTick / midi.ppq + n.durationTicks / midi.ppq > from + .01))
        return sounding.reduce((sum, n) => sum + n.velocity, 0) / Math.max(1, sounding.length)
      }
      expect(meanAt(3), `seed ${seed}: 最後の小節が下がっていない`).toBeLessThanOrEqual(meanAt(0) * .45)
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------
// レビュー指摘の再現(PR #197)
// ---------------------------------------------------------------------------
describe("review findings: wording collisions, derived layers in long sections, preserved tracks", () => {
  it("keeps the verse-wide low-end hold-back out of the low-end break wording, in both spellings", () => {
    const song = fixture([["intro", 8], ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["breakdown-chorus", 8], ["verse", 8], ["outro", 4]])
    for (const wording of ["低域とキックを抜いた区間を作り、戻りで一斉に大きく入れる", "低域とキックを抜く区間を作り、戻りで一斉に大きく入れる"]) {
      for (const seed of SEEDS) {
        const base = exportedNotes(song, generate(song, seed))
        const notes = exportedNotes(song, generate(song, seed, { intention: wording }))
        for (const index of [1, 2]) {
          expect(soundingBars(song, index, notes.get("syn-sub-bass")), `seed ${seed} 「${wording}」: ヴァース/Bメロの補助ベースが変わった`)
            .toEqual(soundingBars(song, index, base.get("syn-sub-bass")))
        }
        for (const id of LOW_BREAK) expect(soundingBars(song, 4, notes.get(id)), `seed ${seed} ${id}: 抜く区間で鳴っている`).toEqual([])
      }
    }
  }, 120_000)

  it("sustains Pad Air through a long intro and brings every held layer in on the first bar of a long verse", () => {
    const song = fixture([["intro", 20], ["verse", 16], ["chorus", 8], ["outro", 4]])
    for (const seed of SEEDS) {
      const notes = exportedNotes(song, generate(song, seed, { intention: INTENTION }))
      if (notes.has("syn-pad-air")) {
        expect(Math.min(...soundingBars(song, 0, notes.get("syn-pad-air"))), `seed ${seed}: Pad Air がイントロの途中から入る`).toBe(0)
      }
      for (const id of ["syn-sub-bass", "syn-bass-mid"] as const) {
        if (!notes.has(id) || soundingBars(song, 1, notes.get(id)).length === 0) continue
        expect(Math.min(...soundingBars(song, 1, notes.get(id))), `seed ${seed} ${id}: 長いヴァースの頭から入らない`).toBe(0)
      }
    }
  }, 120_000)

  it("does not rewrite a track that the director asked to preserve when fading out", () => {
    const song = fixture([["verse", 8], ["chorus", 8], ["outro", 8]])
    for (const seed of SEEDS) {
      const kept = generate(song, seed, { intention: FADE_INTENTION, preserve: ["syn-bass"] })
      // 書き換えが入ると、音は小節の境目で分かれて ":fade" の付いた id になり、velocity は上限(最終小節で4)まで下がる。
      for (const id of ["syn-bass", "syn-sub-bass"] as const) {
        const notes = kept.tracks.find((t) => t.id === id)?.notes ?? []
        expect(notes.filter((n) => n.id.includes(":fade")), `seed ${seed} ${id}: 保持を指定した層(の派生層)が分割された`).toEqual([])
        expect(Math.min(...notes.map((n) => n.velocity), 127), `seed ${seed} ${id}: 保持を指定した層(の派生層)の velocity が下がった`).toBeGreaterThanOrEqual(30)
      }
      // 保持を指定していない層は、同じ条件でフェードされている(対照)。
      const faded = generate(song, seed, { intention: FADE_INTENTION })
      expect(faded.tracks.some((t) => t.notes.some((n) => n.id.includes(":fade"))), `seed ${seed}: 対照でフェードが働いていない`).toBe(true)
    }
  }, 120_000)
})
