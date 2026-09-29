import { describe, expect, it } from "vitest"
import {
  arrangementTrackProgram,
  assignGmChannels,
  DEFAULT_SOUND_SETTINGS,
  GM_INSTRUMENT_CHOICES,
  GM_PROGRAM_FILES,
  gmFileForProgram,
  normalizeSoundSettings,
} from "./gmInstruments"

describe("GM の楽器と設定", () => {
  it("128音色の並びが GM のプログラム番号と一致する", () => {
    expect(GM_PROGRAM_FILES).toHaveLength(128)
    expect(gmFileForProgram(0)).toBe("acoustic_grand_piano")
    expect(gmFileForProgram(11)).toBe("vibraphone")
    expect(gmFileForProgram(42)).toBe("cello")
    expect(gmFileForProgram(73)).toBe("flute")
    expect(gmFileForProgram(89)).toBe("pad_2_warm")
    expect(gmFileForProgram(108)).toBe("kalimba")
  })

  it("画面で選べる楽器は、重複のない GM の番号", () => {
    const programs = GM_INSTRUMENT_CHOICES.map((choice) => choice.program)
    expect(new Set(programs).size).toBe(programs.length)
    expect(programs.every((program) => program >= 0 && program <= 127)).toBe(true)
  })

  it("保存された設定の壊れた値や足りない項目は、既定値で補う", () => {
    expect(normalizeSoundSettings(null)).toEqual(DEFAULT_SOUND_SETTINGS)
    const normalized = normalizeSoundSettings({ playback: "gm", midiExport: "x", programs: { melody: 73, chords: 200, counter: "a" } })
    expect(normalized.playback).toBe("gm")
    expect(normalized.midiExport).toBe("logic")
    expect(normalized.programs.melody).toBe(73)
    expect(normalized.programs.chords).toBe(DEFAULT_SOUND_SETTINGS.programs.chords)
    expect(normalized.programs.counter).toBe(DEFAULT_SOUND_SETTINGS.programs.counter)
  })

  it("GM向けのチャンネルは、ドラムを10ch、ほかを1chから順に(10chを飛ばして)割り当てる", () => {
    const assigned = assignGmChannels([0, "drums", ...Array.from({ length: 10 }, (_, index) => index + 1)])
    expect(assigned[0]).toEqual({ channel: 0, program: 0 })
    expect(assigned[1]).toEqual({ channel: 9, program: null })
    expect(assigned.slice(2).map((entry) => entry.channel)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11])
  })

  it("全曲アレンジのドラムはドラムチャンネル、ほかは役割に合わせた楽器", () => {
    expect(arrangementTrackProgram("dr-kick")).toBe("drums")
    expect(arrangementTrackProgram("str-cello")).toBe(42)
    expect(arrangementTrackProgram("syn-bass")).toBe(38)
  })
})
