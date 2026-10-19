import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from "@/core/arrangementGeneration"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { generateFullSongArrangement } from "./arrangementGenerator"

// 「ドラムレスで広がるイントロから、頭でキックと低域が一斉に入る」を、
// 書き出したMIDIを再読込して独立に測る。計画の値は使わず、実際に鳴っている小節だけを見る。
type Role = ComposerProject["sections"][number]["role"]
const INTENTION = "ドラムレスで広がるイントロから、頭でキックと低域が一斉に入る"
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
