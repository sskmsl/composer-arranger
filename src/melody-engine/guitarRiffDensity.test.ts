import { describe, expect, it } from "vitest"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId, type FullSongArrangement } from "@/core/arrangementGeneration"
import { createEmptyProject, normalizeProject, type ComposerProject } from "@/core/project"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { generateFullSongArrangement, regenerateFullSongArrangementTarget } from "./arrangementGenerator"

// Issue #209：ギターのリフ(gtr-riff)の密度の独立検証。
// 分母は区間全体の小節数。分子は、書き出した MIDI を読み直して、音が実際に重なって鳴っている小節だけを数える
// (境界の判定用に短い休符を埋めた presence は使わない)。#193、#207 と同じ数え方。
// 目標は「達成できる例がある」ことの確認で、全 seed・全区間への無条件の下限ではない
// (品質上の不採用や、疎なまま戻す fallback は許される)。fallback が main と同じことは guitarRiffLayers.test.ts が見ている。
const RIFF: ArrangementTrackId = "gtr-riff"
const BEATS_PER_BAR = 4
const REST_TOLERANCE_BARS = 1
const MAX_CHANGES_PER_BAR = 2

/** 8小節のサビ・大サビは4小節以上(半分)。 */
const POWER_RATIO = 0.5
/** 単音の区間(プレコーラス・ブリッジ・イントロ)は、8小節なら2小節以上(4分の1)。 */
const LINE_RATIO = 0.25

type Genre = "neoclassical" | "electronica" | null
const GENRES: Genre[] = ["neoclassical", "electronica", null]
const SEEDS = [19, 41, 73]

// ---------------------------------------------------------------------------
// fixture と測定の道具
// ---------------------------------------------------------------------------
/** 区間IDは乱数で、発音の揺れの種になる。固定したIDで、結果が決まるようにする。 */
function withSectionIds(project: ComposerProject, prefix: string): ComposerProject {
  let json = JSON.stringify(project)
  project.sections.forEach((section, index) => { json = json.split(section.id).join(`${prefix}${index}`) })
  return normalizeProject(JSON.parse(json))
}
function song(which: "A" | "B", genre: Genre): ComposerProject {
  const project = arrangementReviewSong(which)
  project.song.genreBlend = genre ? [{ id: genre, weight: 1 }] : []
  return withSectionIds(project, "r")
}
/** 20小節のサビ・大サビを持つ曲(長い区間でも密度が保たれること)。 */
function longSectionSong(): ComposerProject {
  const p = createEmptyProject("Riff density long sections")
  p.projectId = "riff-density-long"
  p.song.key = "C"
  p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
  const spec: Array<[ComposerProject["sections"][number]["role"], number]> = [["verse", 8], ["pre-chorus", 8], ["chorus", 20], ["grand-chorus", 20], ["outro", 4]]
  let bar = 1
  p.sections = spec.map(([role, bars], i) => {
    const section = { id: `d${i}`, name: `Section ${i + 1}`, role, startBar: bar, lengthBars: bars }
    bar += bars
    return section
  })
  p.chords = p.sections.flatMap((s) => {
    const symbols = ["Cm", "Ab", "Bb", "G7"]
    const beats = s.lengthBars * BEATS_PER_BAR / symbols.length
    // 和音は区間の先頭からの相対位置(曲全体の位置にするのは buildSongPlaybackMaterial)。
    return symbols.map((symbol, i) => ({ id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * beats, durationBeats: beats, symbol, bass: null }))
  })
  return p
}

