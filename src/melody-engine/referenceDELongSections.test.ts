import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from "@/core/arrangementGeneration"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { analyzeFullSongArrangement, buildFullSongArrangementPlan, regenerateFullSongArrangementTarget, generateFullSongArrangement } from "./arrangementGenerator"

// Issue #194 の規則1・2を、書き出したMIDIから独立に検証する。
// 計画の値は使わず、音が実際に重なって鳴っている小節だけを数える。
// 管理対象・休符許容(1小節)・1小節あたり2層までは、#193 の dramaticMinorBoundary.test.ts と同じ。
type Role = ComposerProject["sections"][number]["role"]

const MANAGED_IDS: ReadonlySet<string> = new Set([
  "syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide", "syn-stabs",
  "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid",
])
const isManaged = (id: string) => id.startsWith("str-") || MANAGED_IDS.has(id)
/** 補助ベース層。主ベース `syn-bass` は含めない(#193 の分類どおり、和声の重心として維持する)。 */
const REST_TOLERANCE_BARS = 1
const MAX_CHANGES_PER_BAR = 2
const BEATS_PER_BAR = 4

function fixture(spec: [Role, number][]): ComposerProject {
  const p = createEmptyProject("Bass layers")
  p.projectId = "bass-layers"
  p.song.key = "Cm"
  let bar = 1
  p.sections = spec.map(([role, bars], i) => {
    const section = { id: `s${i}`, name: `Section ${i + 1}`, role, startBar: bar, lengthBars: bars }
    bar += bars
    return section
  })
  p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({
    // 和音は区間の先頭からの相対位置(曲全体の位置にするのは buildSongPlaybackMaterial)。
    id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * s.lengthBars,
    durationBeats: s.lengthBars, symbol, bass: null,
  })))
  return p
}

type Arrangement = ReturnType<typeof generateFullSongArrangement>

/** トラックIDごとの、書き出したMIDIの音(拍で表す)。 */
function exportedNotes(p: ComposerProject, arrangement: Arrangement) {
  const midi = parseMidi(exportArrangementMidi(p, arrangement))
  const idByName = new Map(Object.entries(ARRANGEMENT_TRACK_NAMES).map(([id, name]) => [name, id as ArrangementTrackId]))
  const byId = new Map<ArrangementTrackId, { startBeat: number, endBeat: number }[]>()
  for (const track of midi.tracks) {
    const id = idByName.get(track.name)
    if (!id || !track.notes.length) continue
    byId.set(id, [...(byId.get(id) ?? []), ...track.notes.map((n) => ({ startBeat: n.startTick / midi.ppq, endBeat: (n.startTick + n.durationTicks) / midi.ppq }))])
  }
  return byId
}

/** その小節(0始まり)に、音が実際に重なって鳴っているか。 */
function soundsInBar(notes: { startBeat: number, endBeat: number }[] | undefined, bar: number): boolean {
  return (notes ?? []).some((n) => n.startBeat < (bar + 1) * BEATS_PER_BAR && n.endBeat > bar * BEATS_PER_BAR + .01)
}

/** 区間の中で音が鳴っている小節(区間の先頭を0とする)。 */
function soundingBarsIn(p: ComposerProject, sectionIndex: number, notes: { startBeat: number, endBeat: number }[] | undefined): number[] {
  const section = p.sections[sectionIndex]
  return Array.from({ length: section.lengthBars }, (_, k) => k).filter((k) => soundsInBar(notes, section.startBar - 1 + k))
}

/** 両側が鳴っている小節に挟まれた、tolerance 以下の無音を埋める。 */
function bridgeShortRests(on: boolean[], tolerance: number): boolean[] {
  const result = [...on]
  let i = 0
  while (i < result.length) {
    if (result[i]) { i++; continue }
    let j = i
    while (j < result.length && !result[j]) j++
    if (i > 0 && j < result.length && j - i <= tolerance) for (let k = i; k < j; k++) result[k] = true
    i = j
  }
  return result
}

/** その小節で、直前の小節から鳴り方が入れ替わった管理対象のトラック。 */
function managedChangesAt(p: ComposerProject, notes: ReturnType<typeof exportedNotes>, bar: number): ArrangementTrackId[] {
  const totalBars = Math.max(...p.sections.map((s) => s.startBar + s.lengthBars - 1))
  return [...notes.entries()].filter(([id]) => isManaged(id)).filter(([, ns]) => {
    const on = bridgeShortRests(Array.from({ length: totalBars }, (_, b) => soundsInBar(ns, b)), REST_TOLERANCE_BARS)
    return on[bar - 1] !== on[bar]
  }).map(([id]) => id)
}

const seeds = [19, 41, 73, 101, 137, 173]
const project = fixture([["verse", 16], ["pre-chorus", 16], ["chorus", 8], ["outro", 4]])

describe("reference D and E long section structure", () => {
  it("keeps flat interiors stable and adds at most one layer every four bars in the alternative", () => {
    const rows: unknown[] = []
    for (const seed of seeds) {
      const original = generateFullSongArrangement(project, { seed })
      const selectedNotes = exportedNotes(project, original)
      for (const section of project.sections.slice(1, -1)) {
        for (let bar = section.startBar - 3; bar <= section.startBar + 3; bar++) {
          expect(managedChangesAt(project, selectedNotes, bar).length, `seed ${seed} boundary bar ${bar}`).toBeLessThanOrEqual(MAX_CHANGES_PER_BAR)
        }
      }
      const versions = (["space-led", "dynamic-contrast"] as const).map((approach) => {
        const plan = buildFullSongArrangementPlan(project, analyzeFullSongArrangement(project), seed, "", undefined, approach)
        // 既存の部分再生成APIを使い、同じ曲に各候補の入場計画を実現する。
        let arrangement = { ...original, plan }
        for (const track of original.tracks) arrangement = regenerateFullSongArrangementTarget(project, arrangement, { trackId: track.id, sectionId: "s1" })
        const notes = exportedNotes(project, arrangement)
        const states = [...notes].filter(([id]) => isManaged(id)).map(([, ns]) => bridgeShortRests(Array.from({ length: 44 }, (_, bar) => soundsInBar(ns, bar)), REST_TOLERANCE_BARS))
        const counts = Array.from({ length: 16 }, (_, bar) => states.filter((on) => on[16 + bar]).length)
        const firstEntries = [...notes].filter(([id]) => isManaged(id)).map(([id, ns]) => ({ id, bars: soundingBarsIn(project, 1, ns) })).filter((r) => r.bars.length).map((r) => ({ id: r.id, first: r.bars[0] }))
        return { approach, counts, firstEntries, plan: plan.sections[1] }
      })
      const flat = versions[0], build = versions[1]
      expect(Object.entries(flat.plan.roleEntryBeats ?? {}).filter(([id, beat]) => isManaged(id) && beat! > 16)).toEqual([])
      expect(new Set(flat.counts.slice(4, 14)).size).toBe(1)
      const internal = build.firstEntries.filter((r) => r.first >= 4 && r.first < 14)
      expect(internal.length).toBeGreaterThan(0)
      for (const bar of [4, 8, 12]) expect(internal.filter((r) => r.first >= bar && r.first < bar + 4).length).toBeLessThanOrEqual(1)
      expect(build.counts).not.toEqual(flat.counts)
      rows.push({ seed, flat: flat.counts, build: build.counts, internal })
    }
    if (process.env.REFERENCE_DE_LONG_REPORT) writeFileSync(process.env.REFERENCE_DE_LONG_REPORT, JSON.stringify({ seeds, longSections: rows }, null, 2) + "\n")
  }, 60_000)
})
