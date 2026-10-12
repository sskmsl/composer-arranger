import type { AiArrangementResponseMode } from "./types"

const EXPLICIT_PROPOSAL_REQUEST = /(?:3|三)\s*案.{0,12}(?:作|出|見|提案|ほしい)|変更案.{0,12}(?:作|出|見|提案|ほしい)|(?:案|提案).{0,8}(?:作って|出して|見せて|して|ほしい)|この方向で.{0,8}(?:進め|作って|案)|それで.{0,8}(?:進め|作って|案)/i
const AFFIRMATIVE_WORD = /はい|うん|\bokay\b|\bok\b|お願い|いいね|いいです|いいよ|それで|その方向|進めて|作って|見せて|見たい/i
const AFFIRMATIVE_BLOCKER = /[？?]|いや|でも|ただ|けど|やっぱ|違|ちが|やめ|ない|まだ|待って|もう少し/i

function isShortAffirmativeReply(text: string): boolean {
  const normalized = text.normalize("NFKC").trim()
  return normalized.length <= 24
    && AFFIRMATIVE_WORD.test(normalized)
    && !AFFIRMATIVE_BLOCKER.test(normalized)
}

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
  if (awaitingConfirmation && isShortAffirmativeReply(normalized)) return "proposal"
  return "discussion"
}
