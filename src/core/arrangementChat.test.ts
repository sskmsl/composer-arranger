import { beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { composerSongExchangeToProject } from "./composerSongExchange"
import {
  arrangementPartMatrix,
  describeArrangementChanges,
  diffArrangementMatrices,
  emptyArrangementChat,
  partRowsToRemove,
  pushArrangementVersion,
  spliceArrangement,
  withoutPartRows,
  type ArrangementChatMessage,
} from "./arrangementChat"
import type { FullSongArrangement } from "./arrangementGeneration"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import {
  arrangementChatConversation,
  arrangementFromRecipe,
  scopeSectionIdsFromText,
} from "@/ai-arranger/arrangementChatAdvice"
import { useProjectStore } from "@/store/useProjectStore"

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/composer-song-exchange.v2.example.json"), "utf8"),
)

function song() {
  return composerSongExchangeToProject(fixture)
}

/** 指定したトラックの、あるセクションの音だけを消した全曲アレンジ */
function withoutTrackInSection(arrangement: FullSongArrangement, trackId: string, sectionId: string): FullSongArrangement {
  return {
    ...arrangement,
    id: `${arrangement.id}:edited`,
    tracks: arrangement.tracks.map((track) =>
      track.id === trackId ? { ...track, notes: track.notes.filter((note) => note.sectionId !== sectionId) } : track,
    ),
  }
}

describe("アレンジ相談チャット: パート構成表と変化", () => {
  const project = song()
  const arrangement = generateFullSongArrangement(project, { seed: 7 })

  it("セクションごとに8つのパートの音数をまとめ、ミュート中のトラックは数えない", () => {
    const matrix = arrangementPartMatrix(project, arrangement)
    expect(matrix.map((section) => section.sectionId)).toEqual(project.sections.map((section) => section.id))
    const total = matrix.reduce(
      (sum, section) => sum + Object.values(section.cells).reduce((cells, cell) => cells + cell.noteCount, 0),
      0,
    )
    expect(total).toBe(arrangement.tracks.reduce((sum, track) => sum + track.notes.length, 0))
    const muted = { ...arrangement, tracks: arrangement.tracks.map((track) => ({ ...track, muted: true })) }
    expect(arrangementPartMatrix(project, muted).every((section) => Object.values(section.cells).every((cell) => cell.noteCount === 0))).toBe(true)
  })

  it("同じ全曲アレンジどうしは変化なし、パートを外すと「外す」になり文章で説明できる", () => {
    const before = arrangementPartMatrix(project, arrangement)
    expect(diffArrangementMatrices(before, arrangementPartMatrix(project, arrangement))).toEqual([])
    const playing = arrangement.tracks.find((track) => track.notes.length > 0)!
    const sectionId = playing.notes[0].sectionId
    // そのセクションの追加パートをすべて消す
    let edited = arrangement
    for (const track of arrangement.tracks) edited = withoutTrackInSection(edited, track.id, sectionId)
    const changes = diffArrangementMatrices(before, arrangementPartMatrix(project, edited))
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.every((change) => change.sectionId === sectionId && change.kind === "removed")).toBe(true)
    const name = project.sections.find((section) => section.id === sectionId)!.name
    const lines = describeArrangementChanges(changes, project.sections.map((section) => ({ sectionId: section.id, name: section.name })))
    expect(lines).toHaveLength(1)
    expect(lines[0].startsWith(`${name}：`)).toBe(true)
    expect(lines[0]).toContain("を外す")
  })

  it("追加パートがない状態から作ると、鳴るパートはすべて「足す」になる", () => {
    const changes = diffArrangementMatrices(arrangementPartMatrix(project, null), arrangementPartMatrix(project, arrangement))
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.every((change) => change.kind === "added")).toBe(true)
  })
})

describe("アレンジ相談チャット: 版の履歴", () => {
  const arrangement = generateFullSongArrangement(song(), { seed: 7 })

  it("最初の適用では、それまでの全曲アレンジを版として残してから新しい版を積む", () => {
    const chat = pushArrangementVersion(emptyArrangementChat(), arrangement, {
      id: "v-a",
      label: "サビを開く",
      createdAt: "2026-01-01T00:00:00.000Z",
      recipe: { brief: "", seed: 1, revision: 1 },
      arrangementId: "next",
      changes: [],
    })
    expect(chat.versions.map((version) => [version.number, version.source, version.label])).toEqual([
      [1, "existing", "これまでの全曲アレンジ"],
      [2, "chat", "サビを開く"],
    ])
    expect(chat.currentVersionId).toBe("v-a")
    // 続けて適用すると、いまの版が一致していれば基準の版は増やさない
    const next = pushArrangementVersion(chat, { ...arrangement, id: "next" }, {
      id: "v-b",
      label: "Bメロを静かに",
      createdAt: "2026-01-01T00:01:00.000Z",
      recipe: { brief: "", seed: 2, revision: 2 },
      arrangementId: "next-2",
      changes: [],
    })
    expect(next.versions.map((version) => version.number)).toEqual([1, 2, 3])
  })

  it("追加パートがない状態からの最初の適用では「原曲のみ」の版を残す", () => {
    const chat = pushArrangementVersion(emptyArrangementChat(), undefined, {
      id: "v-a",
      label: "案",
      createdAt: "2026-01-01T00:00:00.000Z",
      recipe: { brief: "", seed: 1, revision: 0 },
      arrangementId: "a",
      changes: [],
    })
    expect(chat.versions[0]).toMatchObject({ source: "original", arrangementId: null })
    expect(chat.versions[0].recipe).toBeUndefined()
  })
})

