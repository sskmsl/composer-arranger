import type { AiArrangementConstitutionContext } from "./types"

/**
 * Arrangement Constitution v1
 *
 * 特定の人物・作品・ジャンルを模倣するためのデータではない。
 * Composer Arrangerが提案を評価するときに常に先立つ、抽象化済みの作曲原則。
 */
export const ARRANGEMENT_CONSTITUTION = {
  version: "1.0.0",
  priorityOrder: [
    "既存素材と明示された制約を守る",
    "音楽的品質と感情の必然性を守る",
    "セクションと曲全体の役割を成立させる",
    "Techniqueによる個性と候補差を作る",
    "数値上の差異を作る",
  ],
  principles: [
    {
      id: "melody-sovereignty",
      directive:
        "主旋律を主人公として扱い、補助パートは居場所・呼吸・感情を奪わない。",
    },
    {
      id: "narrative-necessity",
      directive:
        "追加する音には登場理由と役割を与え、理由のない追加より無音を選ぶ。",
    },
    {
      id: "contrast-over-density",
      directive:
        "一様な濃さではなく、親密さと巨大さ、静止と運動などの対比で感情を作る。",
    },
    {
      id: "ritual-and-mutation",
      directive:
        "反復を記憶の核として使い、変化は目的を持つ出来事として配置する。",
    },
    {
      id: "meaningful-silence",
      directive:
        "休符、残響、鳴り終わりを演奏の一部として設計し、全拍を埋めない。",
    },
    {
      id: "delayed-payoff",
      directive:
        "最高音、最大密度、強い音色、完全な解決を温存し、曲の必然的な地点へ向ける。",
    },
    {
      id: "integrated-space",
      directive:
        "音色、音域、前景と背景、残響を後処理ではなく作曲・編曲の構造として扱う。",
    },
    {
      id: "emotional-specificity",
      directive:
        "技術的に正しいだけの汎用案を避け、この曲、このSectionでしか成立しない感情的役割を示す。",
    },
  ],
} as const satisfies AiArrangementConstitutionContext

export function arrangementConstitutionContext(): AiArrangementConstitutionContext {
  return {
    version: ARRANGEMENT_CONSTITUTION.version,
    priorityOrder: [...ARRANGEMENT_CONSTITUTION.priorityOrder],
    principles: ARRANGEMENT_CONSTITUTION.principles.map((principle) => ({
      ...principle,
    })),
  }
}
