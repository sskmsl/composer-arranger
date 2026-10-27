import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { parseChordSymbol } from "@/core/chord"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId, type FullSongArrangement } from "@/core/arrangementGeneration"
import { withoutPartRows } from "@/core/arrangementChat"
import { arrangementInstrument } from "@/core/gmInstruments"
import { createEmptyProject, normalizeProject, type ComposerProject } from "@/core/project"
import { arrangementSoundedTracks, exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import * as generator from "./arrangementGenerator"

// Issue #207：ギターのリフ層(gtr-riff)の独立検証。
// 計画の値は使わず、exportArrangementMidi で書き出した MIDI を読み直して、音が実際に重なって鳴っているかで数える。
// 管理対象・休符許容(1小節)・1小節あたり2層までの数え方は、#193 の dramaticMinorBoundary.test.ts と同じ。
const RIFF: ArrangementTrackId = "gtr-riff"
const STRUM: ArrangementTrackId = "gtr-strum"
const ARPEGGIO: ArrangementTrackId = "gtr-arpeggio"
const LEGACY_GUITAR: readonly ArrangementTrackId[] = [ARPEGGIO, STRUM]
const BEATS_PER_BAR = 4
const REST_TOLERANCE_BARS = 1
const MAX_CHANGES_PER_BAR = 2

const { addGuitarLayers, addGuitarRiffLayer, generateFullSongArrangement, regenerateFullSongArrangementTarget } = generator

// ---------------------------------------------------------------------------
// fixture と測定の道具
// ---------------------------------------------------------------------------
type Genre = "neoclassical" | "electronica" | null
const GENRES: Genre[] = ["neoclassical", "electronica", null]
const SEEDS = [19, 41, 73]

/** 区間IDは乱数で、発音の揺れの種になる。固定したIDで、結果が決まるようにする。 */
function withSectionIds(project: ComposerProject, prefix: string): ComposerProject {
  let json = JSON.stringify(project)
  project.sections.forEach((section, index) => { json = json.split(section.id).join(`${prefix}${index}`) })
  return normalizeProject(JSON.parse(json))
}
function song(genre: Genre): ComposerProject {
  const project = arrangementReviewSong("A")
  project.song.genreBlend = genre ? [{ id: genre, weight: 1 }] : []
  return withSectionIds(project, "r")
}

interface TrackLike { id: string, notes: Array<{ pitch: number, startBeat: number, durationBeats: number, velocity: number, sectionId: string }> }
/** 音高・時刻・長さ・強さ・区間だけを見る(音のIDは見ない)。 */
const digest = (tracks: TrackLike[]) => createHash("sha256")
  .update(JSON.stringify(tracks.map((t) => [t.id, t.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats, n.velocity, n.sectionId])])))
  .digest("hex").slice(0, 16)
const isGuitar = (track: { id: string }) => track.id.startsWith("gtr-")
const riffTrack = (arrangement: FullSongArrangement) => arrangement.tracks.find((track) => track.id === RIFF)
const hasRiff = (arrangement: FullSongArrangement) => (riffTrack(arrangement)?.notes.length ?? 0) > 0

/** 変更前の main(e8f63e6)で、同じ fixture・seed の出力から取った値。リフ以外のトラックは、これと一致し続ける。 */
const MAIN_BASELINE: Record<string, { other: string, guitar: string }> = {
  "neoclassical/19": { other: "1e35d6e5b64ab51d", guitar: "b48c0b2cc7051a66" },
  "neoclassical/41": { other: "4efe3989f50b869b", guitar: "0a1f4477ef56a7d3" },
  "neoclassical/73": { other: "1807536d8c0344e7", guitar: "0a1f4477ef56a7d3" },
  "electronica/19": { other: "c0866909e5607038", guitar: "4f53cda18c2baa0c" },
  "electronica/41": { other: "322e787075c9d204", guitar: "4f53cda18c2baa0c" },
  "electronica/73": { other: "525191ddefc9e0ea", guitar: "4f53cda18c2baa0c" },
  "null/19": { other: "dd832c6b6be962e6", guitar: "2320f510864143e0" },
  "null/41": { other: "6c36099b292463d1", guitar: "0e2f86b06a5305c4" },
  "null/73": { other: "49d40bec4ae5b03b", guitar: "0e2f86b06a5305c4" },
}

