import type { ComposerProject } from "@/core/project"
import type { FullSongArrangement } from "@/core/arrangementGeneration"

const cache = new WeakMap<ComposerProject, Map<string, FullSongArrangement>>()
export function preparedProposal(project: ComposerProject, id: string): FullSongArrangement | undefined {
  return cache.get(project)?.get(id)
}
export function rememberPreparedProposals(project: ComposerProject, prepared: ReadonlyArray<{ proposalId: string; arrangement: FullSongArrangement }>): void {
  let entries = cache.get(project)
  if (!entries) { entries = new Map(); cache.set(project, entries) }
  for (const item of prepared) entries.set(item.proposalId, item.arrangement)
}
