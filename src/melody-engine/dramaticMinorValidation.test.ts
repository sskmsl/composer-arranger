import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { SeededRandom } from "@/core/rng"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { generateIncantatoryPattern } from "./incantatory"
import { buildHarmonicMap } from "./harmonicMap"
import { analyzeFullSongArrangement, buildFullSongArrangementPlan, generateFullSongArrangement, regenerateFullSongArrangementTarget } from "./arrangementGenerator"
import { exportArrangementMidi, exportArrangementTrackMidi } from "@/midi/exportArrangement"
import { exportMelodyMidi } from "@/midi/exportMelody"
import { parseMidi } from "@/midi/importMidi"

const seeds = [19, 41, 73, 101, 137, 173]
function fixture(): ComposerProject {
  const p = createEmptyProject("Decision validation")
  p.projectId = "decision-validation"
  p.song.key = "Cm"
  p.sections = ["verse", "pre-chorus", "chorus", "pre-chorus", "grand-chorus", "outro"].map((role, i) => ({
    id: `s${i}`, name: `Section ${i + 1}`, role: role as ComposerProject["sections"][number]["role"], startBar: 1 + i * 8, lengthBars: 8,
  }))
  p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({
    id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * 8, durationBeats: 8, symbol, bass: null,
  })))
  return p
}
const report: Record<string, unknown> = { seeds, scope: "generated notes and exported MIDI; no listening guarantee" }

