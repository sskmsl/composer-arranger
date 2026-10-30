import type { ComposerProject } from "@/core/project"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import type { GuitarRiffDecision } from "@/melody-engine/guitarRiffDecision"

import type { ArrangementRecipe } from "@/core/arrangementChat"

export interface GenerationRequest {
  project: ComposerProject
  options: Parameters<typeof generateFullSongArrangement>[1]
}
export type WorkerGenerationRequest = GenerationRequest
  | { operation: "recipe"; project: ComposerProject; recipe: ArrangementRecipe }
  | { operation: "restore"; project: ComposerProject; versionId: string }
export type GenerationResponse =
  | { type: "result"; arrangement: FullSongArrangement | undefined; decision?: GuitarRiffDecision }
  | { type: "error" }
