import { arrangementForVersion } from "@/core/arrangementChat"
import { arrangementFromRecipe } from "@/ai-arranger/arrangementChatAdvice"
import { finalizeFullSongArrangement, generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { guitarRiffDecision } from "@/melody-engine/guitarRiffDecision"
import type { WorkerGenerationRequest, GenerationResponse } from "./generationProtocol"

self.onmessage = (event: MessageEvent<WorkerGenerationRequest>) => {
  let response: GenerationResponse
  try {
    const request = event.data
    let arrangement
    if ("operation" in request && request.operation === "recipe") {
      arrangement = arrangementFromRecipe(request.project, request.recipe)
    } else if ("operation" in request && request.operation === "restore") {
      const restored = arrangementForVersion(request.project.arrangementChat?.versions ?? [], request.versionId,
        (recipe) => generateFullSongArrangement(request.project, recipe))
      arrangement = restored ? finalizeFullSongArrangement(request.project, restored, { refine: false }) : undefined
    } else {
      arrangement = generateFullSongArrangement(request.project, request.options)
    }
    response = { type: "result", arrangement, decision: arrangement ? guitarRiffDecision(arrangement) : undefined }
  } catch { response = { type: "error" } }
  self.postMessage(response)
}