describe("dramatic minor output distributions", () => {
  it("existing motif candidates contain semitone pedals and identifiable variations", () => {
    const p = fixture(), chords = p.chords.filter((c) => c.sectionId === "s0")
    let pedals = 0, variations = 0
    const perSeed: unknown[] = []
    for (const seed of seeds) {
      const batch = generateFromChordsWithProfiles({ chords, sectionId: "s0", sectionRole: "verse", songProfile: "original-custom",
        density: "balanced", range: { low: 60, high: 79 }, drama: "growing", totalBeats: 32, seed, profiles: ["incantatory"] })
      let count = 0
      for (const c of batch.candidates) {
        const midi = parseMidi(exportMelodyMidi({ title: "Motif", sectionName: "s0", tempo: 110,
          timeSignature: "4/4", chords, melodyNotes: c.notes, includeChords: false }))
        const pitches = midi.tracks.flatMap((t) => t.notes).map((n) => n.pitch)
        expect(pitches).toEqual(c.notes.map((n) => n.pitch))
        if (pitches.some((p, i) => i > 1 && p === pitches[i - 2] && Math.abs(p - pitches[i - 1]) === 1)) count++
      }
      pedals += count
      const raw = generateIncantatoryPattern(new SeededRandom(seed), buildHarmonicMap(chords), 32, { low: 60, high: 79 }, 1, .4)
      const size = raw.plan.motifNoteCount
      const cells = Array.from({ length: Math.floor(raw.notes.length / size) }, (_, i) => raw.notes.slice(i * size, (i + 1) * size))
      const contour = (cell: typeof raw.notes) => cell.slice(1).map((n, i) => Math.sign(n.pitch - cell[i].pitch)).join(",")
      const rhythm = (cell: typeof raw.notes) => cell.map((n) => n.durationBeats).join(",")
      let changed = 0
      for (let i = 1; i < cells.length; i++) {
        if ((contour(cells[i]) === contour(cells[0])) !== (rhythm(cells[i]) === rhythm(cells[0]))) changed++
      }
      variations += changed
      perSeed.push({ seed, candidates: batch.candidates.length, semitonePedalCandidates: count, identifiableVariations: changed })
    }
    report.motif = perSeed
    expect(pedals).toBeGreaterThan(0)
    expect(variations).toBeGreaterThan(0)
  })

  it("uses existing characters for staged or immediate entries and bar-sized transition windows", () => {
    const p = fixture(), analysis = analyzeFullSongArrangement(p)
    const calm = { ...analysis, sections: analysis.sections.map((s) => ({ ...s, energyDelta: 0 })) }
    const rising = { ...analysis, sections: analysis.sections.map((s) => ({ ...s, energyDelta: 30 })) }
    const safe = buildFullSongArrangementPlan(p, calm, 19, "", undefined, "dynamic-contrast")
    const edge = buildFullSongArrangementPlan(p, rising, 19, "", undefined, "dynamic-contrast")
    const surprise = buildFullSongArrangementPlan(p, rising, 19, "", { intention: "contrast", surpriseLevel: 1 }, "dynamic-contrast")
    const entry = (plan: typeof safe) => plan.sections[2].roleEntryBeats?.["syn-stabs"] ?? 0
    expect(entry(safe)).toBeGreaterThan(entry(edge))
    expect(entry(surprise)).toBeGreaterThan(entry(edge))
    for (const c of safe.sections[1].transitionCandidates) {
      expect(c.reason.length).toBeGreaterThan(0)
      expect(c.notes).toHaveLength(3)
      const first = c.notes[0].startBeat, last = c.notes.at(-1)!
      expect(last.startBeat + last.durationBeats - first).toBe(c.character === "surprise" ? 8 : 4)
    }
  })

  it("records independent layer changes and preserves reduction in actual MIDI for fixed seeds", () => {
    const p = fixture()
    const perSeed: unknown[] = []
    for (const seed of seeds.slice(0, 3)) {
      const arrangement = generateFullSongArrangement(p, { seed })
      const midi = parseMidi(exportArrangementMidi(p, arrangement))
      const managedNames = new Set(arrangement.tracks.filter((t) => t.id.startsWith("str-") || ["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-stabs", "syn-chord-wide", "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid"].includes(t.id)).map((t) => t.name))
      const boundaryChanges = p.sections.slice(1).map((s) => {
        const boundary = (s.startBar - 1) * 4
        return midi.tracks.filter((t) => {
          const count = (a: number, b: number) => t.notes.filter((n) => n.startTick / midi.ppq >= a && n.startTick / midi.ppq < b).length
          const a = count(boundary - 4, boundary), b = count(boundary, boundary + 4)
          return Math.abs(a - b) > Math.max(2, a * .5)
        }).length
      })
      const layerChanges = p.sections.slice(1).map((s) => {
        const boundary = (s.startBar - 1) * 4
        const onset = (t: typeof midi.tracks[number], a: number, b: number) => t.notes.filter((n) => n.startTick / midi.ppq >= a && n.startTick / midi.ppq < b).length
        const sounding = (t: typeof midi.tracks[number], a: number, b: number) => t.notes.some((n) => n.startTick / midi.ppq < b && (n.startTick + n.durationTicks) / midi.ppq > a)
        return {
          onsetFlips: midi.tracks.filter((t) => (onset(t, boundary - 4, boundary) === 0) !== (onset(t, boundary, boundary + 4) === 0)).length,
          soundingFlips: midi.tracks.filter((t) => sounding(t, boundary - 4, boundary) !== sounding(t, boundary, boundary + 4)).length,
          managedDensityChanges: midi.tracks.filter((t) => managedNames.has(t.name) && Math.abs(onset(t, boundary - 4, boundary) - onset(t, boundary, boundary + 4)) > Math.max(2, onset(t, boundary - 4, boundary) * .5)).length,
        }
      })
      const counts = p.sections.map((s) => midi.tracks.reduce((sum, t) => sum + t.notes.filter((n) => {
        const beat = n.startTick / midi.ppq
        return beat >= (s.startBar - 1) * 4 && beat < (s.startBar + s.lengthBars - 1) * 4
      }).length, 0))
      const row = { seed, boundaryChanges, layerChanges, sectionNoteCounts: counts, quality: arrangement.quality?.passed }
      // 発音数の差は層の出入りを表さない。音価を含む実MIDIの状態を小節ごとに検証する。
      const managedBoundaryFlips = p.sections.slice(1, -1).flatMap((section) => {
        const boundary = (section.startBar - 1) * 4
        return Array.from({ length: 7 }, (_, index) => {
          const bar = boundary + (index - 2) * 4
          const sounding = (t: typeof midi.tracks[number], start: number) => t.notes.some((n) =>
            n.startTick / midi.ppq < start + 4 - .01 && (n.startTick + n.durationTicks) / midi.ppq > start + .01)
          const changed = midi.tracks.filter((t) => managedNames.has(t.name) && sounding(t, bar - 4) !== sounding(t, bar))
          return changed.length
        })
      })
      Object.assign(row, { managedBoundaryFlips })
      perSeed.push(row)
      expect(Math.max(...managedBoundaryFlips)).toBeLessThanOrEqual(2)
      expect(counts.some((n, i) => i > 0 && n < counts[i - 1])).toBe(true)
      // 既存のdynamic-contrast解釈を使い、最終サビ前の削減を生成トラック単位で比較する。
      const plan = buildFullSongArrangementPlan(p, analyzeFullSongArrangement(p), seed, "", undefined, "dynamic-contrast")
      const beforeFinal = plan.sections[3]
      expect(beforeFinal.preBoundaryDropBeats).toBe(8)
      const role = beforeFinal.preBoundaryDropRoles![0]
      expect(role).toBeDefined()
      const current = { ...arrangement, plan }
      const reduced = regenerateFullSongArrangementTarget(p, current, { trackId: role, sectionId: "s3" })
      const noDrop = { ...current, plan: { ...plan, sections: plan.sections.map((s) => s.sectionId === "s3" ? { ...s, preBoundaryDropBeats: 0 } : s) } }
      const baseline = regenerateFullSongArrangementTarget(p, noDrop, { trackId: role, sectionId: "s3" })
      const midiCount = (a: typeof reduced) => parseMidi(exportArrangementTrackMidi(p, a, role)).tracks.reduce((sum, t) => sum + t.notes.length, 0)
      expect(midiCount(reduced)).toBeLessThan(midiCount(baseline))
      const firstOnset = (entryBeat: number) => {
        const timingPlan = { ...plan, sections: plan.sections.map((s) => s.sectionId === "s4" ? {
          ...s, activeRoles: [...new Set([...s.activeRoles, "str-violin-1" as const])],
          roleEntryBeats: { ...s.roleEntryBeats, "str-violin-1": entryBeat },
        } : s) }
        const result = regenerateFullSongArrangementTarget(p, { ...arrangement, plan: timingPlan }, { trackId: "str-violin-1", sectionId: "s4" })
        const read = parseMidi(exportArrangementTrackMidi(p, result, "str-violin-1"))
        const offset = (p.sections[4].startBar - 1) * 4
        return Math.min(...read.tracks.flatMap((t) => t.notes).filter((n) => n.startTick / read.ppq >= offset && n.startTick / read.ppq < offset + 32).map((n) => n.startTick / read.ppq - offset))
      }
      const entryOnsets = { safe: firstOnset(8), edge: firstOnset(0), surprise: firstOnset(4) }
      expect(entryOnsets.safe).toBeGreaterThan(entryOnsets.surprise)
      expect(entryOnsets.surprise).toBeGreaterThan(entryOnsets.edge)
      Object.assign(row, { entryOnsets })
      expect(plan.sections.flatMap((s) => s.transitionCandidates).every((c) => c.reason.length > 0)).toBe(true)
    }
    report.arrangement = perSeed
    if (process.env.DRAMATIC_MINOR_REPORT) writeFileSync(process.env.DRAMATIC_MINOR_REPORT, JSON.stringify(report, null, 2) + "\n")
  }, 60_000)
})
