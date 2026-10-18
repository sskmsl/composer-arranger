import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from "@/core/arrangementGeneration"
import { exportArrangementMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { generateFullSongArrangement } from "./arrangementGenerator"

// Issue #194 の規則1・2を、書き出したMIDIから独立に検証する。
// 計画の値は使わず、音が実際に重なって鳴っている小節だけを数える。
// 管理対象・休符許容(1小節)・1小節あたり2層までは、#193 の dramaticMinorBoundary.test.ts と同じ。
type Role = ComposerProject["sections"][number]["role"]

const MANAGED_IDS: ReadonlySet<string> = new Set([
  "syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide", "syn-stabs",
  "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid",
])
const isManaged = (id: string) => id.startsWith("str-") || MANAGED_IDS.has(id)
/** 補助ベース層。主ベース `syn-bass` は含めない(#193 の分類どおり、和声の重心として維持する)。 */
const AUXILIARY_BASS: readonly ArrangementTrackId[] = ["syn-sub-bass", "syn-bass-mid"]
const MAIN_BASS: ArrangementTrackId = "syn-bass"
const REST_TOLERANCE_BARS = 1
const MAX_CHANGES_PER_BAR = 2
const BEATS_PER_BAR = 4

function fixture(spec: [Role, number][]): ComposerProject {
  const p = createEmptyProject("Bass layers")
  p.projectId = "bass-layers"
  p.song.key = "Cm"
  let bar = 1
  p.sections = spec.map(([role, bars], i) => {
    const section = { id: `s${i}`, name: `Section ${i + 1}`, role, startBar: bar, lengthBars: bars }
    bar += bars
    return section
  })
  p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({
    id: `${s.id}:${i}`, sectionId: s.id, startBeat: (s.startBar - 1) * BEATS_PER_BAR + i * s.lengthBars,
    durationBeats: s.lengthBars, symbol, bass: null,
  })))
  return p
}

type Arrangement = ReturnType<typeof generateFullSongArrangement>

/** トラックIDごとの、書き出したMIDIの音(拍で表す)。 */
function exportedNotes(p: ComposerProject, arrangement: Arrangement) {
  const midi = parseMidi(exportArrangementMidi(p, arrangement))
  const idByName = new Map(Object.entries(ARRANGEMENT_TRACK_NAMES).map(([id, name]) => [name, id as ArrangementTrackId]))
  const byId = new Map<ArrangementTrackId, { startBeat: number, endBeat: number }[]>()
  for (const track of midi.tracks) {
    const id = idByName.get(track.name)
    if (!id || !track.notes.length) continue
    byId.set(id, [...(byId.get(id) ?? []), ...track.notes.map((n) => ({ startBeat: n.startTick / midi.ppq, endBeat: (n.startTick + n.durationTicks) / midi.ppq }))])
  }
  return byId
}

/** その小節(0始まり)に、音が実際に重なって鳴っているか。 */
function soundsInBar(notes: { startBeat: number, endBeat: number }[] | undefined, bar: number): boolean {
  return (notes ?? []).some((n) => n.startBeat < (bar + 1) * BEATS_PER_BAR && n.endBeat > bar * BEATS_PER_BAR + .01)
}