describe("アレンジ相談チャット: 会話と適用", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: song(), history: [], future: [], persist: () => {} })
  })

  function proposalMessage(): ArrangementChatMessage {
    return {
      id: "reply-1",
      role: "assistant",
      createdAt: "2026-01-01T00:00:01.000Z",
      text: "サビを開く案です",
      proposals: [
        {
          id: "p-a",
          label: "案A",
          title: "サビを開く",
          summary: "パッドを外して弦を上げる",
          points: [],
          generator: "arrangement",
          generationBrief: "サビのパッドを外す",
          recipe: { brief: "サビを開く", seed: 11, revision: 1 },
        },
      ],
    }
  }

  it("適用すると全曲アレンジが変わって版が積まれ、前の版へ戻せる", () => {
    const store = useProjectStore.getState()
    store.appendArrangementChatMessages([
      { id: "user-1", role: "user", createdAt: "2026-01-01T00:00:00.000Z", text: "サビを開いて" },
      proposalMessage(),
    ])
    const project = useProjectStore.getState().project
    const arrangement = generateFullSongArrangement(project, { brief: "サビを開く", seed: 11, revision: 1 })
    useProjectStore.getState().applyArrangementChatProposal("reply-1", "p-a", arrangement)
    let state = useProjectStore.getState().project
    expect(state.fullSongArrangement?.id).toBe(arrangement.id)
    expect(state.arrangementChat?.versions.map((version) => version.source)).toEqual(["original", "chat"])
    expect(state.arrangementChat?.messages[1].appliedProposalId).toBe("p-a")
    expect(state.arrangementChat?.versions[1].changes.every((change) => change.kind === "added")).toBe(true)

    // 同じ返事の案は2回適用できない
    useProjectStore.getState().applyArrangementChatProposal("reply-1", "p-a", arrangement)
    expect(useProjectStore.getState().project.arrangementChat?.versions).toHaveLength(2)

    useProjectStore.getState().restoreArrangementVersion(state.arrangementChat!.versions[0].id)
    state = useProjectStore.getState().project
    expect(state.fullSongArrangement).toBeUndefined()
    expect(state.arrangementChat?.currentVersionId).toBe(state.arrangementChat?.versions[0].id)

    // 生成条件から作り直すと同じ全曲アレンジに戻る
    useProjectStore.getState().restoreArrangementVersion(state.arrangementChat!.versions[1].id)
    expect(useProjectStore.getState().project.fullSongArrangement?.id).toBe(arrangement.id)
  })

  it("AIへ渡す会話では、適用した案を返事に添える", () => {
    const store = useProjectStore.getState()
    store.appendArrangementChatMessages(
      [
        { id: "user-1", role: "user", createdAt: "2026-01-01T00:00:00.000Z", text: "サビを開いて" },
        { ...proposalMessage(), appliedProposalId: "p-a" },
      ],
      ["主旋律は変えない"],
    )
    const conversation = arrangementChatConversation(useProjectStore.getState().project.arrangementChat)
    expect(conversation?.confirmedConstraints).toEqual(["主旋律は変えない"])
    expect(conversation?.turns).toHaveLength(1)
    expect(conversation?.turns[0].partnerReply).toContain("「サビを開く」を適用した")
    expect(conversation?.turns[0].directions[0]).toMatchObject({ title: "サビを開く", generationBrief: "サビのパッドを外す" })
  })
})

