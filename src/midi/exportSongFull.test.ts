import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { composerSongExchangeToProject } from "@/core/composerSongExchange"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { logicSoundPalette, logicSoundRows } from "./logicProductionPackage"
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
      expect(row.preset.length).toBeGreaterThan(0)
      expect(row.preset).not.toMatch(/dark mono bass|soft poly pad|dry electronic kit|muted sequence/i)
      expect(row.volumeDb).toBeLessThanOrEqual(0)
      expect(row.volumeDb).toBeGreaterThanOrEqual(-24)
      expect(row.setting.length).toBeGreaterThan(0)
    }
    expect(rows.some((row) => row.product === "Repro-1" && row.preset.includes("/"))).toBe(true)
    expect(rows.some((row) => row.product === "Repro-5" && row.preset.includes("Pads - Orchestral /"))).toBe(true)
    expect(rows.some((row) => row.product === "Kontakt 8" && row.preset.startsWith("Session Strings Pro 2 /"))).toBe(true)
    expect(rows.some((row) => row.preset.includes("Celli Mod - Chamber") || row.preset.includes("Celli Mod - Dry Strings"))).toBe(true)
    expect(rows.every((row) => !/Session Strings Pro 2 \/ (?:Celli|Violas|Basses|Violins) \//.test(row.preset))).toBe(true)
    expect(rows.some((row) => row.product === "Battery 4" && row.preset.includes("Elektro 500 Kit"))).toBe(true)
    expect(rows.every((row) => row.preset !== "Factory Library > Kits")).toBe(true)
    // Kontakt内ライブラリはLogic上では同じ「Kontakt 8」なので、製品名の水増しをしない。
    expect(new Set(rows.map((row) => row.product).filter((product) => product !== "Kontakt 8")).size).toBeGreaterThan(2)
    expect(new Set(rows.map((row) => row.preset)).size).toBeGreaterThan(5)
    expect(rows.map((row) => row.trackName)).toEqual(expect.arrayContaining(playing.map((track) => track.name)))
  })

  it("全曲の方向性を変えず、弦の推奨音源をKontakt内で分担する", () => {
    const rhythmic = logicSoundRows({
      ...project,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId: "rhythmic-propulsion" },
    })
    const cinematic = logicSoundRows({
      ...project,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId: "controlled-escalation" },
    })
    const spacious = logicSoundRows({
      ...project,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId: "preserve-space" },
    })

    expect(rhythmic.some((row) => row.preset === "Action Strings 2")).toBe(true)
    expect(cinematic.some((row) => row.preset === "LUX Orchestral Strings Elements")).toBe(true)
    expect(spacious.some((row) => row.preset === "Emotive Strings")).toBe(true)
    expect(rhythmic.some((row) => row.preset === "Session Guitarist - Electric Mint")).toBe(true)
    expect(new Set(rhythmic.map((row) => row.preset))).not.toEqual(new Set(cinematic.map((row) => row.preset)))
    expect(Array.from(exportSongMidi({
      ...project,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId: "rhythmic-propulsion" },
    }, true, true))).toEqual(Array.from(exportSongMidi({
      ...project,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId: "controlled-escalation" },
    }, true, true)))
  })

  it("同じ方向性でも、実際のパート構成に合わせて音の主役を変える", () => {
    const workspace = { brief: "", selectedDirectionId: "balanced-architecture" as const }
    const stringLed = {
      ...project,
      arrangementDirectorWorkspace: workspace,
      fullSongArrangement: {
        ...arrangement,
        tracks: arrangement.tracks.filter((track) => track.id.startsWith("str-")),
      },
    }
    const rhythmLed = {
      ...project,
      arrangementDirectorWorkspace: workspace,
      fullSongArrangement: {
        ...arrangement,
        tracks: arrangement.tracks.filter((track) => track.id.startsWith("dr-")),
      },
    }
    const stringPalette = logicSoundPalette(stringLed)
    const rhythmPalette = logicSoundPalette(rhythmLed)

    expect(stringPalette.dominantFamily).toBe("strings")
    expect(rhythmPalette.dominantFamily).toBe("percussion")
    expect(stringPalette.coreSounds).not.toEqual(rhythmPalette.coreSounds)
    const stringRows = logicSoundRows(stringLed)
    const rhythmRows = logicSoundRows(rhythmLed)
    expect(stringRows.some((row) => /Emotive Strings|LUX Orchestral Strings|Session Strings Pro 2/.test(row.preset))).toBe(true)
    expect(new Set(stringRows.filter((row) => /Strings|String Ensemble/.test(row.preset)).map((row) => row.preset)).size).toBeGreaterThanOrEqual(3)
    expect(rhythmRows.some((row) => /Battery 4|Studio Drummer|Butch Vig Drums/.test(`${row.product} ${row.preset}`))).toBe(true)
    expect(new Set(rhythmRows.filter((row) => /Battery 4|Studio Drummer|Butch Vig Drums|Session Percussionist|Damage/.test(`${row.product} ${row.preset}`)).map((row) => row.preset)).size).toBeGreaterThanOrEqual(3)
  })

  it("音源の希望が明記された場合は、方向性を変えず音の世界へ反映する", () => {
    const stringRequested = {
      ...project,
      arrangementDirectorWorkspace: {
        brief: "ストリングスを主体にして、後半へ向けて広げたい",
        selectedDirectionId: "controlled-escalation" as const,
      },
    }
    const bandRequested = {
      ...project,
      arrangementDirectorWorkspace: {
        brief: "ギターと生ドラム主体のバンド感にしたい",
        selectedDirectionId: "controlled-escalation" as const,
      },
    }
    const stringPalette = logicSoundPalette(stringRequested)
    const bandPalette = logicSoundPalette(bandRequested)

    expect(stringPalette.dominantFamily).toBe("strings")
    expect(bandPalette.dominantFamily).toBe("band")
    expect(stringPalette.reason).toContain("指示内容")
    expect(bandPalette.coreSounds.some((sound) => sound.includes("Guitarist"))).toBe(true)
    expect(Array.from(exportSongMidi(stringRequested, true, true))).toEqual(Array.from(exportSongMidi(bandRequested, true, true)))
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