/** 区間の中で音が鳴っている小節(区間の先頭を0とする)。 */
function soundingBarsIn(p: ComposerProject, sectionIndex: number, notes: { startBeat: number, endBeat: number }[] | undefined): number[] {
  const section = p.sections[sectionIndex]
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

/** その小節で、直前の小節から鳴り方が入れ替わった管理対象のトラック。 */
function managedChangesAt(p: ComposerProject, notes: ReturnType<typeof exportedNotes>, bar: number): ArrangementTrackId[] {
  const totalBars = Math.max(...p.sections.map((s) => s.startBar + s.lengthBars - 1))
  return [...notes.entries()].filter(([id]) => isManaged(id)).filter(([, ns]) => {
    const on = bridgeShortRests(Array.from({ length: totalBars }, (_, b) => soundsInBar(ns, b)), REST_TOLERANCE_BARS)
    return on[bar - 1] !== on[bar]
  }).map(([id]) => id)
}

// ---------------------------------------------------------------------------
// 規則1：低域を控えるヴァース
// 既存の dynamic-contrast 候補が選ばれる条件(`character: "minimal"`)で、ヴァース・プレコーラスは補助ベース層を休み、
// サビの入りで入場する。主ベースは両側で鳴る。
// ---------------------------------------------------------------------------
const SONG = fixture([
  ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["grand-chorus", 8], ["outro", 4],
])
const dynamicContrastDirective = { intention: "低域を控えたヴァースから、サビで広げる", character: "minimal" as const }

describe("rule 1: the verse holds back the auxiliary bass layers", () => {
  it("keeps the auxiliary bass layers silent in verse and pre-chorus and brings them in with the chorus", () => {
    for (const seed of [1, 2, 3]) {
      const arrangement = generateFullSongArrangement(SONG, { seed, directive: dynamicContrastDirective })
      // この入口で dynamic-contrast 候補が選ばれていること。選ばれなければ、この検証は意味を持たない。
      expect(arrangement.plan.candidateApproach, `seed ${seed}: dynamic-contrast が選ばれていない`).toBe("dynamic-contrast")
      const notes = exportedNotes(SONG, arrangement)
      SONG.sections.forEach((section, index) => {
        const auxiliary = AUXILIARY_BASS.flatMap((id) => soundingBarsIn(SONG, index, notes.get(id)).map((bar) => `${id}@${bar}`))
        if (section.role === "verse" || section.role === "pre-chorus") {
          expect(auxiliary, `seed ${seed} ${section.role} (${section.id}): 補助ベース層が鳴っている`).toEqual([])
        }
        if (section.role === "chorus" || section.role === "grand-chorus") {
          expect(auxiliary.length, `seed ${seed} ${section.role} (${section.id}): 補助ベース層がサビで鳴らない`).toBeGreaterThan(0)
          // 入場は、サビの先頭から後4小節(#193 の窓)までに収まる。
          const first = Math.min(...AUXILIARY_BASS.flatMap((id) => soundingBarsIn(SONG, index, notes.get(id))))
          expect(first, `seed ${seed} ${section.role} (${section.id}): 入場が遅い`).toBeLessThanOrEqual(4)
        }
        if (section.role !== "outro") {
          expect(soundingBarsIn(SONG, index, notes.get(MAIN_BASS)).length, `seed ${seed} ${section.role} (${section.id}): 主ベースが鳴らない`).toBeGreaterThan(0)
        }
      })
    }
  }, 60_000)

  it("keeps a preserved auxiliary bass layer in the verse, even when the others are held back", () => {
    // 明示された保護(preserve)は、規則1の保留より優先する。保護した層は、最初のヴァースで鳴り続ける。
    for (const seed of [1, 2]) {
      const arrangement = generateFullSongArrangement(SONG, { seed, directive: { ...dynamicContrastDirective, preserve: ["syn-sub-bass"] } })
      const notes = exportedNotes(SONG, arrangement)
      const verse = SONG.sections.findIndex((s) => s.role === "verse")
      expect(soundingBarsIn(SONG, verse, notes.get("syn-sub-bass")).length, `seed ${seed}: 保護した syn-sub-bass が最初のヴァースで鳴らない`).toBeGreaterThan(0)
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 規則2：ブレイクダウン→4小節の再構築→サビ
// ブレイクダウン区間は補助ベース層を全休止し、後続の4小節区間で、管理対象を1小節あたり2層までずつ戻す。
// ---------------------------------------------------------------------------
const WITH_BREAKDOWN = fixture([
  ["verse", 8], ["pre-chorus", 8], ["chorus", 8], ["breakdown-chorus", 8], ["pre-chorus", 4], ["grand-chorus", 8], ["outro", 4],
])

describe("rule 2: breakdown, then a four-bar rebuild into the chorus", () => {
  const breakdown = WITH_BREAKDOWN.sections.findIndex((s) => s.role === "breakdown-chorus")
  const rebuild = breakdown + 1
  const next = rebuild + 1

  it("rests the auxiliary bass layers for the whole breakdown section", () => {
    for (const seed of [1, 2, 3]) {
      const notes = exportedNotes(WITH_BREAKDOWN, generateFullSongArrangement(WITH_BREAKDOWN, { seed }))
      for (const id of AUXILIARY_BASS) {
        expect(soundingBarsIn(WITH_BREAKDOWN, breakdown, notes.get(id)), `seed ${seed}: ブレイクダウンで ${id} が鳴っている`).toEqual([])
      }
    }
  }, 60_000)

  it("brings the auxiliary bass back by the end of the rebuild instead of leaving it out", () => {
    for (const seed of [1, 2, 3]) {
      const notes = exportedNotes(WITH_BREAKDOWN, generateFullSongArrangement(WITH_BREAKDOWN, { seed }))
      const rebuildStart = WITH_BREAKDOWN.sections[rebuild].startBar - 1
      const lastRebuildBar = rebuildStart + WITH_BREAKDOWN.sections[rebuild].lengthBars - 1
      const returned = AUXILIARY_BASS.some((id) => soundsInBar(notes.get(id), lastRebuildBar) || soundsInBar(notes.get(id), lastRebuildBar + 1))
      expect(returned, `seed ${seed}: 再構築の終わり(か次区間の先頭)で補助ベース層が戻っていない`).toBe(true)
      // 主ベースは、ブレイクダウンでも鳴り続ける(和声の重心)。
      expect(soundingBarsIn(WITH_BREAKDOWN, breakdown, notes.get(MAIN_BASS)).length, `seed ${seed}: 主ベースがブレイクダウンで鳴らない`).toBeGreaterThan(0)
    }
  }, 60_000)

  it("changes at most two managed layers per bar from the start of the rebuild to the first bar of the next section", () => {
    for (const seed of [1, 2, 3]) {
      const notes = exportedNotes(WITH_BREAKDOWN, generateFullSongArrangement(WITH_BREAKDOWN, { seed }))
      const first = WITH_BREAKDOWN.sections[rebuild].startBar - 1
      const last = WITH_BREAKDOWN.sections[next].startBar - 1
      for (let bar = first; bar <= last; bar++) {
        const changed = managedChangesAt(WITH_BREAKDOWN, notes, bar)
        expect(changed.length, `seed ${seed} bar ${bar - first} of the rebuild window: ${changed.join(", ")}`).toBeLessThanOrEqual(MAX_CHANGES_PER_BAR)
      }
    }
  }, 60_000)
})
