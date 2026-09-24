import { beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { composerSongExchangeToProject } from "./composerSongExchange"
import { parseTimeSignature } from "./section"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { useProjectStore } from "@/store/useProjectStore"
import type { ComposerProject } from "./project"

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/composer-song-exchange.v2.example.json"), "utf8"),
)

function songWithArrangement(): ComposerProject {
  const project = composerSongExchangeToProject(fixture)
  return { ...project, fullSongArrangement: generateFullSongArrangement(project, { seed: 7 }) }
}

/** セクションごとの音を、セクション先頭からの位置で並べたもの(並べ替えても変わらないはず) */
function relativeNotes(project: ComposerProject, sectionId: string): string[] {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const section = project.sections.find((candidate) => candidate.id === sectionId)!
  const start = (section.startBar - 1) * beatsPerBar
  return project.fullSongArrangement!.tracks
    .flatMap((track) =>
      track.notes
        .filter((note) => note.sectionId === sectionId)
        .map((note) => `${track.id}:${(note.startBeat - start).toFixed(4)}:${note.pitch}:${note.durationBeats.toFixed(4)}`),
    )
    .sort()
}

function notesInside(project: ComposerProject): boolean {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  return project.fullSongArrangement!.tracks.every((track) =>
    track.notes.every((note) => {
      const section = project.sections.find((candidate) => candidate.id === note.sectionId)
      if (!section) return false
      const start = (section.startBar - 1) * beatsPerBar
      // 始まりはセクション内。伸ばしが次のセクションへ少しかかるのは元の全曲アレンジと同じなので許す
      return note.startBeat >= start - 1e-9 && note.startBeat < start + section.lengthBars * beatsPerBar
    }),
  )
}

beforeEach(() => {
  useProjectStore.setState({ project: songWithArrangement(), history: [], future: [], persist: () => {} })
})

describe("セクションを変えたときに全曲アレンジ(AIのパート)が追従する", () => {
  it("並べ替えても、各セクションの音はそのセクションと一緒に動く", () => {
    const before = useProjectStore.getState().project
    const ids = before.sections.map((section) => section.id)
    const expected = Object.fromEntries(ids.map((id) => [id, relativeNotes(before, id)]))
    useProjectStore.getState().moveSection(ids[0], ids.length - 1)
    const after = useProjectStore.getState().project
    expect(after.sections[after.sections.length - 1].id).toBe(ids[0])
    for (const id of ids) expect(relativeNotes(after, id)).toEqual(expected[id])
    expect(notesInside(after)).toBe(true)
  })

  it("複製すると元のセクションの音が写り、後ろのセクションの音はずれない", () => {
    const before = useProjectStore.getState().project
    const source = before.sections[0]
    const later = before.sections[1]
    const sourceNotes = relativeNotes(before, source.id)
    const laterNotes = relativeNotes(before, later.id)
    useProjectStore.getState().duplicateSection(source.id)
    const after = useProjectStore.getState().project
    const copyId = after.sections[1].id
    expect(relativeNotes(after, copyId)).toEqual(sourceNotes)
    expect(relativeNotes(after, later.id)).toEqual(laterNotes)
    expect(after.fullSongArrangement!.plan.sections.map((plan) => plan.sectionId)).toEqual(after.sections.map((section) => section.id))
    expect(notesInside(after)).toBe(true)
  })

  it("削除したセクションの音は外れ、短くしたセクションからはみ出す音は外れて末尾で切れる", () => {
    const before = useProjectStore.getState().project
    const [first, second] = before.sections
    const secondNotes = relativeNotes(before, second.id)
    useProjectStore.getState().removeSection(first.id)
    let after = useProjectStore.getState().project
    expect(after.fullSongArrangement!.tracks.some((track) => track.notes.some((note) => note.sectionId === first.id))).toBe(false)
    expect(relativeNotes(after, second.id)).toEqual(secondNotes)

    useProjectStore.getState().updateSection(second.id, { lengthBars: 1 })
    after = useProjectStore.getState().project
    expect(notesInside(after)).toBe(true)
    const beatsPerBar = parseTimeSignature(after.song.timeSignature).beatsPerBar
    const shortened = after.sections.find((section) => section.id === second.id)!
    const end = (shortened.startBar - 1 + shortened.lengthBars) * beatsPerBar
    const ownNotes = after.fullSongArrangement!.tracks.flatMap((track) => track.notes.filter((note) => note.sectionId === second.id))
    expect(ownNotes.every((note) => note.startBeat + note.durationBeats <= end + 1e-9)).toBe(true)
  })
})
