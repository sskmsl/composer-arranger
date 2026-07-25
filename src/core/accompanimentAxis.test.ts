import { describe, expect, it } from "vitest"
import type { ChordEvent, ComposerProject } from "@/core/project"
import { createEmptyProject } from "@/core/project"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import type { Accompaniment, LeadContent } from "@/core/sectionContent"
import { accompanimentEnabled, DEFAULT_SECTION_CONTENT, partRoleFor } from "@/core/sectionContent"
import { fallbackPlanFor } from "@/core/sectionLayers"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { exportSongMidi } from "@/midi/exportMelody"

function note(startBeat: number, pitch: number): MelodyNote {
  return { id: `n${startBeat}`, startBeat, durationBeats: 1, pitch, velocity: 80, locks: [] }
}

function variant(sectionId: string, lead: LeadContent, notes: MelodyNote[]): MelodyVariant {
  const content = lead === "auto" ? "melody" : lead
  return {
    id: `v-${sectionId}`,
    name: "t",
    sectionId,
    sourceMode: "generate",
    notes,
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "2.1",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "b",
    createdAt: new Date().toISOString(),
    leadContent: content,
    layers: [
      {
        id: `v-${sectionId}:primary`,
        partRole: partRoleFor(content),
        content,
        plan: fallbackPlanFor(content, notes),
        notes,
        kind: "primary",
      },
    ],
  }
}

function projectWith(accompaniment: Accompaniment, lead: LeadContent = "none"): ComposerProject {
  const chords: ChordEvent[] = [
    { id: "c1", sectionId: "s1", startBeat: 0, durationBeats: 4, symbol: "Am", bass: null },
    { id: "c2", sectionId: "s1", startBeat: 4, durationBeats: 4, symbol: "F", bass: null },
  ]
  return {
    ...createEmptyProject("t"),
    sections: [
      {
        id: "s1",
        name: "Intro",
        role: "intro",
        startBar: 1,
        lengthBars: 2,
        content: { ...DEFAULT_SECTION_CONTENT, lead, accompaniment },
      },
    ],
    chords,
    melodyVariants: [variant("s1", lead, lead === "none" ? [] : [note(0, 69)])],
    sectionMelodyAssignments: { s1: "v-s1" },
  }
}

/** Note On のチャンネル集合(SMFを実際にパースする) */
function noteOnChannels(bytes: Uint8Array): Set<number> {
  const channels = new Set<number>()
  let cursor = 14
  while (cursor < bytes.length) {
    const length =
      (bytes[cursor + 4] << 24) | (bytes[cursor + 5] << 16) | (bytes[cursor + 6] << 8) | bytes[cursor + 7]
    let p = cursor + 8
    const end = p + length
    while (p < end) {
      // delta time (VLQ)
      for (;;) {
        const b = bytes[p++]
        if ((b & 0x80) === 0) break
      }
      const status = bytes[p++]
      if (status === 0xff) {
        p++
        let len = 0
        for (;;) {
          const b = bytes[p++]
          len = len * 128 + (b & 0x7f)
          if ((b & 0x80) === 0) break
        }
        p += len
        continue
      }
      const pitch = bytes[p++]
      const velocity = bytes[p++]
      void pitch
      if ((status & 0xf0) === 0x90 && velocity > 0) channels.add(status & 0x0f)
    }
    cursor = end
  }
  return channels
}

describe("PR#43 fix2 / accompaniment軸が再生・MIDIへ反映される", () => {
  it("accompanimentEnabled は none のときだけ false", () => {
    expect(accompanimentEnabled({ content: { ...DEFAULT_SECTION_CONTENT, accompaniment: "chords" } })).toBe(true)
    expect(accompanimentEnabled({ content: { ...DEFAULT_SECTION_CONTENT, accompaniment: "none" } })).toBe(false)
    // 旧セクション(content未設定)は既定でコードあり = 従来の挙動
    expect(accompanimentEnabled({})).toBe(true)
    expect(accompanimentEnabled(undefined)).toBe(true)
  })

  it("Silence(none+none)は曲全体再生の素材からコードが除かれる", () => {
    const material = buildSongPlaybackMaterial(projectWith("none"))
    expect(material.chords).toHaveLength(0)
    expect(material.melody).toHaveLength(0)
  })

  it("Chords Only(none+chords)はコードが残る", () => {
    const material = buildSongPlaybackMaterial(projectWith("chords"))
    expect(material.chords).toHaveLength(2)
    expect(material.melody).toHaveLength(0)
  })

  it("SilenceとChords Onlyが曲全体再生で異なる結果になる", () => {
    const silence = buildSongPlaybackMaterial(projectWith("none"))
    const chordsOnly = buildSongPlaybackMaterial(projectWith("chords"))
    expect(silence.chords.length).not.toBe(chordsOnly.chords.length)
  })

  it("曲全体MIDIでもSilenceのコードが書き出されない", () => {
    // includeChords=true でも、そのセクションが伴奏なしならコードは出ない
    expect(noteOnChannels(exportSongMidi(projectWith("none"), true)).size).toBe(0)
    expect(noteOnChannels(exportSongMidi(projectWith("chords"), true))).toEqual(new Set([0]))
  })

  it("Drone + 伴奏なし でも伴奏トラックのみが鳴りコードは出ない", () => {
    const project = projectWith("none", "drone")
    const material = buildSongPlaybackMaterial(project)
    expect(material.chords).toHaveLength(0)
    // Droneは伴奏パートなので accompaniment 側へ入る
    expect(material.accompaniment).toHaveLength(1)
    // 伴奏パートもMelodyと同じChannel 1(内部値0)で書き出す
    expect(noteOnChannels(exportSongMidi(project, true))).toEqual(new Set([0]))
  })
})