interface Sound { startBeat: number, endBeat: number, pitch: number }
/** トラックIDごとの、書き出したMIDIの音(拍で表す)。 */
function exportedNotes(project: ComposerProject, arrangement: FullSongArrangement) {
  const midi = parseMidi(exportArrangementMidi(project, arrangement))
  const idByName = new Map<string, ArrangementTrackId>(Object.entries(ARRANGEMENT_TRACK_NAMES).map(([id, name]) => [name, id as ArrangementTrackId]))
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
const hasRiff = (arrangement: FullSongArrangement) => (arrangement.tracks.find((t) => t.id === RIFF)?.notes.length ?? 0) > 0

/** 区間の中で音が鳴っている小節の数(休符は埋めない)。 */
function soundingBarCount(project: ComposerProject, sectionIndex: number, notes: Sound[] | undefined): number {
  const section = project.sections[sectionIndex]
  return Array.from({ length: section.lengthBars }, (_, k) => k).filter((k) => soundsInBar(notes, section.startBar - 1 + k)).length
}
/** 両側が鳴っている小節に挟まれた、tolerance 以下の無音を埋める(境界の数え方)。 */
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

type Kind = "power" | "line"
const kindOf = (role: string): Kind | null =>
  role === "chorus" || role === "grand-chorus" ? "power" : ["pre-chorus", "bridge", "intro"].includes(role) ? "line" : null
const needed = (kind: Kind, lengthBars: number) => Math.ceil(lengthBars * (kind === "power" ? POWER_RATIO : LINE_RATIO))

/** リフが鳴っている区間ごとの、密度の達成状況。区間にリフが1音も無ければ含めない。 */
function densityReport(project: ComposerProject, arrangement: FullSongArrangement) {
  const notes = exportedNotes(project, arrangement).get(RIFF)
  return project.sections.flatMap((section, index) => {
    const kind = kindOf(section.role)
    const count = soundingBarCount(project, index, notes)
    if (!kind || count === 0) return []
    return [{ role: section.role, kind, count, lengthBars: section.lengthBars, ok: count >= needed(kind, section.lengthBars) }]
  })
}
const label = (r: ReturnType<typeof densityReport>[number]) => `${r.role} ${r.count}/${r.lengthBars}小節(必要 ${needed(r.kind, r.lengthBars)})`

/** その kind の区間がすべて目標に届いている(その kind でリフが鳴る区間が1つ以上ある)。 */
function reachesTarget(project: ComposerProject, arrangement: FullSongArrangement, kind: Kind) {
  const rows = densityReport(project, arrangement).filter((r) => r.kind === kind)
  return rows.length > 0 && rows.every((r) => r.ok)
}

// ---------------------------------------------------------------------------
// 1. 達成できる例がある：サビ・大サビ(パワーコード)と、単音の区間
// ---------------------------------------------------------------------------
/**
 * 達成例を見る組み合わせ(曲, ジャンル)。区間IDを固定した現行の出力で、その区間にリフが採用されているものだけを選んでいる
 * (例：曲A・ジャンル未設定は、サビにはリフが採用されずブリッジだけに入るので、単音の例にだけ使う)。
 * 品質上の不採用は許されるので、ここに無い組み合わせへ無条件の下限は課さない。
 */
const POWER_CASES: Array<["A" | "B", Genre]> = [["A", "neoclassical"], ["A", "electronica"], ["B", "neoclassical"], ["B", null]]
const LINE_CASES: Array<["A" | "B", Genre]> = [["A", "neoclassical"], ["A", "electronica"], ["A", null], ["B", "neoclassical"], ["B", null]]

describe("gtr-riff density: reachable targets", () => {
  it.each(POWER_CASES)("reaches half of the chorus and final chorus bars for review song %s, genre %s, in at least one fixed seed", (which, genre) => {
    const project = song(which, genre)
    const rows = SEEDS.map((seed) => {
      const arrangement = generateFullSongArrangement(project, { seed })
      return { seed, ok: reachesTarget(project, arrangement, "power"), report: densityReport(project, arrangement).filter((r) => r.kind === "power").map(label).join(", ") }
    })
    expect(rows.some((r) => r.ok), `曲${which}/${genre}: ${rows.map((r) => `seed ${r.seed} [${r.report || "サビにリフなし"}]`).join(" / ")}`).toBe(true)
  }, 240_000)

  it.each(LINE_CASES)("reaches a quarter of the single-note section bars for review song %s, genre %s, in at least one fixed seed", (which, genre) => {
    const project = song(which, genre)
    const rows = SEEDS.map((seed) => {
      const arrangement = generateFullSongArrangement(project, { seed })
      return { seed, ok: reachesTarget(project, arrangement, "line"), report: densityReport(project, arrangement).filter((r) => r.kind === "line").map(label).join(", ") }
    })
    expect(rows.some((r) => r.ok), `曲${which}/${genre}: ${rows.map((r) => `seed ${r.seed} [${r.report || "単音の区間にリフなし"}]`).join(" / ")}`).toBe(true)
  }, 240_000)

  it("keeps half of the bars in 20-bar choruses too, not just one bar per section", () => {
    const project = longSectionSong()
    const rows = [1, 2, 3, 4, 5, 6].map((seed) => {
      const arrangement = generateFullSongArrangement(project, { seed })
      return { seed, ok: reachesTarget(project, arrangement, "power"), report: densityReport(project, arrangement).filter((r) => r.kind === "power").map(label).join(", ") }
    })
    expect(rows.some((r) => r.ok), rows.map((r) => `seed ${r.seed} [${r.report || "リフなし"}]`).join(" / ")).toBe(true)
  }, 360_000)
})

// ---------------------------------------------------------------------------
// 2. 密度を上げても守る条件(リフが採用された曲すべてで)
// ---------------------------------------------------------------------------
describe("gtr-riff density: the safety conditions still hold", () => {
  const MANAGED = new Set(["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide", "syn-stabs", "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid", "gtr-arpeggio", "gtr-strum", "gtr-riff"])
  const pc = (pitch: number) => ((pitch % 12) + 12) % 12
  const semitoneApart = (a: number, b: number) => { const d = Math.abs(pc(a) - pc(b)); return d === 1 || d === 11 }

  function adoptedAll() {
    const found: Array<{ label: string, project: ComposerProject, arrangement: FullSongArrangement }> = []
    for (const genre of GENRES) {
      const project = song("A", genre)
      for (const seed of SEEDS) {
        const arrangement = generateFullSongArrangement(project, { seed })
        if (hasRiff(arrangement)) found.push({ label: `${genre}/${seed}`, project, arrangement })
      }
    }
    return found
  }

  it("never plays in the outro, and in at most 60% of the sections", () => {
    const found = adoptedAll()
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { label: name, project, arrangement } of found) {
      const notes = exportedNotes(project, arrangement).get(RIFF)
      const playing = project.sections.map((s, i) => ({ s, count: soundingBarCount(project, i, notes) }))
      // ヴァースは「energy が高い曲だけ単音を許す」ので、鳴らさない確認はアウトロのみ厳密にする。
      for (const { count } of playing.filter(({ s }) => s.role === "outro")) expect(count, `${name}: アウトロでリフが鳴っている`).toBe(0)
      const sections = playing.filter(({ count }) => count > 0).length
      expect(sections, `${name}: リフが鳴る区間が多すぎる(${sections}/${project.sections.length})`).toBeLessThanOrEqual(Math.ceil(project.sections.length * 0.6))
    }
  }, 240_000)

  it("never plays a note a semitone from the bass that sounds with it", () => {
    const found = adoptedAll()
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { label: name, project, arrangement } of found) {
      const notes = exportedNotes(project, arrangement)
      const bass = notes.get("syn-bass") ?? []
      const clashes = (notes.get(RIFF) ?? []).filter((r) => bass.some((b) =>
        Math.min(r.endBeat, b.endBeat) - Math.max(r.startBeat, b.startBeat) > .1 && semitoneApart(r.pitch, b.pitch)))
      expect(clashes.map((r) => `${r.startBeat}:${r.pitch}`), name).toEqual([])
    }
  }, 240_000)

  it("keeps the riff inside the guitar range", () => {
    const found = adoptedAll()
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { label: name, project, arrangement } of found) {
      const riff = exportedNotes(project, arrangement).get(RIFF) ?? []
      expect(Math.min(...riff.map((n) => n.pitch)), name).toBeGreaterThanOrEqual(40)
      expect(Math.max(...riff.map((n) => n.pitch)), name).toBeLessThanOrEqual(79)
    }
  }, 240_000)

  it("stops the strum in every bar where the riff plays", () => {
    const found = adoptedAll()
    expect(found.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    for (const { label: name, project, arrangement } of found) {
      const notes = exportedNotes(project, arrangement)
      const starts = (id: ArrangementTrackId, bar: number) => (notes.get(id) ?? []).filter((n) => n.startBeat >= bar * BEATS_PER_BAR - .01 && n.startBeat < (bar + 1) * BEATS_PER_BAR - .01).length
      const bad: number[] = []
      for (let bar = 0; bar < totalBarsOf(project); bar++) if (starts(RIFF, bar) > 0 && starts("gtr-strum", bar) > 0) bad.push(bar)
      expect(bad, `${name}: リフの小節でストラムが鳴っている`).toEqual([])
    }
  }, 240_000)

  it("changes at most two managed layers per bar around each boundary, with the riff counted, on 8-bar sections", () => {
    const p = createEmptyProject("Riff density boundary")
    p.projectId = "riff-density-boundary"
    p.song.key = "Cm"
    p.song.genreBlend = [{ id: "neoclassical", weight: 1 }]
    p.sections = ["verse", "pre-chorus", "chorus", "pre-chorus", "grand-chorus", "outro"].map((role, i) => ({
      id: `b${i}`, name: `Section ${i + 1}`, role: role as ComposerProject["sections"][number]["role"], startBar: 1 + i * 8, lengthBars: 8,
    }))
    p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({ id: `${s.id}:${i}`, sectionId: s.id, symbol, startBeat: i * 8, durationBeats: 8, bass: null })))
    const seeds = [19, 41, 73, 101]
    const adopted = seeds.map((seed) => ({ seed, arrangement: generateFullSongArrangement(p, { seed }) })).filter(({ arrangement }) => hasRiff(arrangement))
    expect(adopted.length, "リフが採用された全曲案が無い").toBeGreaterThan(0)
    const totalBars = totalBarsOf(p)
    for (const { seed, arrangement } of adopted) {
      const notes = exportedNotes(p, arrangement)
      const presence = [...notes.entries()].filter(([id]) => id.startsWith("str-") || MANAGED.has(id)).map(([id, ns]) =>
        ({ id, on: bridgeShortRests(Array.from({ length: totalBars }, (_, b) => soundsInBar(ns, b)), REST_TOLERANCE_BARS) }))
      p.sections.forEach((section, index) => {
        const previous = p.sections[index - 1]
        if (!previous || previous.lengthBars < 8 || section.lengthBars < 8 || section.role === "outro") return
        for (let offset = -2; offset <= 4; offset++) {
          const bar = section.startBar - 1 + offset
          const changed = presence.filter((t) => t.on[bar - 1] !== t.on[bar]).map((t) => t.id)
          expect(changed.length, `seed ${seed} ${section.role} offset ${offset}: ${changed.join(", ")}`).toBeLessThanOrEqual(MAX_CHANGES_PER_BAR)
        }
      })
    }
  }, 360_000)
})

