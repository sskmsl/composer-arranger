import type { ArrangementGenerationDirective } from "@/core/arrangementGeneration"
import type { WholeSongArrangementDirection, WholeSongDirectionId } from "@/ai-arranger/wholeSongDirectionPlan"
import { DIRECTION_NAMES } from "./directionNames"

/** 方向カードで決めた値を、生成と音源提案が同じ順序で共有する。 */
export function generateSelectedDirection(
  chosen: Pick<WholeSongArrangementDirection, "id" | "title" | "summary" | "character">,
  saveDirection: (id: WholeSongDirectionId) => void,
  generate: (label: string, brief: string, directive: ArrangementGenerationDirective) => void,
  energyDelta: number,
): void {
  saveDirection(chosen.id)
  generate(DIRECTION_NAMES[chosen.id], `${chosen.title}。${chosen.summary}`, {
    intention: chosen.summary,
    character: chosen.character,
    energyDelta,
    surpriseLevel: chosen.character === "dark-experimental" ? 0.6 : 0.15,
  })
}
