import type {
  AiArrangementResponse,
  AiConversationContext,
  AiPartnerSession,
} from "./types"

export const MAX_AI_CONVERSATION_TURNS = 10
export const MAX_AI_CONSTRAINTS = 12

function uniqueConstraints(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    MAX_AI_CONSTRAINTS,
  )
}

export function conversationContextForSession(
  session: AiPartnerSession | undefined,
): AiConversationContext | undefined {
  if (!session || session.turns.length === 0) return undefined
  return {
    confirmedConstraints: uniqueConstraints(session.confirmedConstraints),
    turns: session.turns.slice(-MAX_AI_CONVERSATION_TURNS).map((turn) => ({
      userMessage: turn.userMessage,
      partnerReply: turn.partnerReply,
      confirmedConstraints: uniqueConstraints(turn.confirmedConstraints),
      directions: turn.directions,
    })),
  }
}

export function appendConversationTurn(
  sectionId: string,
  session: AiPartnerSession | undefined,
  userMessage: string,
  response: AiArrangementResponse,
): AiPartnerSession {
  const updatedAt = new Date().toISOString()
  return {
    sectionId,
    updatedAt,
    confirmedConstraints: uniqueConstraints(response.confirmedConstraints),
    latestResponse: response,
    turns: [
      ...(session?.turns ?? []),
      {
        id: response.requestId,
        createdAt: response.createdAt,
        userMessage: userMessage.trim(),
        partnerReply: response.partnerReply,
        confirmedConstraints: uniqueConstraints(response.confirmedConstraints),
        directions: response.intents.map((intent) => ({
          title: intent.title,
          generator: intent.generator,
          emotionalFunction: intent.emotionalFunction,
          generationBrief: intent.generationBrief,
        })),
      },
    ].slice(-MAX_AI_CONVERSATION_TURNS),
  }
}

export function removeConversationConstraint(
  session: AiPartnerSession,
  constraint: string,
): AiPartnerSession {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    confirmedConstraints: session.confirmedConstraints.filter(
      (candidate) => candidate !== constraint,
    ),
  }
}
