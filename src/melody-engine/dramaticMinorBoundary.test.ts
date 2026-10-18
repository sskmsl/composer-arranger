import { describe, expect, it } from "vitest"
import { createEmptyProject, type ComposerProject } from "@/core/project"
import { ARRANGEMENT_TRACK_NAMES } from "@/core/arrangementGeneration"
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
