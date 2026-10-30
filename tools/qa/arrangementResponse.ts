import type { AiArrangementResponse } from "../../src/ai-arranger/types"
export function arrangementResponseFixture(): AiArrangementResponse {
  return {
    requestId: "worker-response", createdAt: "2026-10-31T00:00:00.000Z", model: "test", responseMode: "proposal",
    partnerReply: "変更案です。", confirmationQuestion: "", confirmedConstraints: [],
    diagnosis: { currentStrength: "", primaryOpportunity: "", protect: [], avoid: [], noAdditionRecommended: false, audioEvidence: [], audioConfidenceNote: "" },
    intents: [0, 1, 2].map((index) => ({
      id: `worker-intent-${index}`, title: `案${index + 1}`, generator: "none", emotionalFunction: "流れを整える",
      density: "sparse", register: "middle", drama: "restrained", motion: "wave", rhythmCharacter: "spacious",
      silenceStrategy: "structural", creativeRisk: "focused", lengthBars: 4, techniques: [], soundPalette: "",
      performanceDirection: "", why: "", generationBrief: "全曲の流れを整える", soundSourceSuggestions: [], accompanimentPatternId: "none",
      rhythmPlan: { enabled: false, subdivision: "eighth", feel: "straight", kickPattern: "", snarePattern: "", hatPattern: "", percussionPattern: "", variation: "", bars: 1, events: [] },
    })),
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, estimatedCostUsd: 0 },
  }
}
