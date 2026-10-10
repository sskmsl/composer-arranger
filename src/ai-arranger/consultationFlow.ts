import type { AiArrangementResponseMode } from "./types"

const EXPLICIT_PROPOSAL_REQUEST = /(?:3|三)\s*案.{0,12}(?:作|出|見|提案|ほしい)|変更案.{0,12}(?:作|出|見|提案|ほしい)|(?:案|提案).{0,8}(?:作って|出して|見せて|して|ほしい)|この方向で.{0,8}(?:進め|作って|案)|それで.{0,8}(?:進め|作って|案)/i
const AFFIRMATIVE_REPLY = /^(?:はい|うん|ok|okay|それで|その方向で|お願いします)[。！!\s]*(?:進めて|作って|お願いします)?[。！!\s]*$/i

/**
 * 普通の質問・希望は必ず相談で止める。案の作成を明言したとき、または直前の確認へ
 * 明確に同意したときだけ、3案の作成へ進める。
 */
export function requestedResponseModeForConsultation(
  text: string,
  awaitingConfirmation = false,
): AiArrangementResponseMode {
  const normalized = text.trim()
  if (EXPLICIT_PROPOSAL_REQUEST.test(normalized)) return "proposal"
  if (awaitingConfirmation && AFFIRMATIVE_REPLY.test(normalized)) return "proposal"
  return "discussion"
}
