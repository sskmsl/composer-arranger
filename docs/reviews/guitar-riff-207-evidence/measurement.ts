import { it } from "vitest"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { createEmptyProject, normalizeProject } from "@/core/project"
import { DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { arrangementSoundedTracks, exportArrangementMidi } from "@/midi/exportArrangement"
import { withGmSounds } from "@/midi/gmExport"
import { parseMidi } from "@/midi/importMidi"
it("records timings and actual GM allocation without changing production or fixtures", () => {
  const p = createEmptyProject("Riff performance measurement")
  p.projectId = "riff-performance"
  p.song.key = "Am"
  p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
  const roles = ["intro", "verse", "pre-chorus", "chorus", "verse", "pre-chorus", "chorus", "breakdown-chorus", "bridge", "pre-chorus", "grand-chorus", "outro", "outro"] as const
  p.sections = roles.map((role, index) => ({ id: `p${index}`, name: `Section ${index}`, role, startBar: 1 + 16 * index, lengthBars: 16 }))
  p.chords = p.sections.flatMap((section) => Array.from({ length: 8 }, (_, index) => ({ id: `${section.id}:${index}`, sectionId: section.id, startBeat: index * 8, durationBeats: 8, symbol: ["Am", "F", "C", "G"][index % 4], bass: null })))
  generateFullSongArrangement(p, { seed: 19 })
  const times: number[] = []
  for (let index = 0; index < 5; index++) {
    const start = performance.now()
    generateFullSongArrangement(p, { seed: 19 })
    times.push(performance.now() - start)
  }
  const gm = []
  for (const genre of ["neoclassical", "electronica", null] as const) {
    for (const seed of [19, 41, 73]) {
      let project = arrangementReviewSong("A")
      project.song.genreBlend = genre ? [{ id: genre, weight: 1 }] : []
      let json = JSON.stringify(project)
      project.sections.forEach((section, index) => { json = json.split(section.id).join(`r${index}`) })
      project = normalizeProject(JSON.parse(json))
      const arrangement = generateFullSongArrangement(project, { seed })
      const sounded = arrangementSoundedTracks(arrangement)
      const tracks = withGmSounds(sounded, DEFAULT_PART_PROGRAMS)
      const channels = new Set(tracks.flatMap((track) => track.notes.map((note) => track.channel ?? note.channel)).filter((channel) => channel !== 9))
      const events = tracks.flatMap((track) => track.notes.flatMap((note) => {
        const channel = track.channel ?? note.channel
        return channel === 9 ? [] : [[note.start, 1, channel], [note.start + note.duration, -1, channel]]
      })).sort((a,b)=>a[0]-b[0] || a[1]-b[1])
      const active = new Map<number,number>()
      let peakChannels = 0
      for (const [,delta,channel] of events) {
        const count = (active.get(channel) ?? 0) + delta
        if (count === 0) active.delete(channel); else active.set(channel,count)
        peakChannels = Math.max(peakChannels, active.size)
      }
      const programs = new Set(sounded.map((entry) => entry.sound).filter((sound) => typeof sound === "number"))
      const midi = parseMidi(exportArrangementMidi(project, arrangement, DEFAULT_PART_PROGRAMS))
      gm.push({ genre, seed, riffNotes: arrangement.tracks.find((track) => track.id === "gtr-riff")?.notes.length ?? 0,
        channels: channels.size, peakChannels, programs: programs.size, exportedNotes: midi.tracks.reduce((sum, track) => sum + track.notes.length, 0),
        quality: arrangement.quality?.score, audition: arrangement.audition?.score })
    }
  }
  const extra = []
  for (const seed of [1, 19, 41, 73, 101]) {
    let project = arrangementReviewSong("B")
    let json = JSON.stringify(project)
    project.sections.forEach((section,index)=>{ json = json.split(section.id).join(`b${index}`) })
    project = normalizeProject(JSON.parse(json))
    const result = generateFullSongArrangement(project,{seed})
    const hash = createHash("sha256").update(JSON.stringify(result.tracks.map((track)=>[track.id,track.notes.map((n)=>[n.pitch,n.startBeat,n.durationBeats,n.velocity,n.sectionId])]))).digest("hex")
    extra.push({seed,riffNotes:result.tracks.find((track)=>track.id === "gtr-riff")?.notes.length ?? 0,hash})
  }
  writeFileSync(`/private/tmp/pr207-measure-${process.env.RIFF_MEASURE_TAG}.json`, JSON.stringify({ extra, times, median: [...times].sort((a,b)=>a-b)[2], gm }, null, 2))
}, 120_000)
