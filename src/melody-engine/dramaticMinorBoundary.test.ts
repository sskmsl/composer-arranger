import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from "@/core/arrangementGeneration"
import { exportArrangementMidi, exportArrangementTrackMidi } from "@/midi/exportArrangement"
import { parseMidi } from "@/midi/importMidi"
import { generateFullSongArrangement } from "./arrangementGenerator"

// 境界の整理（密度の間引き・層の交代）が、選ばれた Transition の音を最終MIDIから消さないことの回帰テスト。
// 期待値は実装の密度式ではなく、計画で選ばれた Transition 候補の音そのもの。
const seeds = [19, 41, 73]
const TRACK = "syn-transition-phrase" as const
/**
 * 最終計画は実際に鳴ったトラックに合わせて整理される。Transition の音が丸ごと消えると、
 * その区間は検証の対象から外れて見える。そこで、各seedで検証の対象になる区間が
 * 一定数あることも確かめる（85dd4cf では1seedあたり1つ以下に減っていた）。
 */
const MINIMUM_CHECKED_SECTIONS_PER_SEED = 2

function fixture(): ComposerProject {
  const p = createEmptyProject("Transition retention")
  p.projectId = "transition-retention"
  p.song.key = "Cm"
  p.sections = ["verse", "pre-chorus", "chorus", "pre-chorus", "grand-chorus", "outro"].map((role, i) => ({
    id: `s${i}`, name: `Section ${i + 1}`, role: role as ComposerProject["sections"][number]["role"],
    startBar: 1 + i * 8, lengthBars: 8,
  }))
  p.chords = p.sections.flatMap((s) => ["Cm", "Ab", "Bb", "G7"].map((symbol, i) => ({
    id: `${s.id}:${i}`, sectionId: s.id, startBeat: i * 8, durationBeats: 8, symbol, bass: null,
  })))
  return p
}

type Arrangement = ReturnType<typeof generateFullSongArrangement>

/** 計画で Transition の役割が有効で、音を持つ候補が選ばれている区間と、その音。 */
function selectedTransitions(arrangement: Arrangement) {
  return arrangement.plan.sections.flatMap((section) => {
    if (!section.activeRoles.includes(TRACK) || section.selectedTransitionCharacter === "silence") return []
    const selected = section.transitionCandidates.find((c) => c.character === section.selectedTransitionCharacter)
    return selected && selected.notes.length ? [{ sectionId: section.sectionId, character: selected.character, notes: selected.notes }] : []
  })
}

/** 同じ拍・同じ音名が鳴っているか。主旋律との衝突回避でオクターブだけ動く場合があるため、音名で比べる。 */
function sounds(sounded: { beat: number, pitchClass: number }[], note: { startBeat: number, pitch: number }) {
  return sounded.some((s) => Math.abs(s.beat - note.startBeat) < .03 && s.pitchClass === note.pitch % 12)
}

