import type {
  ComposerRule,
  ComposerRuleContext,
  ComposerTechniqueAxis,
  ResolvedAxisPreference,
  ResolvedComposerRules,
  WeightedTechniqueValue,
} from "./types"
import type { SeededRandom } from "@/core/rng"

function contextRelevance(
  rule: ComposerRule,
  context: ComposerRuleContext,
): number {
  const when = rule.when
  if (
    when.generatorTargets &&
    !when.generatorTargets.includes(context.generatorTarget)
  ) {
    return 0
  }
  if (when.sectionRoles && !when.sectionRoles.includes(context.sectionRole)) {
    return 0
  }
  if (
    when.transitions &&
    (!context.transition || !when.transitions.includes(context.transition))
  ) {
    return 0
  }
  if (
    when.targetEnergy &&
    (!context.targetEnergy ||
      !when.targetEnergy.includes(context.targetEnergy))
  ) {
    return 0
  }
  let relevance = 0.55
  if (when.generatorTargets) relevance += 0.15
  if (when.sectionRoles) relevance += 0.1
  if (when.transitions) relevance += 0.1
  if (when.targetEnergy) relevance += 0.1
  return Math.min(1, relevance)
}

function normalizedValues(
  values: Map<string, number>,
): WeightedTechniqueValue[] {
  const total = [...values.values()].reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return []
  return [...values.entries()]
    .map(([value, weight]) => ({ value, weight: weight / total }))
    .sort((left, right) => right.weight - left.weight)
}

/**
 * 同じ軸に複数の知識層が該当する場合、最高Priority層だけを採用する。
 * これによりTechnique(priority 50)がArtist Intelligence(priority 100)を
 * 希釈・上書きすることを防ぐ。
 */
export function resolveComposerRules(
  rules: ComposerRule[],
  context: ComposerRuleContext,
): ResolvedComposerRules {
  const active = rules
    .filter((rule) => rule.status === "validated")
    .map((rule) => ({
      rule,
      relevance: contextRelevance(rule, context),
    }))
    .filter((entry) => entry.relevance > 0)
  const preferences: ResolvedComposerRules["preferences"] = {}

  const axes = new Set<ComposerTechniqueAxis>()
  for (const { rule } of active) {
    for (const axis of Object.keys(rule.prefer) as ComposerTechniqueAxis[]) {
      axes.add(axis)
    }
  }

  for (const axis of axes) {
    const matching = active.filter(
      ({ rule }) => (rule.prefer[axis]?.length ?? 0) > 0,
    )
    const priority = Math.max(...matching.map(({ rule }) => rule.priority))
    const winning = matching.filter(({ rule }) => rule.priority === priority)
    const weights = new Map<string, number>()
    for (const { rule, relevance } of winning) {
      for (const preference of rule.prefer[axis] ?? []) {
        const effectiveWeight =
          Math.max(0, preference.weight) *
          Math.max(0, Math.min(1, rule.confidence)) *
          relevance
        weights.set(
          preference.value,
          (weights.get(preference.value) ?? 0) + effectiveWeight,
        )
      }
    }
    const values = normalizedValues(weights)
    if (values.length === 0) continue
    const resolved: ResolvedAxisPreference = {
      axis,
      priority,
      values,
      contributingRuleIds: winning.map(({ rule }) => rule.id),
    }
    preferences[axis] = resolved
  }

  return {
    context,
    preferences,
    appliedRuleIds: [
      ...new Set(
        Object.values(preferences).flatMap(
          (preference) => preference?.contributingRuleIds ?? [],
        ),
      ),
    ],
  }
}

export function techniquePreferenceWeight(
  resolved: ResolvedComposerRules | undefined,
  axis: ComposerTechniqueAxis,
  value: string,
): number {
  if (!resolved) return 0
  return (
    resolved.preferences[axis]?.values.find(
      (preference) => preference.value === value,
    )?.weight ?? 0
  )
}

export function pickTechniquePreference<T extends string>(
  rng: SeededRandom,
  resolved: ResolvedComposerRules | undefined,
  axis: ComposerTechniqueAxis,
  allowedValues: readonly T[],
  fallback: T,
): T {
  const axisPreference = resolved?.preferences[axis]
  const preferences = axisPreference?.values.filter(
    (preference): preference is WeightedTechniqueValue & { value: T } =>
      allowedValues.includes(preference.value as T),
  )
  if (!preferences || preferences.length === 0) return fallback
  const influence =
    (axisPreference?.priority ?? 0) >= 100
      ? 0.85
      : (axisPreference?.priority ?? 0) >= 50
        ? 0.55
        : 0.3
  const weights = new Map<T, number>()
  for (const preference of preferences) {
    weights.set(
      preference.value,
      (weights.get(preference.value) ?? 0) +
        preference.weight * influence,
    )
  }
  weights.set(
    fallback,
    (weights.get(fallback) ?? 0) + (1 - influence),
  )
  return rng.weightedPick(
    [...weights.keys()],
    [...weights.values()],
  )
}
