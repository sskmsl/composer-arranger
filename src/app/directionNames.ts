import type { WholeSongDirectionId } from "@/ai-arranger/wholeSongDirectionPlan"

/** 全曲の5つの方向の、画面に出す日本語の名前 */
export const DIRECTION_NAMES: Record<WholeSongDirectionId, string> = {
  "preserve-space": "余白を生かす",
  "controlled-escalation": "壮大に盛り上げる",
  "rhythmic-propulsion": "リズムで押し進める",
  "motif-relay": "陰影と意外性",
  "balanced-architecture": "バランスよく",
}

/** 方向のカードに出す、ひと言の説明 */
export const DIRECTION_DESCRIPTIONS: Record<WholeSongDirectionId, string> = {
  "preserve-space": "音を足しすぎず、響きと余韻で広がりを出す",
  "controlled-escalation": "弦などを少しずつ重ねて、山場へ盛り上げる",
  "rhythmic-propulsion": "ドラムやベースの刻みで、曲を前へ進める",
  "motif-relay": "暗い響きや意外な音で、陰影をつける",
  "balanced-architecture": "主旋律を引き立てる、自然な編成",
}

/** 方向を選んだとき、作るボタンの横に出す説明 */
export const DIRECTION_DETAILS: Record<WholeSongDirectionId, string> = {
  "preserve-space": "静かなセクションにはほとんど足さず、つなぎ目や余韻の一音で奥行きを作ります。",
  "controlled-escalation": "セクションごとに鳴らすパートを入れ替え、いちばん厚い響きはサビの山場まで取っておきます。",
  "rhythmic-propulsion": "セクションごとに刻み方を変え、抜き差しで前へ進む感じを作ります。",
  "motif-relay": "イントロの印象的な音型を、ほかのパートやつなぎ目で形を変えて返します。",
  "balanced-architecture": "主旋律を主役にして、刻み・対旋律・つなぎを必要なセクションだけに置きます。",
}
