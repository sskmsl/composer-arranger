import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from "@/core/arrangementGeneration"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { resolveProjectTiming } from "@/core/timingMigration"
import { readProjectFile } from "@/storage/projectFile"
import { exportMelodyMidi } from "@/midi/exportMelody"
import { generateSectionContent } from "./generateSectionContent"
import { generateFullSongArrangement } from "./arrangementGenerator"

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
const AUXILIARY_BASS: readonly ArrangementTrackId[] = ["syn-sub-bass", "syn-bass-mid"]
const MAIN_BASS: ArrangementTrackId = "syn-bass"
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
const project = fixture([["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["breakdown-chorus", 8], ["pre-chorus", 4], ["grand-chorus", 8], ["outro", 4]])
const report: Record<string, unknown> = { seeds, conditions: "MIDI reimport; 4/4 Cm; section-relative harmony; bridge rests <=1 bar; no listening claim" }

describe("reference D and E fixed-seed output and compatibility", () => {
  it("preserves bass contrast, boundary limits and the saved arrangement MIDI", async () => {
    const rows: unknown[] = []
    for (const seed of seeds) {
      const arrangement = generateFullSongArrangement(project, { seed, directive: { intention: "低域を控えたヴァースから、サビで広げる" } })
      const notes = exportedNotes(project, arrangement)
      const counts = project.sections.map((_, index) => ({ main: soundingBarsIn(project, index, notes.get(MAIN_BASS)).length,
        auxiliary: AUXILIARY_BASS.map((id) => soundingBarsIn(project, index, notes.get(id)).length) }))
      for (const index of [0, 1, 3]) expect(counts[index].auxiliary).toEqual([0, 0])
      for (const index of [0, 1, 2, 3, 5]) expect(counts[index].main).toBeGreaterThan(0)
      for (const index of [2, 5]) expect(counts[index].auxiliary.some((n) => n > 0)).toBe(true)
      const flips = project.sections.slice(1, -1).flatMap((section) => Array.from({ length: 7 }, (_, i) =>
        managedChangesAt(project, notes, section.startBar - 3 + i).length))
      expect(Math.max(...flips), `seed ${seed}`).toBeLessThanOrEqual(MAX_CHANGES_PER_BAR)
      const saved = { ...project, fullSongArrangement: arrangement }
      const file = new File([JSON.stringify(saved)], "reference-de.json", { type: "application/json" })
      const restored = resolveProjectTiming(await readProjectFile(file)).project
      expect(restored.fullSongArrangement?.plan).toEqual(arrangement.plan)
      expect(exportArrangementMidi(restored, restored.fullSongArrangement!)).toEqual(exportArrangementMidi(saved, arrangement))
      rows.push({ seed, approach: arrangement.plan.candidateApproach, counts, maximumChanges: Math.max(...flips), quality: arrangement.quality?.passed, savedMidiIdentical: true })
    }
    report.bassAndCompatibility = rows
  }, 60_000)

  it("retains existing eight-bar drone holds and chord colour tones without another generator", () => {
    const rows: unknown[] = []
    let longHolds = 0
    const colours = new Set<number>()
    for (const bars of [8, 12]) for (const seed of seeds) {
      const chords = Array.from({ length: bars }, (_, i) => ({ id: `c${i}`, sectionId: "drone", startBeat: i * 4,
        durationBeats: 4, symbol: ["Am", "F", "C", "G"][i % 4], bass: null }))
      const batch = generateSectionContent({ chords, sectionId: "drone", sectionRole: "verse", songProfile: "dark-romantic",
        content: { lead: "drone", accompaniment: "chords", entryOffsetBeats: 0, pickup: false },
        range: { low: 60, high: 79 }, totalBeats: bars * 4, beatsPerBar: 4, seed, key: "Am" })
      const durations = batch.candidates.map((c) => {
        const midi = parseMidi(exportMelodyMidi({ title: "Drone", sectionName: "drone", tempo: 100, timeSignature: "4/4", chords, melodyNotes: c.notes, includeChords: false }))
        const ns = midi.tracks.flatMap((t) => t.notes)
        expect(ns.map((n) => n.pitch)).toEqual(c.notes.map((n) => n.pitch))
        for (const n of ns.filter((n) => n.durationTicks / midi.ppq >= 32)) {
          longHolds++
          for (let bar = 0; bar < bars; bar++) {
            const start = n.startTick / midi.ppq, end = (n.startTick + n.durationTicks) / midi.ppq
            if (start < (bar + 1) * 4 && end > bar * 4) colours.add((n.pitch - [9, 5, 0, 7][bar % 4] + 120) % 12)
          }
        }
        return Math.max(0, ...ns.map((n) => n.durationTicks / midi.ppq))
      })
      rows.push({ seed, bars, longestDurations: durations })
    }
    expect(longHolds).toBeGreaterThan(0)
    for (const colour of [2, 9, 11]) expect(colours.has(colour)).toBe(true)
    report.drone = { rows, longHolds, intervals: [...colours].sort((a, b) => a - b) }
    if (process.env.REFERENCE_DE_COMPAT_REPORT) writeFileSync(process.env.REFERENCE_DE_COMPAT_REPORT, JSON.stringify(report, null, 2) + "\n")
  }, 60_000)
})
