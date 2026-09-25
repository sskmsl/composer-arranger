import { beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { composerSongExchangeToProject } from "@/core/composerSongExchange"
import { arrangementPartMatrix, projectWithLayerProposal, type ArrangementChatMessage } from "@/core/arrangementChat"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import { useProjectStore } from "@/store/useProjectStore"
import type { AiArrangementIntent, AiArrangementResponse } from "./types"
import { proposalsFromResponse } from "./arrangementChatAdvice"
import {
  buildLayerProposal,
  counterModeFromText,
  counterPreferencesFromText,
  layerKindFromText,
  layerRemovalFromText,
} from "./arrangementLayers"

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/composer-song-exchange.v2.example.json"), "utf8"),
)

/** 最初のセクションにだけ主旋律を採用した曲 */
function songWithMelody() {
  useProjectStore.setState({ project: composerSongExchangeToProject(fixture), history: [], future: [], persist: () => {} })
  const first = normalizeSectionTimeline(useProjectStore.getState().project.sections)[0]
  useProjectStore.getState().generateForSection(first.id)
  const variant = useProjectStore.getState().project.melodyVariants.find((candidate) => candidate.sectionId === first.id)!
  useProjectStore.getState().assignVariantToSection(first.id, variant.id)
  return { project: useProjectStore.getState().project, firstId: first.id }
}

function intent(generator: AiArrangementIntent["generator"]): AiArrangementIntent {
  return {
    id: `intent-${generator}`,
    title: "案",
    generator,
    emotionalFunction: "主旋律に寄り添う",
    density: "sparse",
    register: "middle",
    drama: "restrained",
    motion: "wave",
    rhythmCharacter: "spacious",
    silenceStrategy: "structural",
    creativeRisk: "focused",
    lengthBars: 4,
    techniques: [],
    soundPalette: "",
    performanceDirection: "",
    why: "",
    generationBrief: "主旋律の休符で答える",
    soundSourceSuggestions: [],
    accompanimentPatternId: "none",
    rhythmPlan: { enabled: false, subdivision: "eighth", feel: "straight", kickPattern: "", snarePattern: "", hatPattern: "", percussionPattern: "", variation: "", bars: 1, events: [] },
  }
}

function response(generator: AiArrangementIntent["generator"]): AiArrangementResponse {
  return {
    requestId: "req-1",
    createdAt: "2026-09-25T00:00:00.000Z",
    model: "test",
    partnerReply: "対旋律を足します。",
    confirmedConstraints: [],
    diagnosis: {
      currentStrength: "", primaryOpportunity: "", protect: [], avoid: [],
      noAdditionRecommended: false, audioEvidence: [], audioConfidenceNote: "",
    },
    intents: [intent(generator), intent(generator), intent(generator)],
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, estimatedCostUsd: 0 },
  }
}

describe("相談から対旋律・合いの手を読む", () => {
  it("対旋律と合いの手を言葉から見分ける", () => {
    expect(layerKindFromText(["サビでメロディの後ろに弦の対旋律を流したい"])).toBe("counter")
    expect(layerKindFromText(["裏メロを足して"])).toBe("counter")
    expect(layerKindFromText(["Aメロのフレーズの切れ目にピアノで合いの手を"])).toBe("fill")
    expect(layerKindFromText(["フレーズ間を装飾して"])).toBe("fill")
    expect(layerKindFromText(["サビをもう少し開けた感じにしたい"])).toBeNull()
    expect(layerKindFromText(["Aメロの切れ目でドラムを抜いて"])).toBeNull()
    expect(layerKindFromText(["サビの前に隙間を作って"])).toBeNull()
    expect(layerKindFromText(["休符に何か入れて"])).toBe("fill")
  })

  it("外す指示と、楽器・攻め具合の指定を読む", () => {
    expect(layerRemovalFromText(["対旋律は外して"])).toBe("counter")
    expect(layerRemovalFromText(["合いの手はいらない"])).toBe("fill")
    expect(layerRemovalFromText(["対旋律を足して"])).toBeNull()
    expect(counterPreferencesFromText("弦で控えめに")).toEqual({ preferredStyles: ["string-answer"], preferredCreativeRisks: ["focused"] })
    expect(counterPreferencesFromText("何か足して")).toEqual({})
    expect(counterModeFromText("メロディの上で弦を流して")).toBe("flowing-above")
    expect(counterModeFromText("主旋律に答えるように")).toBe("answer")
    expect(counterModeFromText("対旋律を足して")).toBeNull()
  })
})

