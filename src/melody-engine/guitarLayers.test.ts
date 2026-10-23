import { describe, expect, it } from "vitest"
import { parseChordSymbol } from "@/core/chord"
import { arrangementInstrument } from "@/core/gmInstruments"
import { normalizeProject, type ComposerProject } from "@/core/project"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { arrangementSoundedTracks } from "@/midi/exportArrangement"
import { logicSoundRows } from "@/midi/logicProductionPackage"
import { addGuitarLayers, generateFullSongArrangement } from "./arrangementGenerator"

function song(genre: "neoclassical" | "electronica" | null) {
  const project = arrangementReviewSong("A")
  project.song.genreBlend = genre ? [{ id: genre, weight: 1 }] : []
  return project
}
const GUITAR = ["gtr-arpeggio", "gtr-strum"]

describe("ギターの層は既存のトラックを置き換えず、足す", () => {
  it("非打楽器のギター2層が増え、既存のトラックと打楽器の音は変わらない", () => {
    const project = song("neoclassical")
    const full = generateFullSongArrangement(project, { seed: 19 })
    const guitar = full.tracks.filter((track) => GUITAR.includes(track.id))
    expect(guitar.map((track) => track.id).sort()).toEqual(GUITAR)
    expect(guitar.every((track) => track.family === "guitar" && track.notes.length > 50)).toBe(true)

    const base = { ...full, tracks: full.tracks.filter((track) => !GUITAR.includes(track.id)) }
    const again = addGuitarLayers(project, base)
    expect(again.tracks.filter((track) => !GUITAR.includes(track.id))).toEqual(base.tracks)
    expect(again.tracks.filter((track) => GUITAR.includes(track.id)).map((track) => track.id).sort()).toEqual(GUITAR)
    const drumEvents = (tracks: typeof full.tracks) => tracks.filter((t) => t.family === "drums").reduce((sum, t) => sum + t.notes.length, 0)
    expect(drumEvents(full.tracks)).toBe(drumEvents(base.tracks))
  })

  it("分散はコードの構成音だけを、ギターの音域で弾く", () => {
    const project = song("neoclassical")
    const full = generateFullSongArrangement(project, { seed: 19 })
    const arpeggio = full.tracks.find((track) => track.id === "gtr-arpeggio")!
    const beatsPerBar = 4
    const wrong = arpeggio.notes.filter((note) => {
      const section = project.sections.find((candidate) => candidate.id === note.sectionId)!
      const local = note.startBeat - (section.startBar - 1) * beatsPerBar
      const chord = project.chords.filter((candidate) => candidate.sectionId === section.id)
        .find((candidate) => candidate.startBeat <= local + .001 && local < candidate.startBeat + candidate.durationBeats - .001)
      const parsed = chord && parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      return !parsed || !parsed.tones.some((tone) => tone.pitchClass === note.pitch % 12)
    })
    expect(wrong).toEqual([])
    expect(Math.min(...arpeggio.notes.map((note) => note.pitch))).toBeGreaterThanOrEqual(45)
    expect(Math.max(...arpeggio.notes.map((note) => note.pitch))).toBeLessThanOrEqual(79)
  })

  it("試聴・GM書き出し・制作ガイドが、同じギターの音色を使う", () => {
    const project = song("neoclassical")
    project.fullSongArrangement = generateFullSongArrangement(project, { seed: 19 })
    expect(project.fullSongArrangement.tracks.filter((t) => GUITAR.includes(t.id)).map((t) => arrangementInstrument(t))).toEqual([24, 27])
    expect(arrangementSoundedTracks(project.fullSongArrangement).filter((t) => t.track.name?.startsWith("GTR")).map((t) => t.sound)).toEqual([24, 27])
    const rows = logicSoundRows(project).filter((row) => row.trackName.startsWith("GTR"))
    expect(rows.map((row) => row.preset)).toEqual([
      expect.stringContaining("Session Guitarist - Picked Nylon"),
      expect.stringContaining("Session Guitarist - Electric Mint"),
    ])
  })

  it("保存して読み直しても、ギターの層が残る", () => {
    const project = song("neoclassical")
    project.fullSongArrangement = generateFullSongArrangement(project, { seed: 19 })
    const reloaded = normalizeProject(JSON.parse(JSON.stringify(project))) as ComposerProject
    expect(reloaded.fullSongArrangement!.tracks.filter((t) => GUITAR.includes(t.id)).map((t) => t.notes.length))
      .toEqual(project.fullSongArrangement.tracks.filter((t) => GUITAR.includes(t.id)).map((t) => t.notes.length))
  })

  it("リズムが強く反復の多い電子寄りの曲と、音の指示がある場合は足さない", () => {
    const electronic = song("electronica")
    expect(generateFullSongArrangement(electronic, { seed: 19 }).tracks.some((track) => GUITAR.includes(track.id))).toBe(false)
    const project = song("neoclassical")
    const full = generateFullSongArrangement(project, { seed: 19 })
    const base = { ...full, tracks: full.tracks.filter((track) => !GUITAR.includes(track.id)) }
    const instructed = { ...base, plan: { ...base.plan, directive: { intention: "", soundInstruction: { enabled: true } } } } as typeof base
    expect(addGuitarLayers(project, instructed)).toBe(instructed)
  })

  it("ジャンルや参照が無い曲にも足す", () => {
    const full = generateFullSongArrangement(song(null), { seed: 19 })
    expect(full.tracks.filter((track) => GUITAR.includes(track.id)).length).toBe(2)
  })
})
