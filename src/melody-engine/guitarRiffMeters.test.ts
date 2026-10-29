import { describe, expect, it } from "vitest"
import { DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"
import { normalizeProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { ARRANGEMENT_TRACK_NAMES } from "@/core/arrangementGeneration"
import { exportSongMidi } from "@/midi/exportMelody"
import { parseMidi } from "@/midi/importMidi"
import { riffMeterSong } from "../../tools/qa/riffMeterSong"
import { generateFullSongArrangement, regenerateFullSongArrangementTarget } from "./arrangementGenerator"

const MANAGED = new Set(["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide", "syn-stabs", "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid", "gtr-arpeggio", "gtr-strum", "gtr-riff"])
const names = new Set(Object.entries(ARRANGEMENT_TRACK_NAMES).filter(([id]) => id.startsWith("str-") || MANAGED.has(id)).map(([,name]) => name))

describe("riff MIDI in other meters", () => {
  it.each([["3/4", 19], ["3/4", 41], ["6/8", 19], ["6/8", 41]] as const)("preserves safety and saved MIDI in %s, seed %i", (meter, seed) => {
    const p = riffMeterSong(meter), a = generateFullSongArrangement(p, { seed })
    p.fullSongArrangement = a
    const bytes = exportSongMidi(p, true, true, DEFAULT_PART_PROGRAMS), midi = parseMidi(bytes)
    const bpb = parseTimeSignature(meter).beatsPerBar
    const sounds = (name: string) => midi.tracks.filter(t => t.name === name).flatMap(t => t.notes.map(n => ({
      pitch: n.pitch, start: n.startTick / midi.ppq, end: (n.startTick + n.durationTicks) / midi.ppq,
    })))
    const riff = sounds("GTR_Riff"), bass = sounds("SYN_Bass"), lead = sounds("Active Melodies")
    // 採用例を必須にするseed19と、不採用も許すseed41の両方で保存/境界を確認する。
    if (seed === 19) expect(riff.length).toBeGreaterThan(0)
    expect(bass.length).toBeGreaterThan(0)
    expect(lead.length).toBeGreaterThan(0)
    expect(riff.every(n => n.pitch >= 40 && n.pitch <= 79)).toBe(true)
    const pc = (pitch: number) => ((pitch % 12) + 12) % 12
    expect(riff.filter(n => bass.some(b => Math.min(n.end, b.end) - Math.max(n.start, b.start) > .1
      && [1, 11].includes(Math.abs(pc(n.pitch) - pc(b.pitch)))))).toEqual([])
    expect(riff.filter(n => lead.some(l => n.start < l.end && n.end > l.start && Math.abs(n.pitch - l.pitch) <= 5))).toEqual([])
    const total = Math.max(...p.sections.map(s => s.startBar + s.lengthBars - 1))
    const presence = midi.tracks.filter(t => names.has(t.name)).map(t => {
      const on = Array.from({ length: total }, (_, bar) => t.notes.some(n => n.startTick / midi.ppq < (bar + 1) * bpb
        && (n.startTick + n.durationTicks) / midi.ppq > bar * bpb + .01))
      for (let i = 1; i < on.length - 1; i++) if (on[i - 1] && !on[i] && on[i + 1]) on[i] = true
      return on
    })
    p.sections.forEach((s, i) => {
      if (i === 0 || s.role === "outro") return
      for (let d = -2; d <= 4; d++) {
        const bar = s.startBar - 1 + d
        expect(presence.filter(on => on[bar - 1] !== on[bar]).length, `${meter}/${seed}/${s.id}/${d}`).toBeLessThanOrEqual(2)
      }
    })
    const opened = normalizeProject(JSON.parse(JSON.stringify(p)))
    expect(exportSongMidi(opened, true, true, DEFAULT_PART_PROGRAMS)).toEqual(bytes)
  }, 30_000)

  it("preserves a saved riff instrument and mute through loading and regeneration", () => {
    const p = riffMeterSong("3/4"), a = generateFullSongArrangement(p, { seed: 19 })
    const riff = a.tracks.find(t => t.id === "gtr-riff")!
    expect(riff.notes.length).toBeGreaterThan(0)
    const saved = { ...a, tracks: a.tracks.map(t => t.id === "gtr-riff"
      ? { ...t, instrument: { program: 29, reason: "Saved choice" }, muted: true } : t) }
    const opened = normalizeProject(JSON.parse(JSON.stringify({ ...p, fullSongArrangement: saved })))
    const current = opened.fullSongArrangement!, after = regenerateFullSongArrangementTarget(opened, current, { trackId: "gtr-riff", sectionId: riff.notes[0].sectionId })
    expect(after.tracks.find(t => t.id === "gtr-riff")?.instrument).toEqual({ program: 29, reason: "Saved choice" })
    expect(after.tracks.find(t => t.id === "gtr-riff")?.muted).toBe(true)
    expect(after.tracks.filter(t => t.id !== "gtr-riff")).toEqual(current.tracks.filter(t => t.id !== "gtr-riff"))
    expect(exportSongMidi({ ...opened, fullSongArrangement: after }, true, true, DEFAULT_PART_PROGRAMS))
      .toEqual(exportSongMidi(opened, true, true, DEFAULT_PART_PROGRAMS))
  }, 30_000)
})