describe("selected transitions survive the final MIDI export", () => {
  it("writes every note of the selected Transition candidate to the track MIDI for fixed seeds", () => {
    const p = fixture()
    for (const seed of seeds) {
      const arrangement = generateFullSongArrangement(p, { seed })
      const midi = parseMidi(exportArrangementTrackMidi(p, arrangement, TRACK))
      const sounded = midi.tracks.flatMap((t) => t.notes).map((n) => ({ beat: n.startTick / midi.ppq, pitchClass: n.pitch % 12 }))
      const transitions = selectedTransitions(arrangement)
      expect(transitions.length, `seed ${seed}: 検証できる Transition 区間が少なすぎる`).toBeGreaterThanOrEqual(MINIMUM_CHECKED_SECTIONS_PER_SEED)
      for (const transition of transitions) {
        for (const note of transition.notes) {
          expect(sounds(sounded, note), `seed ${seed} ${transition.sectionId} (${transition.character}) beat ${note.startBeat} pitch ${note.pitch}`).toBe(true)
        }
      }
    }
  })

  it("keeps the same notes in the full-song MIDI", () => {
    const p = fixture()
    for (const seed of seeds) {
      const arrangement = generateFullSongArrangement(p, { seed })
      const midi = parseMidi(exportArrangementMidi(p, arrangement))
      const transitionTracks = midi.tracks.filter((t) => t.name === ARRANGEMENT_TRACK_NAMES[TRACK])
      expect(transitionTracks.length, `seed ${seed}: 全体MIDIに Transition のトラックがない`).toBeGreaterThan(0)
      const sounded = transitionTracks.flatMap((t) => t.notes).map((n) => ({ beat: n.startTick / midi.ppq, pitchClass: n.pitch % 12 }))
      for (const transition of selectedTransitions(arrangement)) {
        for (const note of transition.notes) {
          expect(sounds(sounded, note), `seed ${seed} ${transition.sectionId} beat ${note.startBeat}`).toBe(true)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 要件3-2：反復する層（管理対象）の交代を、書き出しMIDIで独立に検証する。
//
// 管理対象は PR #193 で合意した分類。主ベース、すべての打楽器、Transition・最終リフト・高域の装飾
// （境界アクセント）、曲の終わり（Outro）への境界は対象にしない。
// 実装の密度式や計画の値は使わず、書き出した音が実際に鳴っている小節だけを数える。
// ---------------------------------------------------------------------------
const MANAGED_IDS: ReadonlySet<string> = new Set([
  "syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide", "syn-stabs",
  "syn-pulse", "syn-arp-low", "syn-arp-high", "syn-sub-bass", "syn-bass-mid",
])
const isManaged = (id: string) => id.startsWith("str-") || MANAGED_IDS.has(id)
/** 境界の前2小節から後ろ何小節までを見るか（計画の繰越を許して +4）。 */
const WINDOW_BEFORE = 2
const WINDOW_AFTER = 4
const MAX_STRUCTURAL_CHANGES_PER_BAR = 2
/**
 * 1小節以内の休符は、周期的な休符（隔小節の休み、短いベース層、アルペジオの息継ぎ）とみなして
 * 鳴り続けている扱いにする。2小節以上の無音を、構造的な退出と入場として数える。
 * 3seedの出力では、区間の内側の休符は1小節（アルペジオ1件だけ2小節）、構造的な不在は8小節だった。
 */
const REST_TOLERANCE_BARS = 1

/** その小節に、音が実際に重なって鳴っているか。 */
function soundingBars(notes: { startBeat: number, endBeat: number }[], totalBars: number, beatsPerBar: number): boolean[] {
  return Array.from({ length: totalBars }, (_, bar) =>
    notes.some((n) => n.startBeat < (bar + 1) * beatsPerBar && n.endBeat > bar * beatsPerBar + .01))
}

/** 両側を鳴っている小節に挟まれた、tolerance 以下の無音を埋める（曲頭・曲末の無音は埋めない）。 */
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

/** 境界ごとの、窓の中の小節別の管理対象の構造的な交代数。 */
function managedChanges(p: ComposerProject, arrangement: Arrangement) {
  const midi = parseMidi(exportArrangementMidi(p, arrangement))
  const beatsPerBar = 4
  const totalBars = Math.max(...p.sections.map((s) => s.startBar + s.lengthBars - 1))
  const idByName = new Map(Object.entries(ARRANGEMENT_TRACK_NAMES).map(([id, name]) => [name, id as ArrangementTrackId]))
  const presence = midi.tracks.flatMap((t) => {
    const id = idByName.get(t.name)
    if (!id || !isManaged(id) || !t.notes.length) return []
    const notes = t.notes.map((n) => ({ startBeat: n.startTick / midi.ppq, endBeat: (n.startTick + n.durationTicks) / midi.ppq }))
    return [{ id, on: bridgeShortRests(soundingBars(notes, totalBars, beatsPerBar), REST_TOLERANCE_BARS) }]
  })
  return p.sections.flatMap((section, index) => {
    const previous = p.sections[index - 1]
    // 8小節以上の隣り合う区間だけを見る。曲の終わり（Outro）への境界は、土台の停止を含むため対象外。
    if (!previous || previous.lengthBars < 8 || section.lengthBars < 8 || section.role === "outro") return []
    const boundary = section.startBar - 1
    const perBar = Array.from({ length: WINDOW_BEFORE + WINDOW_AFTER + 1 }, (_, k) => {
      const d = k - WINDOW_BEFORE
      const bar = boundary + d
      return {
        offset: d,
        changed: presence.filter((t) => t.on[bar - 1] !== t.on[bar]).map((t) => t.id),
      }
    })
    return [{ sectionId: section.id, role: section.role, perBar }]
  })
}

describe("repeating layers change gradually around section boundaries in the exported MIDI", () => {
  it("changes at most two managed layers per bar from two bars before to four bars after each boundary", () => {
    const p = fixture()
    for (const seed of seeds) {
      const arrangement = generateFullSongArrangement(p, { seed })
      const boundaries = managedChanges(p, arrangement)
      expect(boundaries.length, `seed ${seed}: 検証できる境界がない`).toBeGreaterThan(0)
      for (const boundary of boundaries) {
        for (const bar of boundary.perBar) {
          expect(
            bar.changed.length,
            `seed ${seed} into ${boundary.role} (${boundary.sectionId}) at bar ${bar.offset >= 0 ? "+" : ""}${bar.offset}: ${bar.changed.join(", ")}`,
          ).toBeLessThanOrEqual(MAX_STRUCTURAL_CHANGES_PER_BAR)
        }
      }
    }
  })

  it("still lets the repeating layers arrive and leave (the limit is not met by removing them)", () => {
    const p = fixture()
    for (const seed of seeds) {
      const boundaries = managedChanges(p, generateFullSongArrangement(p, { seed }))
      // 窓全体でみて、管理対象のどれかは入場か退出している。何も変わらない出力で上限を満たさない。
      const total = boundaries.flatMap((b) => b.perBar).reduce((sum, bar) => sum + bar.changed.length, 0)
      expect(total, `seed ${seed}: 境界で管理対象が1つも交代していない`).toBeGreaterThanOrEqual(boundaries.length)
    }
  })
})
