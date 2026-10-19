import type { ArrangementGenerationDirective } from "@/core/arrangementGeneration"
import { intentionWithPatterns, type ArrangementPatternId } from "@/core/arrangementPatterns"
import type { WholeSongArrangementDirection, WholeSongDirectionId } from "@/ai-arranger/wholeSongDirectionPlan"
import { DIRECTION_NAMES } from "./directionNames"

/** 方向カードで決めた値を、生成と音源提案が同じ順序で共有する。 */
export function generateSelectedDirection(
  chosen: Pick<WholeSongArrangementDirection, "id" | "title" | "summary" | "character">,
  saveDirection: (id: WholeSongDirectionId) => void,
  generate: (label: string, brief: string, directive: ArrangementGenerationDirective) => void,
  energyDelta: number,
  patternIds: readonly ArrangementPatternId[] = [],
): void {
  saveDirection(chosen.id)
  // 型の文言は intention にだけ入れる。brief に混ぜると、ドラム・イントロなどの語が音の指示として読まれ、
  // 全曲の入退場の計画が止まってしまう。
  generate(DIRECTION_NAMES[chosen.id], `${chosen.title}。${chosen.summary}`, {
    intention: intentionWithPatterns(chosen.summary, patternIds),
    character: chosen.character,
    energyDelta,
    surpriseLevel: chosen.character === "dark-experimental" ? 0.6 : 0.15,
  })
}
