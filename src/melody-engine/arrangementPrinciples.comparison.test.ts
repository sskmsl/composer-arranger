import { describe, expect, it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordSymbol } from "@/core/chord"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { generateFullSongArrangement } from "./arrangementGenerator"

/**
 * 同じ曲・同じ seed で、音像が標準の場合と「奥行き・長い余韻」の場合のアレンジを比べる(変更前後の比較にも使う)。
 * 確かめること: 漂わせる場面ほど背景の和音が長く持続し付加音の色が残る / パートは増えない /
 * 主旋律の休みで核のリズムを受け継ぐのは1セクション1回まで / 全パートが同時に動く所が増えない。
 * 環境変数 ARRANGEMENT_COMPARISON_OUT にファイル名を渡すと、測った値を書き出す。
 */

/** 三和音だけのコードと、休符のある主旋律(核 3音 → 休み)を持つ曲 */
function melodicProject(): ComposerProject {
  const base = createEmptyProject("Principles")
  const sections: ComposerProject["sections"] = [
    { id: "intro", name: "Intro", role: "intro", startBar: 1, lengthBars: 4 },
    { id: "verse", name: "Verse 1", role: "verse", startBar: 5, lengthBars: 8 },
    { id: "pre", name: "Pre", role: "pre-chorus", startBar: 13, lengthBars: 4 },
    { id: "chorus", name: "Chorus", role: "chorus", startBar: 17, lengthBars: 8 },
    { id: "verse-2", name: "Verse 2", role: "verse", startBar: 25, lengthBars: 8 },
    { id: "chorus-2", name: "Chorus 2", role: "chorus", startBar: 33, lengthBars: 8 },
    { id: "outro", name: "Outro", role: "outro", startBar: 41, lengthBars: 4 },
  ]
  const progression = ["Am", "F", "C", "G"]
  const chords = sections.flatMap((section) => Array.from({ length: section.lengthBars }, (_, bar) => ({
    id: `${section.id}:${bar}`, sectionId: section.id, startBeat: bar * 4, durationBeats: 4, symbol: progression[bar % 4], bass: null,
  })))
  const melodyNotes = sections.filter((section) => !["intro", "outro"].includes(section.role)).flatMap((section) => {
    const offset = (section.startBar - 1) * 4
    return Array.from({ length: section.lengthBars / 2 }, (_, pair) => {
      const at = offset + pair * 8
      const lift = pair === 2 ? 2 : 0
      return [
        [at, .5, 69 + lift, 82, 0], [at + .5, .5, 72 + lift, 82, 0], [at + 1, 1, 76 + lift, 82, 0],
        [at + 2.5, 1, 74, 82, 0], [at + 4, 2, 72, 82, 0],
      ] as [number, number, number, number, number][]
    }).flat()
  })
  return {
    ...base, sections, chords,
    sourceImport: {
      type: "midi", sourceKind: "external-song", fileName: "principles.mid", importedAt: "2026-09-25T00:00:00.000Z",
      format: 1, ppq: 480, trackCount: 2, melodyTrackName: "Lead", melodyTrackConfidence: 1,
      chordInferenceConfidence: 1, sectionsFromMarkers: true, warnings: [],
    },
    importedArrangement: {
      version: "1.0.0", sourceKind: "external-song", totalBeats: 176,
      tracks: [{ sourceTrackIndex: 1, name: "Lead", role: "melody", notes: melodyNotes }],
    },
  }
}

const base = melodicProject()
const variants: Record<string, ComposerProject> = {
  neutral: { ...base, song: { ...base.song, aesthetic: { image: "neutral", amount: 0 } } },
  atmospheric: { ...base, song: { ...base.song, aesthetic: { image: "atmospheric-depth", amount: 1 } } },
}

function measure(project: ComposerProject, seed: number) {
  const arrangement = generateFullSongArrangement(project, { seed })
  const beatsPerBar = 4
  const pad = arrangement.tracks.find((track) => track.id === "syn-dark-pad")?.notes ?? []
  const bass = arrangement.tracks.find((track) => track.id === "syn-bass")?.notes ?? []
  const chordAt = (beat: number) => project.chords.find((chord) => {
    const section = project.sections.find((item) => item.id === chord.sectionId)
    const start = ((section?.startBar ?? 1) - 1) * beatsPerBar + chord.startBeat
    return beat >= start && beat < start + chord.durationBeats
  })
  const colour = pad.filter((note) => {
    const chord = chordAt(note.startBeat)
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    return parsed ? !parsed.tones.some((tone) => tone.pitchClass === ((note.pitch % 12) + 12) % 12) : false
  }).length / Math.max(1, pad.length)
  const lead = buildSongPlaybackMaterial(project).lead
  const tonal = arrangement.tracks.filter((track) => track.family !== "drums")
  const onsets = tonal.map((track) => new Set(track.notes.map((note) => Math.round(note.startBeat * 4))))
  const allTogether = lead.filter((note) => onsets.filter((set) => set.has(Math.round(note.startBeat * 4))).length >= 2).length / Math.max(1, lead.length)
  const echoes = arrangement.tracks.flatMap((track) => track.notes).filter((note) => note.reason?.includes("核のリズム"))
  const echoSections = new Set(echoes.map((note) => note.sectionId))
  return {
    tracks: arrangement.tracks.filter((track) => track.notes.length > 0).map((track) => track.id).sort(),
    totalNotes: arrangement.tracks.reduce((sum, track) => sum + track.notes.length, 0),
    padNotes: pad.length,
    padLongShare: pad.filter((note) => note.durationBeats >= beatsPerBar - .1).length / Math.max(1, pad.length),
    padColourShare: colour,
    bassNotes: bass.length,
    bassLongShare: bass.filter((note) => note.durationBeats >= beatsPerBar).length / Math.max(1, bass.length),
    leadOnsetsWithTwoOrMoreParts: allTogether,
    echoNotes: echoes.length,
    echoSections: echoSections.size,
    padSample: pad.slice(0, 9).map((note) => note.pitch),
    maxEchoNotesPerSection: Math.max(0, ...[...echoSections].map((id) => echoes.filter((note) => note.sectionId === id).length)),
  }
}

describe("アレンジの空間と受け渡し(Delius / Schumann / Brahms の原理を削って使う)", () => {
  const seeds = [7, 11, 23]
  const results = Object.fromEntries(Object.entries(variants).map(([name, project]) => [name, seeds.map((seed) => measure(project, seed))]))
  if (process.env.ARRANGEMENT_COMPARISON_OUT) writeFileSync(process.env.ARRANGEMENT_COMPARISON_OUT, JSON.stringify(results, null, 2))

  it("音像でパートは増えず、受け渡しはセクションに1回(4音以内)まで", () => {
    results.neutral.forEach((neutral, index) => {
      for (const track of results.atmospheric[index].tracks) expect(neutral.tracks).toContain(track)
      expect(results.atmospheric[index].totalNotes).toBeLessThanOrEqual(neutral.totalNotes)
    })
    for (const row of [...results.neutral, ...results.atmospheric]) expect(row.maxEchoNotesPerSection).toBeLessThanOrEqual(4)
  })
})
