import type { RangeSetting } from "./generationParams"

/** 転調する大サビだけ、指定範囲を基準に最大4半音/C6まで拡張する。 */
export function finalChorusRange(configured: RangeSetting, lifted: boolean, keyRise: number): RangeSetting {
  if (!lifted || keyRise < 1 || keyRise > 5) return configured
  const high = Math.min(84, configured.high + Math.min(4, keyRise))
  return { low: Math.min(high, configured.low + keyRise), high }
}
