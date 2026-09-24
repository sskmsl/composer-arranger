import type { WholeSongDirectionId } from "@/ai-arranger/wholeSongDirectionPlan"

/** 全曲の5つの方向の、画面に出す日本語の名前 */
export const DIRECTION_NAMES: Record<WholeSongDirectionId, string> = {
  "preserve-space": "余白を生かす",
  "controlled-escalation": "壮大に盛り上げる",
  "rhythmic-propulsion": "リズムで押し進める",
  "motif-relay": "陰影と意外性",
  "balanced-architecture": "バランスよく",
}
