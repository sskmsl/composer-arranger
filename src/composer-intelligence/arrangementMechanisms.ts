import {
  EMOTIONAL_MEANS,
  EMOTIONAL_MECHANISMS,
  type EmotionalMeans,
  type EmotionalMeansId,
  type EmotionalMechanismRequest,
} from "@/core/emotionalMechanism"
import type {
  ResolvedComposerRules,
  TechniqueCategory,
  TechniqueDefinition,
  TechniqueId,
} from "./types"

/**
 * 全曲アレンジの「感情を動かす仕組み」の手段を、Technique として登録する。
 *
 * 根拠は参照録音5本の解析(docs/reviews/arrangement-emotion-mechanisms.md)。5本は同じ制作者の録音で、
 * 独立したGenre Sourceとは言えず、人による検証(Evidence・Principleの確認)もまだない。
 * そのため Draft で登録し、Rule Resolver は実行対象にしない。人が Validated にしたときに初めて、
 * 既定の生成が Auto でこの手段を選ぶ。明示の指定(directive.emotionalMechanisms)はこれに関係なく働く。
 *
 * ID は公開側の予約帯(TECH-8001〜)。Analysis Workspace が発行する連番(TECH-0001〜)とは重ならない。
 */
const CATEGORY_BY_MECHANISM: Record<string, TechniqueCategory> = {
  "expectation-arrival": "arrangement",
  "subtraction-contrast": "arrangement",
  "closure-decay": "dynamics",
  accumulation: "texture",
}

function techniqueFor(means: EmotionalMeans, index: number): TechniqueDefinition {
  const mechanism = EMOTIONAL_MECHANISMS.find((item) => item.id === means.mechanism)!
  return {
    id: `TECH-${8001 + index}` as TechniqueId,
    version: 1,
    status: "draft",
    category: CATEGORY_BY_MECHANISM[means.mechanism] ?? "arrangement",
    observation: `${mechanism.signature}（${means.label}。参照録音5本中${means.observedIn}本で観察）`,
    intent: mechanism.effect,
    generatorTargets: ["arrangement"],
    genreSourceIds: [],
    priority: 50,
    confidence: Math.round((means.observedIn / 5) * 100) / 100,
    lifecycleEvidence: {
      verifiedEvidenceCount: 0,
      distinctGenreSourceCount: 0,
      reproducibilityConfirmed: false,
    },
    rule: {
      when: { generatorTargets: ["arrangement"] },
      prefer: { emotionalMeans: [{ value: means.id, weight: 1 }] },
    },
  }
}

export const ARRANGEMENT_MECHANISM_TECHNIQUES: TechniqueDefinition[] = EMOTIONAL_MEANS.map(techniqueFor)

/**
 * 解決済みのRuleから、仕組みごとに最も重みの大きい手段を1つ選ぶ。
 * 実行層はTechnique名・Evidenceを見ず、手段のIDだけを受け取る。
 */
export function arrangementMeansFromRules(rules: ResolvedComposerRules | undefined): EmotionalMechanismRequest[] {
  const values = rules?.preferences.emotionalMeans?.values ?? []
  const chosen = new Map<string, EmotionalMeansId>()
  for (const { value } of values) {
    const means = EMOTIONAL_MEANS.find((item) => item.id === value)
    if (means && !chosen.has(means.mechanism)) chosen.set(means.mechanism, means.id)
  }
  return [...chosen.entries()].map(([mechanism, means]) => ({
    mechanism: mechanism as EmotionalMechanismRequest["mechanism"],
    means,
  }))
}
