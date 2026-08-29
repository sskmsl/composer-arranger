import { describe, expect, it } from "vitest"
import type {
  AiArrangementIntent,
  AiArrangementResponse,
  AiPartnerSession,
} from "./types"
import {
  appendConversationTurn,
  conversationContextForSession,
  MAX_AI_CONVERSATION_TURNS,
  removeConversationConstraint,
} from "./conversation"

function intent(title: string): AiArrangementIntent {
  return {
    id: title,
    title,
    generator: "signature",
    emotionalFunction: "余白から不穏さを立ち上げる",
    density: "sparse",
    register: "middle",
    drama: "restrained",
    motion: "wave",
    rhythmCharacter: "spacious",
    silenceStrategy: "structural",
    creativeRisk: "bold",
    lengthBars: 4,
    techniques: ["negative space"],
    soundPalette: "dark synth",
    performanceDirection: "leave rests",
    why: "主旋律を守るため",
    generationBrief: "短い核と長い休符",
    soundSourceSuggestions: [],
    accompanimentPatternId: "none",
    rhythmPlan: {
      enabled: false,
      subdivision: "eighth",
      feel: "straight",
      kickPattern: "",
      snarePattern: "",
      hatPattern: "",
      percussionPattern: "",
      variation: "",
      bars: 1,
      events: [],
    },
  }
}

function response(id: string, constraints: string[]): AiArrangementResponse {
  return {
    requestId: id,
    createdAt: `2026-08-19T00:00:${id.padStart(2, "0")}.000Z`,
    model: "test",
    partnerReply: "主旋律を維持したまま、余白を増やして更新しました。",
    confirmedConstraints: constraints,
    diagnosis: {
      currentStrength: "主旋律",
      primaryOpportunity: "余白",
      protect: ["主旋律"],
      avoid: ["過密"],
      noAdditionRecommended: false,
      audioEvidence: [],
      audioConfidenceNote: "test",
    },
    intents: [intent("A"), intent("B"), intent("C")],
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, estimatedCostUsd: 0 },
  }
}

describe("AI Partner conversation", () => {
  it("曲全体の会話履歴をSection履歴と別の永続キーで保持できる", () => {
    const session = appendConversationTurn(
      "__whole_song__",
      undefined,
      "曲全体でサビへ向かう",
      response("0", ["主旋律は変えない"]),
    )
    expect(session.sectionId).toBe("__whole_song__")
    expect(session.turns[0].userMessage).toBe("曲全体でサビへ向かう")
  })

  it("同一Sectionへ会話を追加し、最新の確定制約を保持する", () => {
    const first = appendConversationTurn("intro", undefined, "メロディは変えない", response("1", ["メロディは変えない"]))
    const second = appendConversationTurn("intro", first, "もっと不穏に", response("2", ["メロディは変えない", "もっと不穏にする"]))
    expect(second.turns).toHaveLength(2)
    expect(second.confirmedConstraints).toEqual(["メロディは変えない", "もっと不穏にする"])
  })

  it("APIへは必要な会話要約だけを渡し、MIDIイベントやusageを再送しない", () => {
    const session = appendConversationTurn("intro", undefined, "余白を増やす", response("1", ["音数を増やさない"]))
    const context = conversationContextForSession(session)
    expect(context?.turns[0].directions[0]).toEqual({
      title: "A",
      generator: "signature",
      emotionalFunction: "余白から不穏さを立ち上げる",
      generationBrief: "短い核と長い休符",
    })
    expect(JSON.stringify(context)).not.toContain("estimatedCostUsd")
    expect(JSON.stringify(context)).not.toContain("rhythmPlan")
    expect(JSON.stringify(session.turns)).not.toContain("estimatedCostUsd")
    expect(session.latestResponse?.requestId).toBe("1")
  })

  it("長期会話を上限内へ保ち、SectionごとのProject同期を肥大化させない", () => {
    let session: AiPartnerSession | undefined
    for (let index = 0; index < MAX_AI_CONVERSATION_TURNS + 3; index += 1) {
      session = appendConversationTurn("intro", session, `turn ${index}`, response(String(index), []))
    }
    expect(session?.turns).toHaveLength(MAX_AI_CONVERSATION_TURNS)
    expect(session?.turns[0].userMessage).toBe("turn 3")
  })

  it("ユーザーが解除した制約だけを次ターンから外す", () => {
    const session = appendConversationTurn("intro", undefined, "条件", response("1", ["ベルは使わない", "音数を増やさない"]))
    expect(removeConversationConstraint(session, "ベルは使わない").confirmedConstraints).toEqual(["音数を増やさない"])
  })
})