describe("アレンジ相談チャット: 作り直す範囲", () => {
  const project = song()

  it("相談文やAIの案に出てくるセクションだけを範囲にし、曲全体と言われたら全体にする", () => {
    const chorus = project.sections.filter((section) => section.role === "chorus")
    expect(chorus.length).toBeGreaterThan(0)
    expect(scopeSectionIdsFromText(project, "サビをもう少し開けた感じにしたい", [])).toEqual(chorus.map((section) => section.id))
    expect(scopeSectionIdsFromText(project, "曲全体をもっと静かに", ["サビを抑える"])).toBeUndefined()
    expect(scopeSectionIdsFromText(project, "もう少し暗くしたい", [])).toBeUndefined()
    // 「大サビ」は「サビ」に当たらない
    const grand = project.sections.filter((section) => section.role === "grand-chorus")
    if (grand.length > 0) {
      expect(scopeSectionIdsFromText(project, "大サビだけ厚くしたい", [])).toEqual(grand.map((section) => section.id))
    }
  })

  it("範囲の外は元の版の音をそのまま残し、範囲の中だけ新しい音にする", () => {
    const base = generateFullSongArrangement(project, { seed: 3 })
    const fresh = generateFullSongArrangement(project, { seed: 99 })
    const target = project.sections[1].id
    const spliced = spliceArrangement(base, fresh, [target])
    const notesOf = (arrangement: FullSongArrangement, inside: boolean) =>
      arrangement.tracks.flatMap((track) =>
        track.notes.filter((note) => (note.sectionId === target) === inside).map((note) => `${track.id}:${note.startBeat}:${note.pitch}`),
      ).sort()
    expect(notesOf(spliced, false)).toEqual(notesOf(base, false))
    expect(notesOf(spliced, true)).toEqual(notesOf(fresh, true))
    // 追加パートがない状態からなら、範囲の外は鳴らさない
    expect(notesOf(spliceArrangement(undefined, fresh, [target]), false)).toEqual([])
  })

  it("一部だけ作り直した版は、元の版からたどって同じ全曲アレンジに戻せる", () => {
    useProjectStore.setState({ project: song(), history: [], future: [], persist: () => {} })
    const target = project.sections[0].id
    const store = useProjectStore.getState()
    store.appendArrangementChatMessages([
      { id: "u", role: "user", createdAt: "2026-01-01T00:00:00.000Z", text: "イントロだけ" },
      {
        id: "r",
        role: "assistant",
        createdAt: "2026-01-01T00:00:01.000Z",
        text: "",
        proposals: [{
          id: "p",
          label: "案A",
          title: "イントロ",
          summary: "",
          points: [],
          generator: "arrangement",
          generationBrief: "",
          recipe: { brief: "イントロ", seed: 5, revision: 1, scopeSectionIds: [target] },
        }],
      },
    ])
    const current = useProjectStore.getState().project
    const applied = arrangementFromRecipe(current, current.arrangementChat!.messages[1].proposals![0].recipe)
    useProjectStore.getState().applyArrangementChatProposal("r", "p", applied)
    const versions = useProjectStore.getState().project.arrangementChat!.versions
    expect(versions[1].baseVersionId).toBe(versions[0].id)
    useProjectStore.getState().restoreArrangementVersion(versions[0].id)
    useProjectStore.getState().restoreArrangementVersion(versions[1].id)
    expect(useProjectStore.getState().project.fullSongArrangement?.id).toBe(applied.id)
  })
})

describe("アレンジ相談チャット: パートを外す指示", () => {
  it("外す・抜く・引くを読み取り、打ち消しは外さない", () => {
    expect(partRowsToRemove(["弦は残して、パッドは引いてほしい"])).toEqual(["pad"])
    expect(partRowsToRemove(["Bメロはドラムを抜いて静かに"])).toEqual(["drums"])
    expect(partRowsToRemove(["ドラムは抜かないで", "パッドを外さずに"])).toEqual([])
    expect(partRowsToRemove(["ストリングスをなくしたい"]).sort()).toEqual(["strings-high", "strings-low"])
  })

  it("範囲の中だけ、そのパートの音を外す", () => {
    const project = song()
    const arrangement = generateFullSongArrangement(project, { seed: 7 })
    const target = project.sections[2].id
    const removed = withoutPartRows(arrangement, ["drums"], [target])
    const drumNotes = (candidate: FullSongArrangement, inside: boolean) =>
      candidate.tracks.filter((track) => track.id.startsWith("dr-")).flatMap((track) => track.notes)
        .filter((note) => (note.sectionId === target) === inside).length
    expect(drumNotes(removed, true)).toBe(0)
    expect(drumNotes(removed, false)).toBe(drumNotes(arrangement, false))
  })
})

describe("アレンジ相談チャット: 全曲の方向から作る", () => {
  it("方向で作った全曲アレンジを版として積み、履歴から同じものへ戻せる", () => {
    useProjectStore.setState({ project: song(), history: [], future: [], persist: () => {} })
    useProjectStore.getState().generateDirectionArrangement("余白を生かす", "Minimal", {
      intention: "余白を守る",
      character: "minimal",
      energyDelta: -8,
    })
    const first = useProjectStore.getState().project
    expect(first.arrangementChat?.versions.map((version) => [version.number, version.source, version.label])).toEqual([
      [1, "original", "追加パートなし（原曲のみ）"],
      [2, "direction", "余白を生かす"],
    ])
    const arrangementId = first.fullSongArrangement!.id
    useProjectStore.getState().restoreArrangementVersion(first.arrangementChat!.versions[0].id)
    expect(useProjectStore.getState().project.fullSongArrangement).toBeUndefined()
    useProjectStore.getState().restoreArrangementVersion(first.arrangementChat!.versions[1].id)
    expect(useProjectStore.getState().project.fullSongArrangement?.id).toBe(arrangementId)
  })
})
