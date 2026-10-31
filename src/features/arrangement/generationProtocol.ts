import type { AiArrangementResponse } from "@/ai-arranger/types"
import type { ArrangementChatProposal } from "@/core/arrangementChat"
import type { ComposerProject } from "@/core/project"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import type { GuitarRiffDecision } from "@/melody-engine/guitarRiffDecision"

import type { ArrangementRecipe } from "@/core/arrangementChat"

export interface GenerationRequest {
  project: ComposerProject
  options: Parameters<typeof generateFullSongArrangement>[1]
}
export interface ProposalPreparationRequest {
  operation: "proposals"
  project: ComposerProject
  response: AiArrangementResponse
  userMessage: string
  confirmedConstraints: string[]
  idPrefix: string
  consultationStatements: string[]
}
export interface PreparedProposals {
  type: "proposals"
  proposals: ArrangementChatProposal[]
  prepared: Array<{ proposalId: string; arrangement: FullSongArrangement; decision?: GuitarRiffDecision }>
}
export type WorkerGenerationRequest = GenerationRequest
  | ProposalPreparationRequest
  | { operation: "recipe"; project: ComposerProject; recipe: ArrangementRecipe }
  | { operation: "restore"; project: ComposerProject; versionId: string }
export type GenerationResponse =
  | PreparedProposals
  | { type: "result"; arrangement: FullSongArrangement | undefined; decision?: GuitarRiffDecision }
  | { type: "error" }
