import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { composerSongExchangeToProject } from "@/core/composerSongExchange"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { logicSoundRows } from "./logicProductionPackage"
import { exportSongMidi } from "./exportMelody"
import { parseMidi } from "./importMidi"

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/composer-song-exchange.v2.example.json"), "utf8"),
)

function text(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes)
}

describe("曲全体MIDI(アレンジ画面)", () => {
  const base = composerSongExchangeToProject(fixture)
  const arrangement = generateFullSongArrangement(base, { seed: 7 })
  const project = { ...base, fullSongArrangement: arrangement }
  const playing = arrangement.tracks.filter((track) => track.notes.length > 0)

  it("全曲アレンジのパートも1つのファイルに入れ、ミュート中のパートは入れない", () => {
    expect(playing.length).toBeGreaterThan(1)
    const withArrangement = text(exportSongMidi(project, true, true))
    for (const track of playing) expect(withArrangement).toContain(track.name)
    expect(text(exportSongMidi(project, true))).not.toContain(playing[0].name)

    const muted = {
      ...project,
      fullSongArrangement: {
        ...arrangement,
        tracks: arrangement.tracks.map((track) => (track.id === playing[0].id ? { ...track, muted: true } : track)),
      },
    }
    expect(text(exportSongMidi(muted, true, true))).not.toContain(playing[0].name)
  })

  it("Logic Proの音源表は、曲全体MIDIのトラック名と同じ名前で並ぶ", () => {
    const midi = text(exportSongMidi(project, true, true))
    const rows = logicSoundRows(project)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(midi).toContain(row.trackName)
      expect(row.product.length).toBeGreaterThan(0)
      expect(row.setting.length).toBeGreaterThan(0)
    }
    expect(rows.map((row) => row.trackName)).toEqual(expect.arrayContaining(playing.map((track) => track.name)))
  })

  it("試聴用の細かな揺らぎはグリッドへ戻して書き出す(Logic Proで拍とそろう)", () => {
    const humanized = {
      ...project,
      fullSongArrangement: {
        ...arrangement,
        tracks: arrangement.tracks.map((track) => ({
          ...track,
          notes: track.notes.map((note, index) => ({ ...note, startBeat: note.startBeat + (index % 2 === 0 ? 0.012 : -0.009) })),
        })),
      },
    }
    const song = parseMidi(exportSongMidi(humanized, true, true))
    const notes = song.tracks.flatMap((track) => track.notes)
    const onGrid = (tick: number) => tick % (song.ppq / 4) === 0 || tick % (song.ppq / 3) === 0
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.filter((note) => !onGrid(note.startTick)).length / notes.length).toBeLessThan(0.02)
  })
})
