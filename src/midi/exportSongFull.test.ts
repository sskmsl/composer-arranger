import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { composerSongExchangeToProject } from "@/core/composerSongExchange"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { logicSoundPalette, logicSoundRows } from "./logicProductionPackage"
import { exportSongMidi } from "./exportMelody"
import { exportArrangementMidi, exportArrangementTrackMidi } from "./exportArrangement"
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
      if (row.product === "Kontakt 8") {
        expect(row.preset).toContain(" / ")
        expect(row.preset).not.toMatch(/^(?:Emotive Strings|LUX Orchestral Strings Elements|Session Strings Pro 2|Studio Drummer|Butch Vig Drums|Session Percussionist|Damage|Piano Colors|Playbox|Schema Dark|Schema Light|Straylight|Analog Dreams|Ethereal Earth|Noire)$/)
        expect(row.preset).not.toMatch(/Factory (?:Kit|Preset|Presets)$/)
      }
    }
    expect(rows.some((row) => row.product === "Repro-1" && row.preset.includes("/"))).toBe(true)
    expect(rows.some((row) => row.product === "Repro-5" && row.preset.includes("Pads - Orchestral /"))).toBe(true)
    expect(rows.some((row) => row.product === "Kontakt 8" && row.preset.startsWith("Session Strings Pro 2 /"))).toBe(true)
    expect(rows.some((row) => row.preset.includes("Celli Mod - Chamber") || row.preset.includes("Celli Mod - Dry Strings"))).toBe(true)
    expect(rows.filter((row) => row.preset.startsWith("Session Strings Pro 2 /"))
      .every((row) => / \/ [^/]+$/.test(row.preset))).toBe(true)
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

    expect(rhythmic.some((row) => row.preset.includes("Session Strings Pro 2 / Violins - Modern / Violins Mod - Dry Strings"))).toBe(true)
    expect(cinematic.some((row) => row.preset.startsWith("LUX Orchestral Strings Elements /"))).toBe(true)
    expect(spacious.some((row) => row.preset.startsWith("Emotive Strings /"))).toBe(true)
    expect(rhythmic.map((row) => row.preset)).toContain("Session Guitarist - Electric Mint / Melody / Clean and Wide (Melody)")
    expect(new Set(rhythmic.map((row) => row.preset))).not.toEqual(new Set(cinematic.map((row) => row.preset)))
    expect(Array.from(exportSongMidi({
      ...project,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId: "rhythmic-propulsion" },
    }, true, true))).toEqual(Array.from(exportSongMidi({
      ...project,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId: "controlled-escalation" },
    }, true, true)))
  })

  it("5つの方向カードは、保存された方向に応じて音の世界または音源表を変える", () => {
    const directions = ["preserve-space", "controlled-escalation", "rhythmic-propulsion", "motif-relay", "balanced-architecture"] as const
    const signatures = directions.map((selectedDirectionId) => {
      const target = { ...project, arrangementDirectorWorkspace: { brief: "", selectedDirectionId } }
      const palette = logicSoundPalette(target)
      return JSON.stringify({
        title: palette.title,
        description: palette.description,
        rows: logicSoundRows(target).map((row) => [row.trackName, row.product, row.preset]),
      })
    })
    expect(new Set(signatures).size).toBe(5)
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

  it("曲の速さ・反復・余白と5方向の組み合わせで主役を一種類に固定しない", () => {
    const withShape = (tempo: number, rest: number, repetition: number, energyScale: number) => ({
      ...project,
      song: { ...project.song, tempo },
      fullSongArrangement: {
        ...arrangement,
        analysis: {
          ...arrangement.analysis,
          bpm: tempo,
          sections: arrangement.analysis.sections.map((section, index) => ({
            ...section,
            melodyRestRatio: rest,
            melodyRepetition: repetition,
            chordRepetition: repetition,
            energy: Math.min(100, Math.round(index * energyScale)),
          })),
        },
      },
    })
    const songs = [
      withShape(68, 0.72, 0.1, 2),
      withShape(148, 0.04, 0.92, 1),
      withShape(96, 0.3, 0.35, 12),
      withShape(112, 0.18, 0.55, 5),
    ]
    const directions = ["preserve-space", "controlled-escalation", "rhythmic-propulsion", "motif-relay", "balanced-architecture"] as const
    const families = songs.flatMap((song) => directions.map((selectedDirectionId) => logicSoundPalette({
      ...song,
      arrangementDirectorWorkspace: { brief: "", selectedDirectionId },
    }).dominantFamily))
    expect(new Set(families).size).toBeGreaterThan(1)
    expect(new Set(families.slice(0, 5))).not.toEqual(new Set(families.slice(5, 10)))
    expect(families[4]).not.toBe(families[9])
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

  it.each([
    ["弦主体", "strings"],
    ["ピアノ主体", "piano"],
    ["シンセ主体", "synth"],
    ["ギターと生ドラム主体", "band"],
    ["ストリングスなしでピアノ主体", "piano"],
  ] as const)("音源指示を否定も含めて読む: %s", (brief, family) => {
    const target = { ...project, arrangementDirectorWorkspace: { brief, selectedDirectionId: "balanced-architecture" as const } }
    expect(logicSoundPalette(target).dominantFamily).toBe(family)
  })

  it("除外された音源を主役にも脇役にもせず、併記された音源を優先する", () => {
    const noStrings = logicSoundPalette({
      ...project,
      arrangementDirectorWorkspace: { brief: "弦を使わない", selectedDirectionId: "controlled-escalation" },
    })
    const noDrums = logicSoundPalette({
      ...project,
      arrangementDirectorWorkspace: { brief: "ドラムなしで静かに", selectedDirectionId: "rhythmic-propulsion" },
    })
    const pianoAndStrings = logicSoundPalette({
      ...project,
      arrangementDirectorWorkspace: { brief: "ピアノと弦で", selectedDirectionId: "balanced-architecture" },
    })
    expect([noStrings.dominantFamily, ...noStrings.supportingFamilies]).not.toContain("strings")
    expect([noDrums.dominantFamily, ...noDrums.supportingFamilies]).not.toContain("percussion")
    expect(["piano", "strings"]).toContain(pianoAndStrings.dominantFamily)
  })

  it("音源希望と方向だけを変えても3種類のMIDI書き出しを1バイトも変えない", () => {
    const directions = ["preserve-space", "controlled-escalation", "rhythmic-propulsion", "motif-relay", "balanced-architecture"] as const
    const trackId = playing[0].id
    const exported = directions.map((selectedDirectionId, index) => {
      const target = {
        ...project,
        arrangementDirectorWorkspace: { brief: index % 2 ? "ピアノ主体" : "ストリングスなしでシンセ主体", selectedDirectionId },
      }
      return {
        arrangement: exportArrangementMidi(target, arrangement),
        song: exportSongMidi(target, true, true),
        track: exportArrangementTrackMidi(target, arrangement, trackId),
      }
    })
    for (const key of ["arrangement", "song", "track"] as const) {
      exported.slice(1).forEach((value) => expect(Array.from(value[key])).toEqual(Array.from(exported[0][key])))
    }
  })

  it("リズム型とシンセ主体でもドラムを役割別の3種類以上へ分ける", () => {
    const targets = [
      { brief: "", selectedDirectionId: "rhythmic-propulsion" as const },
      { brief: "シンセ主体", selectedDirectionId: "balanced-architecture" as const },
    ]
    const drumNames = new Set(arrangement.tracks.filter((track) => track.id.startsWith("dr-")).map((track) => track.name))
    for (const arrangementDirectorWorkspace of targets) {
      const drums = logicSoundRows({ ...project, arrangementDirectorWorkspace })
        .filter((row) => drumNames.has(row.trackName))
      expect(new Set(drums.map((row) => `${row.product}:${row.preset}`)).size).toBeGreaterThanOrEqual(3)
    }
  })

  it("提案する音源は所有一覧だけに限定する", () => {
    const allowed = /Battery 4|Repro-[15]|Session Strings Pro 2|LUX Orchestral Strings Elements|Emotive Strings|Action Strings 2|Symphony Essentials (?:String Ensemble|Percussion)|Session Guitarist - |Session Bassist - |Noire|Una Corda|Piano Colors|Schema (?:Dark|Light)|Straylight|Ethereal Earth|Playbox|Analog Dreams|Studio Drummer|Butch Vig Drums|Session Percussionist|Damage/
    const briefs = ["", "弦主体", "ピアノ主体", "シンセ主体", "ギターと生ドラム主体", "ストリングスなしでピアノ主体"]
    const directions = ["preserve-space", "controlled-escalation", "rhythmic-propulsion", "motif-relay", "balanced-architecture"] as const
    for (const brief of briefs) for (const selectedDirectionId of directions) {
      const target = { ...project, arrangementDirectorWorkspace: { brief, selectedDirectionId } }
      for (const sound of logicSoundPalette(target).coreSounds) expect(sound).toMatch(allowed)
      for (const row of logicSoundRows(target)) {
        expect(`${row.product} ${row.preset}`).toMatch(allowed)
        expect(row.preset).not.toContain("Scarbee Rickenbacker Bass")
      }
    }
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