interface Sound { startBeat: number, endBeat: number, pitch: number }
/** トラックIDごとの、書き出したMIDIの音(拍で表す)。 */
function exportedNotes(project: ComposerProject, arrangement: FullSongArrangement) {
  const midi = parseMidi(exportArrangementMidi(project, arrangement))
  const idByName = new Map<string, ArrangementTrackId>(Object.entries(ARRANGEMENT_TRACK_NAMES).map(([id, name]) => [name, id as ArrangementTrackId]))
  idByName.set("GTR_Riff", RIFF)
  const byId = new Map<ArrangementTrackId, Sound[]>()
  for (const track of midi.tracks) {
    const id = idByName.get(track.name)
    if (!id || !track.notes.length) continue
    byId.set(id, [...(byId.get(id) ?? []), ...track.notes.map((n) => ({ startBeat: n.startTick / midi.ppq, endBeat: (n.startTick + n.durationTicks) / midi.ppq, pitch: n.pitch }))])
  }
  return byId
}
const soundsInBar = (notes: Sound[] | undefined, bar: number) =>
  (notes ?? []).some((n) => n.startBeat < (bar + 1) * BEATS_PER_BAR && n.endBeat > bar * BEATS_PER_BAR + .01)
const totalBarsOf = (project: ComposerProject) => Math.max(...project.sections.map((s) => s.startBar + s.lengthBars - 1))

/** 区間の中で音が鳴っている小節(区間の先頭を0とする)。 */
function soundingBarsIn(project: ComposerProject, sectionIndex: number, notes: Sound[] | undefined): number[] {
  const section = project.sections[sectionIndex]
  return Array.from({ length: section.lengthBars }, (_, k) => k).filter((k) => soundsInBar(notes, section.startBar - 1 + k))
}

/** 両側が鳴っている小節に挟まれた、tolerance 以下の無音を埋める。 */
function bridgeShortRests(on: boolean[], tolerance: number): boolean[] {
  const result = [...on]
  let i = 0
  while (i < result.length) {
    if (result[i]) { i++; continue }
    let j = i
    while (j < result.length && !result[j]) j++
    if (i > 0 && j < result.length && j - i <= tolerance) for (let k = i; k < j; k++) result[k] = true
    i = j
  }
  return result
}

/** リフを採用した全曲案だけを集める。採用は品質の基準しだいなので、複数のseedで探す。 */
function adopted(project: ComposerProject, seeds: number[]) {
  return seeds.map((seed) => ({ seed, arrangement: generateFullSongArrangement(project, { seed }) })).filter(({ arrangement }) => hasRiff(arrangement))
}