// ---------------------------------------------------------------------------
// 3. 再生成：密度を落とさず、区間外・他トラック・音色・muteを保つ
// ---------------------------------------------------------------------------
describe("gtr-riff density: regeneration", () => {
  it("regenerating the riff of one chorus keeps at least the bars it had and leaves everything else alone", () => {
    const project = song("A", "neoclassical")
    const arrangement = SEEDS.map((seed) => generateFullSongArrangement(project, { seed })).find((a) => hasRiff(a))
    expect(arrangement, "リフが採用された全曲案が無い").toBeDefined()
    const before = arrangement!
    const beforeNotes = exportedNotes(project, before).get(RIFF)
    const index = project.sections.findIndex((s, i) => s.role === "chorus" && soundingBarCount(project, i, beforeNotes) > 0)
    expect(index, "リフが鳴るサビが無い").toBeGreaterThanOrEqual(0)
    const sectionId = project.sections[index].id
    const saved = { ...before, tracks: before.tracks.map((t) => t.id === RIFF ? { ...t, muted: true, instrument: { reason: t.instrument?.reason ?? "density test", program: 29 } } : t) }
    const after = regenerateFullSongArrangementTarget(project, saved, { trackId: RIFF, sectionId })
    // 反復を落とさない(再生成で疎に戻らない)。ミュートの書き出しは音を出さないことがあるので、計画の音符で数える。
    const bars = (a: FullSongArrangement) => new Set((a.tracks.find((t) => t.id === RIFF)?.notes ?? []).filter((n) => n.sectionId === sectionId).map((n) => Math.floor(n.startBeat / BEATS_PER_BAR))).size
    expect(bars(after), "再生成で、リフの鳴る小節が減った").toBeGreaterThanOrEqual(bars(saved))
    // 区間の外・他のトラック・保存した音色とミュートは変わらない。
    const outside = (a: FullSongArrangement) => (a.tracks.find((t) => t.id === RIFF)?.notes ?? []).filter((n) => n.sectionId !== sectionId).map((n) => [n.pitch, n.startBeat, n.durationBeats, n.velocity])
    expect(outside(after)).toEqual(outside(saved))
    const regenerated = after.tracks.find((t) => t.id === RIFF)!
    expect(regenerated.muted).toBe(true)
    expect(regenerated.instrument?.program).toBe(29)
    expect(JSON.stringify(after.tracks.filter((t) => t.id !== RIFF).map((t) => [t.id, t.notes.length]))).toBe(JSON.stringify(saved.tracks.filter((t) => t.id !== RIFF).map((t) => [t.id, t.notes.length])))
  }, 240_000)

  it("does not make a saved sparse riff denser just by opening the project", () => {
    const project = song("A", "neoclassical")
    const arrangement = SEEDS.map((seed) => generateFullSongArrangement(project, { seed })).find((a) => hasRiff(a))
    expect(arrangement, "リフが採用された全曲案が無い").toBeDefined()
    const sparseTrack = (arrangement!.tracks.find((t) => t.id === RIFF)!)
    // 保存済みの疎なリフ(各区間の先頭の1小節だけ残したもの)を、旧版の保存データとみなす。
    const firstBars = new Map<string, number>()
    for (const n of sparseTrack.notes) firstBars.set(n.sectionId, Math.min(firstBars.get(n.sectionId) ?? Infinity, Math.floor(n.startBeat / BEATS_PER_BAR)))
    const sparse = { ...arrangement!, tracks: arrangement!.tracks.map((t) => t.id === RIFF
      ? { ...t, notes: t.notes.filter((n) => Math.floor(n.startBeat / BEATS_PER_BAR) === firstBars.get(n.sectionId)) } : t) }
    const opened = normalizeProject(JSON.parse(JSON.stringify({ ...project, fullSongArrangement: sparse }))) as ComposerProject
    const count = (a: FullSongArrangement | null | undefined) => a?.tracks.find((t) => t.id === RIFF)?.notes.length ?? 0
    expect(count(opened.fullSongArrangement), "開いただけでリフの音数が変わった").toBe(count(sparse))
  }, 120_000)
})
