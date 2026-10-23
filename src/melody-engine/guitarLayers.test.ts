import { describe, expect, it } from "vitest"
import { parseChordSymbol } from "@/core/chord"
import { arrangementInstrument } from "@/core/gmInstruments"
import { normalizeProject, type ComposerProject } from "@/core/project"
import { createEmptyProject } from "@/core/project"
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

  it("Padが休んでいる間は鳴らさず、音長もPadの終端までにする", () => {
    const project = song("neoclassical")
    const full = generateFullSongArrangement(project, { seed: 19 })
    const pad = full.tracks.find((track) => track.id === "syn-dark-pad")!
    const arpeggio = full.tracks.find((track) => track.id === "gtr-arpeggio")!
    const outside = arpeggio.notes.filter((note) => !pad.notes.some((p) =>
      p.sectionId === note.sectionId && note.startBeat >= p.startBeat - .5 && note.startBeat < p.startBeat + p.durationBeats + .5))
    expect(outside).toEqual([])
    // 休符を作ったPadでも、休符の中へ音を足さない
    const gapped = { ...full, tracks: full.tracks.filter((track) => !GUITAR.includes(track.id)).map((track) => track.id !== "syn-dark-pad" ? track
      : { ...track, notes: track.notes.filter((note) => note.startBeat % 16 < 8) }) }
    const added = addGuitarLayers(project, gapped).tracks.find((track) => track.id === "gtr-arpeggio")
    if (added) {
      const padNotes = gapped.tracks.find((track) => track.id === "syn-dark-pad")!.notes
      expect(added.notes.filter((note) => !padNotes.some((p) =>
        p.sectionId === note.sectionId && note.startBeat >= p.startBeat - .5 && note.startBeat < p.startBeat + p.durationBeats + .5))).toEqual([])
    }
  })

  /** 境界の測定と同じ形。ギターも管理対象に含めて、最終の音から数える。 */
  const MANAGED = new Set(["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide", "syn-stabs", "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid", "gtr-arpeggio", "gtr-strum"])
  function boundaryFixture() {
    const p = createEmptyProject("Guitar boundary")
    p.projectId = "guitar-boundary"
    p.song.key = "Cm"
    p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
    p.sections = ["verse", "pre-chorus", "chorus", "pre-chorus", "grand-chorus", "outro"].map((role, i) => ({
      id: `s${i}`, name: `Section ${i + 1}`, role: role as ComposerProject["sections"][number]["role"], startBar: 1 + i * 8, lengthBars: 8,
    }))
    p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({ id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * 8, durationBeats: 8, symbol, bass: null })))
    return p
  }
  function boundaryChanges(project: ComposerProject, tracks: ReturnType<typeof generateFullSongArrangement>["tracks"]) {
    const totalBars = Math.max(...project.sections.map((s) => s.startBar + s.lengthBars - 1))
    const presence = tracks.filter((t) => !t.muted && t.notes.length > 0 && (t.id.startsWith("str-") || MANAGED.has(t.id))).map((t) => {
      const on = Array.from({ length: totalBars }, (_, bar) => t.notes.some((n) => n.startBeat < (bar + 1) * 4 && n.startBeat + n.durationBeats > bar * 4 + .01))
      for (let i = 0; i < on.length;) { if (on[i]) { i++; continue } let j = i; while (j < on.length && !on[j]) j++; if (i > 0 && j < on.length && j - i <= 1) for (let k = i; k < j; k++) on[k] = true; i = j }
      return { id: t.id, on }
    })
    return project.sections.flatMap((section, index) => {
      const previous = project.sections[index - 1]
      if (!previous || previous.lengthBars < 8 || section.lengthBars < 8 || section.role === "outro") return []
      return Array.from({ length: 7 }, (_, k) => ({ section: section.id, offset: k - 2, changed: presence.filter((t) => t.on[section.startBar - 1 + k - 2 - 1] !== t.on[section.startBar - 1 + k - 2]).map((t) => t.id) }))
    })
  }

  it("ギターを含めても、境界の前2小節〜後4小節で1小節に交代する管理対象の層は2つまで", () => {
    for (const seed of [19, 41, 73]) {
      const project = boundaryFixture()
      const full = generateFullSongArrangement(project, { seed })
      expect(full.tracks.some((track) => GUITAR.includes(track.id)), `seed ${seed}: ギターが足されていない`).toBe(true)
      for (const bar of boundaryChanges(project, full.tracks)) {
        expect(bar.changed.length, `seed ${seed} ${bar.section} +${bar.offset}: ${bar.changed.join(", ")}`).toBeLessThanOrEqual(2)
      }
    }
  })

  it("最終の音でも、分散の開始と音長はPadが実際に鳴っている範囲に収まる(±0.05拍)", () => {
    for (const [name, project] of [["A", song("neoclassical")], ["B", song(null)], ["boundary", boundaryFixture()]] as const) {
      for (const seed of [19, 41]) {
        const full = generateFullSongArrangement(project, { seed })
        const pad = full.tracks.find((track) => track.id === "syn-dark-pad")!.notes
        const runs: Array<[number, number]> = []
        for (const [a, b] of pad.map((n): [number, number] => [n.startBeat, n.startBeat + n.durationBeats]).sort((x, y) => x[0] - y[0])) {
          const last = runs.at(-1)
          if (last && a <= last[1] + .01) last[1] = Math.max(last[1], b); else runs.push([a, b])
        }
        const outside = (full.tracks.find((track) => track.id === "gtr-arpeggio")?.notes ?? []).filter((n) =>
          !runs.some(([a, b]) => n.startBeat >= a - .05 && n.startBeat + n.durationBeats <= b + .05))
        expect(outside, `${name} seed ${seed}`).toEqual([])
      }
    }
  })
})