describe("対旋律・合いの手の案", () => {
  beforeEach(() => {
    useProjectStore.setState({ history: [], future: [], persist: () => {} })
  })

  it("主旋律のあるセクションに対旋律を作り、ないセクションは理由を付けて外す", () => {
    const { project, firstId } = songWithMelody()
    const layer = buildLayerProposal(project, "counter", { seed: 7, text: "弦で" })
    expect(layer.candidates.map((candidate) => candidate.sectionId)).toEqual([firstId])
    expect(layer.candidates[0].kind).toBe("counter")
    expect(layer.candidates[0].notes.length).toBeGreaterThan(0)
    expect(layer.skipped?.length).toBe(project.sections.length - 1)
    expect(layer.skipped?.[0].reason).toContain("主旋律")

    const matrix = arrangementPartMatrix(projectWithLayerProposal(project, layer), project.fullSongArrangement)
    expect(matrix.find((section) => section.sectionId === firstId)!.cells.counter.noteCount).toBeGreaterThan(0)
  })

  it("相談文が対旋律の話なら、AIの案の種類に関わらず伴奏は変えずに対旋律の案にする", () => {
    const { project, firstId } = songWithMelody()
    const firstName = project.sections.find((section) => section.id === firstId)!.name
    const proposals = proposalsFromResponse(project, response("rhythm"), `${firstName}でメロディの後ろに対旋律を`, [], "reply")
    expect(proposals).toHaveLength(3)
    for (const proposal of proposals) {
      expect(proposal.layer?.kind).toBe("counter")
      expect(proposal.layer?.candidates.map((candidate) => candidate.sectionId)).toEqual([firstId])
      expect(proposal.points.join("\n")).toContain("対旋律を足す")
    }
    // 言葉で指定がなければ、下で流れる・上で流れる・答える の3通り
    expect(proposals.map((proposal) => proposal.title)).toEqual(["主旋律の下で流れる対旋律", "主旋律の上で流れる対旋律", "主旋律に答える対旋律"])
    const section = project.sections.find((candidate) => candidate.id === firstId)!
    const flowing = proposals[0].layer!.candidates[0]
    expect(flowing.role).toBe("counterline")
    expect(flowing.notes.reduce((sum, note) => sum + note.durationBeats, 0)).toBeGreaterThan(section.lengthBars * 4 * 0.6)
    // 3案は別々の対旋律
    expect(new Set(proposals.map((proposal) => JSON.stringify(proposal.layer!.candidates[0].notes.map((note) => [note.startBeat, note.pitch])))).size).toBeGreaterThan(1)
  })

  it("適用すると版になり、前の版へ戻すと対旋律も外れる", () => {
    const { project, firstId } = songWithMelody()
    const proposals = proposalsFromResponse(project, response("counter"), "対旋律を足して", [], "reply")
    const message: ArrangementChatMessage = { id: "m1", role: "assistant", createdAt: "2026-09-25T00:00:00.000Z", text: "", proposals }
    useProjectStore.getState().appendArrangementChatMessages([message])
    useProjectStore.getState().applyArrangementChatProposal("m1", proposals[0].id, project.fullSongArrangement)

    const applied = useProjectStore.getState().project
    expect(applied.sectionReactiveLayerAssignments?.[firstId]).toBe(proposals[0].layer!.candidates[0].id)
    const versions = applied.arrangementChat!.versions
    expect(versions.at(-1)!.layers?.counter[firstId]).toBe(proposals[0].layer!.candidates[0].id)
    expect(versions.at(-1)!.changes.some((change) => change.rowId === "counter" && change.kind === "added")).toBe(true)

    useProjectStore.getState().restoreArrangementVersion(versions[0].id)
    expect(useProjectStore.getState().project.sectionReactiveLayerAssignments?.[firstId]).toBeUndefined()

    // 外す案
    useProjectStore.getState().restoreArrangementVersion(versions.at(-1)!.id)
    const removal = proposalsFromResponse(useProjectStore.getState().project, response("counter"), "対旋律は外して", [], "reply2")
    expect(removal).toHaveLength(1)
    expect(removal[0].layer?.removeSectionIds).toEqual([firstId])
  })

  it("合いの手は主旋律がなくても、コードのあるセクションに作れる", () => {
    useProjectStore.setState({ project: composerSongExchangeToProject(fixture) })
    const project = useProjectStore.getState().project
    const layer = buildLayerProposal(project, "fill", { seed: 3, text: "" })
    expect(layer.candidates.length).toBeGreaterThan(0)
    expect(layer.candidates.every((candidate) => candidate.kind === "decoration")).toBe(true)
  })
})