// ---------------------------------------------------------------------------
// 1. トラック・音色・表示
// ---------------------------------------------------------------------------
describe("gtr-riff: track, tone and display", () => {
  it("defines the GTR_Riff track and plays it with a distortion guitar program", () => {
    expect(ARRANGEMENT_TRACK_NAMES["gtr-riff"]).toBe("GTR_Riff")
    const project = song("neoclassical")
    const found = adopted(project, SEEDS)
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const track = riffTrack(arrangement)!
      expect(arrangementInstrument(track), `seed ${seed}`).toBe(30)
      expect(track.family).toBe("guitar")
      const sounded = arrangementSoundedTracks(arrangement).filter((t) => t.track.name === "GTR_Riff")
      expect(sounded.map((t) => t.sound), `seed ${seed}`).toEqual([30])
    }
  }, 120_000)

  it("is removed together with the other guitar layers when the guitar is taken out", () => {
    const project = song("neoclassical")
    const found = adopted(project, SEEDS)
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const removed = withoutPartRows(arrangement, ["guitar"], undefined)
      expect(removed.tracks.filter(isGuitar).every((track) => track.notes.length === 0), `seed ${seed}`).toBe(true)
      expect(digest(removed.tracks.filter((track) => !isGuitar(track))), `seed ${seed}`).toBe(digest(arrangement.tracks.filter((track) => !isGuitar(track))))
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------
// 2. 自動で出る(ジャンルに関係なく)。出ないときは、変更前の main と一致する
// ---------------------------------------------------------------------------
describe("gtr-riff: automatic, whatever the genre", () => {
  it.each(GENRES)("adds a riff for genre %s in at least one fixed seed", (genre) => {
    // 電子寄り(リズムが強く反復の多い曲)でも出る。旧2層は、この曲には足されない。
    const found = adopted(song(genre), SEEDS)
    expect(found.length, `${genre}: リフが採用された全曲案が無い`).toBeGreaterThan(0)
  }, 120_000)

  it("never changes the tracks other than the guitar layers", () => {
    for (const genre of GENRES) {
      for (const seed of SEEDS) {
        const arrangement = generateFullSongArrangement(song(genre), { seed })
        expect(digest(arrangement.tracks.filter((track) => !isGuitar(track))), `${genre}/${seed}`).toBe(MAIN_BASELINE[`${genre}/${seed}`].other)
      }
    }
  }, 240_000)

  it("returns exactly the output of main when the riff is not adopted", () => {
    for (const genre of GENRES) {
      for (const seed of SEEDS) {
        const arrangement = generateFullSongArrangement(song(genre), { seed })
        if (hasRiff(arrangement)) continue
        expect(digest(arrangement.tracks.filter(isGuitar)), `${genre}/${seed}`).toBe(MAIN_BASELINE[`${genre}/${seed}`].guitar)
      }
    }
  }, 240_000)

  it("does not add a riff to a project that is only opened (old data without a riff)", () => {
    const project = song("neoclassical")
    const full = generateFullSongArrangement(project, { seed: 19 })
    // リフを持たない旧データ。開いただけ(読み込みと正規化)では、リフは足されない。
    const old = { ...full, tracks: full.tracks.filter((track) => track.id !== RIFF) }
    const opened = normalizeProject(JSON.parse(JSON.stringify({ ...project, fullSongArrangement: old }))) as ComposerProject
    expect(opened.fullSongArrangement?.tracks.some((track) => track.id === RIFF)).toBe(false)
    // 旧データの保存形式と音は、そのまま残る。
    expect(digest(opened.fullSongArrangement!.tracks)).toBe(digest(old.tracks))
  }, 120_000)

  it("keeps the riff after saving and reading the project again", () => {
    const project = song("neoclassical")
    const found = adopted(project, SEEDS)
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const reloaded = normalizeProject(JSON.parse(JSON.stringify({ ...project, fullSongArrangement: arrangement }))) as ComposerProject
      expect(digest(reloaded.fullSongArrangement!.tracks.filter((t) => t.id === RIFF)), `seed ${seed}`)
        .toBe(digest(arrangement.tracks.filter((t) => t.id === RIFF)))
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------
// 3. 置き方と、他のギター層との関係
// ---------------------------------------------------------------------------
describe("gtr-riff: placement and the other guitar layers", () => {
  const project = song("neoclassical")

  it("never plays in the outro and not in most of the sections", () => {
    const found = adopted(project, SEEDS)
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    const outro = project.sections.findIndex((s) => s.role === "outro")
    for (const { seed, arrangement } of found) {
      const notes = exportedNotes(project, arrangement).get(RIFF)
      expect(soundingBarsIn(project, outro, notes), `seed ${seed}: アウトロでリフが鳴っている`).toEqual([])
      const sections = project.sections.filter((_, i) => soundingBarsIn(project, i, notes).length > 0).length
      expect(sections, `seed ${seed}: リフが鳴る区間が多すぎる(${sections}/${project.sections.length})`).toBeLessThanOrEqual(Math.ceil(project.sections.length * 0.6))
      expect(sections, `seed ${seed}: リフがどの区間にも鳴らない`).toBeGreaterThan(0)
    }
  }, 120_000)

  it("stops the strum while the riff plays and never keeps all three guitar layers active in the same bar", () => {
    const found = adopted(project, SEEDS)
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const notes = exportedNotes(project, arrangement)
      const strumStarts = (bar: number) => (notes.get(STRUM) ?? []).filter((n) => n.startBeat >= bar * BEATS_PER_BAR - .01 && n.startBeat < (bar + 1) * BEATS_PER_BAR - .01).length
      const arpStarts = (bar: number) => (notes.get(ARPEGGIO) ?? []).filter((n) => n.startBeat >= bar * BEATS_PER_BAR - .01 && n.startBeat < (bar + 1) * BEATS_PER_BAR - .01).length
      const riffStarts = (bar: number) => (notes.get(RIFF) ?? []).filter((n) => n.startBeat >= bar * BEATS_PER_BAR - .01 && n.startBeat < (bar + 1) * BEATS_PER_BAR - .01).length
      const strumInRiff: number[] = []
      const allThree: number[] = []
      for (let bar = 0; bar < totalBarsOf(project); bar++) {
        if (riffStarts(bar) === 0) continue
        if (strumStarts(bar) > 0) strumInRiff.push(bar)
        // 3層とも活発(リフとストラムが鳴り、アルペジオも密)にならない。
        if (arpStarts(bar) > 4 && strumStarts(bar) > 0) allThree.push(bar)
      }
      expect(strumInRiff, `seed ${seed}: リフの小節でストラムが鳴っている`).toEqual([])
      expect(allThree, `seed ${seed}: 3層とも活発な小節`).toEqual([])
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------
// 4. コード根音・ベース音との整合(§3-2)
// ---------------------------------------------------------------------------
const CHORD_EXAMPLES = ["C", "Cm", "C/E", "C/D", "Bdim", "Bm7b5", "Caug", "Csus4", "Cadd9", "G7"]
function chordFixture(): ComposerProject {
  const p = createEmptyProject("Riff chords")
  p.projectId = "riff-chords"
  p.song.key = "C"
  p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
  const spec: Array<[ComposerProject["sections"][number]["role"], number]> = [["verse", 8], ["pre-chorus", 8], ["chorus", 20], ["grand-chorus", 20], ["outro", 4]]
  let bar = 1
  p.sections = spec.map(([role, bars], i) => {
    const section = { id: `c${i}`, name: `Section ${i + 1}`, role, startBar: bar, lengthBars: bars }
    bar += bars
    return section
  })
  p.chords = p.sections.flatMap((s) => {
    const symbols = s.role === "chorus" || s.role === "grand-chorus" ? CHORD_EXAMPLES : ["Cm", "Ab", "Bb", "G7"]
    const beats = s.lengthBars * BEATS_PER_BAR / symbols.length
    // 和音は区間の先頭からの相対位置(曲全体の位置にするのは buildSongPlaybackMaterial)。
    return symbols.map((symbol, i) => ({ id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * beats, durationBeats: beats, symbol, bass: null }))
  })
  return p
}
const pc = (pitch: number) => ((pitch % 12) + 12) % 12
const semitoneApart = (a: number, b: number) => { const d = Math.abs(pc(a) - pc(b)); return d === 1 || d === 11 }

describe("gtr-riff: chord root, bass and power chords (§3-2)", () => {
  const project = chordFixture()
  const chordAt = (absoluteBeat: number) => {
    const section = project.sections.find((s) => absoluteBeat >= (s.startBar - 1) * BEATS_PER_BAR && absoluteBeat < (s.startBar - 1 + s.lengthBars) * BEATS_PER_BAR)
    if (!section) return null
    const local = absoluteBeat - (section.startBar - 1) * BEATS_PER_BAR
    const chord = project.chords.filter((c) => c.sectionId === section.id).find((c) => c.startBeat <= local + .001 && local < c.startBeat + c.durationBeats - .001)
    return chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
  }
  const found = adopted(project, [1, 2, 3, 4, 5, 6])

  it("plays the riff in the chorus of the chord fixture", () => {
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    const chorus = project.sections.findIndex((s) => s.role === "chorus")
    const grand = project.sections.findIndex((s) => s.role === "grand-chorus")
    for (const { seed, arrangement } of found) {
      const notes = exportedNotes(project, arrangement).get(RIFF)
      expect(soundingBarsIn(project, chorus, notes).length + soundingBarsIn(project, grand, notes).length, `seed ${seed}`).toBeGreaterThan(0)
    }
  }, 240_000)

  it("never plays a note a semitone from the bass that sounds with it", () => {
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const notes = exportedNotes(project, arrangement)
      const bass = notes.get("syn-bass") ?? []
      const clashes = (notes.get(RIFF) ?? []).filter((r) => bass.some((b) =>
        Math.min(r.endBeat, b.endBeat) - Math.max(r.startBeat, b.startBeat) > .1 && semitoneApart(r.pitch, b.pitch)))
      expect(clashes.map((r) => `${r.startBeat}:${r.pitch}`), `seed ${seed}`).toEqual([])
    }
  }, 240_000)

  it("roots a power chord on the bass note, and leaves out a fifth that clashes with a chord tone", () => {
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const notes = exportedNotes(project, arrangement)
      const bass = notes.get("syn-bass") ?? []
      const riff = [...(notes.get(RIFF) ?? [])].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
      // 同時に弾き始める音を和音のまとまりにする(2音以上をパワーコードとみなす)。
      const clusters: Sound[][] = []
      for (const note of riff) {
        const last = clusters.at(-1)
        if (last && Math.abs(last[0].startBeat - note.startBeat) < .05) last.push(note)
        else clusters.push([note])
      }
      const rootOff: string[] = []
      const fifthClash: string[] = []
      for (const cluster of clusters.filter((c) => c.length >= 2)) {
        const lowest = cluster[0]
        // 根音は、鳴っているベースの音名にそろえる(ベースが鳴っていない所は、コードの根音)。
        const sounding = bass.filter((b) => b.startBeat <= lowest.startBeat + .05 && b.endBeat > lowest.startBeat + .1)
        if (sounding.length > 0 && !sounding.some((b) => pc(b.pitch) === pc(lowest.pitch))) rootOff.push(`${lowest.startBeat}:${lowest.pitch}`)
        // 根音の完全5度上が入っているなら、それはコードの構成音と半音でぶつからない。
        const fifth = cluster.find((n) => pc(n.pitch - lowest.pitch) === 7)
        const chord = chordAt(lowest.startBeat)
        if (fifth && chord) {
          const tones = chord.tones.map((t) => t.pitchClass)
          if (!tones.includes(pc(fifth.pitch)) && tones.some((t) => semitoneApart(t, fifth.pitch))) fifthClash.push(`${lowest.startBeat}:${chord.symbol ?? ""}`)
        }
        expect(lowest.pitch, `seed ${seed}: パワーコードの根音の音域`).toBeGreaterThanOrEqual(40)
        expect(lowest.pitch, `seed ${seed}: パワーコードの根音の音域`).toBeLessThanOrEqual(52)
      }
      expect(rootOff, `seed ${seed}: 根音がベースの音名と違う`).toEqual([])
      expect(fifthClash, `seed ${seed}: 5度がコードの音と半音でぶつかる`).toEqual([])
    }
  }, 240_000)

  it("keeps every riff note inside the guitar range", () => {
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const riff = exportedNotes(project, arrangement).get(RIFF) ?? []
      expect(Math.min(...riff.map((n) => n.pitch)), `seed ${seed}`).toBeGreaterThanOrEqual(40)
      expect(Math.max(...riff.map((n) => n.pitch)), `seed ${seed}`).toBeLessThanOrEqual(79)
    }
  }, 240_000)
})

// ---------------------------------------------------------------------------
// 5. 境界の窓：リフを含めても、1小節に交代する管理対象の層は2つまで
// ---------------------------------------------------------------------------
describe("gtr-riff: section boundaries", () => {
  const MANAGED = new Set(["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide", "syn-stabs", "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid", "gtr-arpeggio", "gtr-strum", "gtr-riff"])
  function boundaryFixture() {
    const p = createEmptyProject("Riff boundary")
    p.projectId = "riff-boundary"
    p.song.key = "Cm"
    p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
    p.sections = ["verse", "pre-chorus", "chorus", "pre-chorus", "grand-chorus", "outro"].map((role, i) => ({
      id: `s${i}`, name: `Section ${i + 1}`, role: role as ComposerProject["sections"][number]["role"], startBar: 1 + i * 8, lengthBars: 8,
    }))
    p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({ id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * 8, durationBeats: 8, symbol, bass: null })))
    return p
  }

  it("changes at most two managed layers per bar from two bars before to four bars after each boundary, with the riff counted", () => {
    const project = boundaryFixture()
    const found = adopted(project, [19, 41, 73, 101])
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    const totalBars = totalBarsOf(project)
    for (const { seed, arrangement } of found) {
      const notes = exportedNotes(project, arrangement)
      const presence = [...notes.entries()].filter(([id]) => id.startsWith("str-") || MANAGED.has(id)).map(([id, ns]) =>
        ({ id, on: bridgeShortRests(Array.from({ length: totalBars }, (_, b) => soundsInBar(ns, b)), REST_TOLERANCE_BARS) }))
      project.sections.forEach((section, index) => {
        const previous = project.sections[index - 1]
        if (!previous || previous.lengthBars < 8 || section.lengthBars < 8 || section.role === "outro") return
        for (let offset = -2; offset <= 4; offset++) {
          const bar = section.startBar - 1 + offset
          const changed = presence.filter((t) => t.on[bar - 1] !== t.on[bar]).map((t) => t.id)
          expect(changed.length, `seed ${seed} ${section.role} offset ${offset}: ${changed.join(", ")}`).toBeLessThanOrEqual(MAX_CHANGES_PER_BAR)
        }
      })
    }
  }, 240_000)
})

// ---------------------------------------------------------------------------
// 6. 2段のパイプライン、残存リフの保護、再生成
// ---------------------------------------------------------------------------
describe("gtr-riff: two-stage pipeline, kept riff and regeneration", () => {
  const project = song("neoclassical")
  const found = adopted(project, SEEDS)
  const withoutGuitar = (arrangement: FullSongArrangement) => ({ ...arrangement, tracks: arrangement.tracks.filter((t) => !isGuitar(t)) })

  it("exports addGuitarRiffLayer, which does not change its input", () => {
    expect(typeof addGuitarRiffLayer, "addGuitarRiffLayer が export されていない").toBe("function")
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const legacy = addGuitarLayers(project, withoutGuitar(arrangement))
      const before = JSON.stringify(legacy)
      const result = addGuitarRiffLayer(project, legacy)
      expect(JSON.stringify(legacy), `seed ${seed}: 入力を書き換えた`).toBe(before)
      expect(hasRiff(result), `seed ${seed}`).toBe(true)
      expect(digest(result.tracks.filter((t) => !isGuitar(t))), `seed ${seed}`).toBe(digest(legacy.tracks.filter((t) => !isGuitar(t))))
      // 全曲の入口は、旧2層を足してからリフを評価する、2段のとおりに作る。
      expect(JSON.stringify(result.tracks.map((t) => [t.id, t.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats, n.velocity])])), `seed ${seed}`)
        .toBe(JSON.stringify(arrangement.tracks.map((t) => [t.id, t.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats, n.velocity])])))
    }
  }, 240_000)

  it("returns the input itself when a sound instruction is active", () => {
    expect(typeof addGuitarRiffLayer, "addGuitarRiffLayer が export されていない").toBe("function")
    const full = generateFullSongArrangement(project, { seed: 19 })
    const base = addGuitarLayers(project, withoutGuitar(full))
    const instructed = { ...base, plan: { ...base.plan, directive: { intention: "", soundInstruction: { enabled: true } } } } as typeof base
    expect(addGuitarRiffLayer(project, instructed)).toBe(instructed)
  }, 120_000)

  it("restores the two legacy layers without touching a riff that is already there", () => {
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { seed, arrangement } of found) {
      const base = { ...arrangement, tracks: arrangement.tracks.filter((t) => !LEGACY_GUITAR.includes(t.id)) }
      const again = addGuitarLayers(project, base)
      expect(JSON.stringify(riffTrack(again)), `seed ${seed}: 残存リフが変わった`).toBe(JSON.stringify(riffTrack(base)))
      expect(digest(again.tracks.filter((t) => !isGuitar(t))), `seed ${seed}`).toBe(digest(base.tracks.filter((t) => !isGuitar(t))))
      expect(again.tracks.filter((t) => LEGACY_GUITAR.includes(t.id)).map((t) => t.id).sort(), `seed ${seed}`).toEqual([...LEGACY_GUITAR].sort())
    }
  }, 240_000)

  it("regenerates only the target section of the riff and keeps the saved instrument and mute", () => {
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    const { seed, arrangement } = found[0]
    const sounding = project.sections.findIndex((_, i) => soundingBarsIn(project, i, exportedNotes(project, arrangement).get(RIFF)).length > 0)
    const sectionId = project.sections[sounding].id
    const saved = { ...arrangement, tracks: arrangement.tracks.map((t) => t.id === RIFF
      ? { ...t, muted: true, instrument: { ...(t.instrument ?? {}), program: 29 } } as typeof t : t) }
    const result = regenerateFullSongArrangementTarget(project, saved, { trackId: RIFF, sectionId })
    const before = riffTrack(saved)!
    const after = riffTrack(result)!
    const outside = (track: typeof before) => track.notes.filter((n) => n.sectionId !== sectionId).map((n) => [n.pitch, n.startBeat, n.durationBeats, n.velocity])
    expect(outside(after), `seed ${seed}: 指定区間の外が変わった`).toEqual(outside(before))
    expect(after.muted, "ミュートが変わった").toBe(true)
    expect(after.instrument?.program, "保存した音色が変わった").toBe(29)
    expect(digest(result.tracks.filter((t) => t.id !== RIFF)), "リフ以外が変わった").toBe(digest(saved.tracks.filter((t) => t.id !== RIFF)))
  }, 240_000)

  it("regenerates the whole riff track without touching the other tracks", () => {
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    const { seed, arrangement } = found[0]
    const result = regenerateFullSongArrangementTarget(project, arrangement, { trackId: RIFF })
    expect(digest(result.tracks.filter((t) => t.id !== RIFF)), `seed ${seed}`).toBe(digest(arrangement.tracks.filter((t) => t.id !== RIFF)))
  }, 240_000)
})
