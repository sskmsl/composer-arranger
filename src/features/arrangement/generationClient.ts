import { attachGuitarRiffDecision } from "@/melody-engine/guitarRiffDecision"
import type { FullSongArrangement } from "@/core/arrangementGeneration"
import type { GenerationRequest, GenerationResponse, WorkerGenerationRequest, ProposalPreparationRequest, PreparedProposals } from "./generationProtocol"

export function isGenerationCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function execute(request: WorkerGenerationRequest, signal: AbortSignal): Promise<Exclude<GenerationResponse, { type: "error" }>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("生成を中止しました。", "AbortError")); return }
    let worker: Worker
    try { worker = new Worker(new URL("./arrangement.worker.ts", import.meta.url), { type: "module" }) }
    catch { reject(new Error("全曲アレンジの計算を開始できませんでした。再試行してください。")); return }
    const cleanup = () => {
      worker.terminate()
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      signal.removeEventListener("abort", abort)
    }
    const abort = () => { cleanup(); reject(new DOMException("生成を中止しました。", "AbortError")) }
    signal.addEventListener("abort", abort, { once: true })
    worker.onmessage = (event: MessageEvent<GenerationResponse>) => {
      cleanup()
      if (event.data.type === "error") { reject(new Error("全曲アレンジを作れませんでした。再試行してください。")); return }
      if (event.data.type === "proposals") {
        for (const { arrangement, decision } of event.data.prepared) if (decision) attachGuitarRiffDecision(arrangement, decision)
      } else {
        const { arrangement, decision } = event.data
        if (arrangement && decision) attachGuitarRiffDecision(arrangement, decision)
      }
      resolve(event.data)
    }
    worker.onerror = () => { cleanup(); reject(new Error("全曲アレンジの計算を開始できませんでした。再試行してください。")) }
    worker.onmessageerror = () => { cleanup(); reject(new Error("全曲アレンジの結果を読み込めませんでした。再試行してください。")) }
    try { worker.postMessage(request) } catch { cleanup(); reject(new Error("曲の情報を計算へ渡せませんでした。再試行してください。")) }
  })
}

export async function generateArrangementOffThread(request: GenerationRequest, signal: AbortSignal): Promise<FullSongArrangement> {
  const result = await execute(request, signal)
  if (result.type !== "result" || !result.arrangement) throw new Error("全曲アレンジの結果がありません。")
  return result.arrangement
}
export async function generateRecipeOffThread(request: Extract<WorkerGenerationRequest, { operation: "recipe" }>, signal: AbortSignal): Promise<FullSongArrangement> {
  const result = await execute(request, signal)
  if (result.type !== "result" || !result.arrangement) throw new Error("変更案の結果がありません。")
  return result.arrangement
}
export async function restoreArrangementOffThread(request: Extract<WorkerGenerationRequest, { operation: "restore" }>, signal: AbortSignal): Promise<FullSongArrangement | undefined> {
  const result = await execute(request, signal)
  if (result.type !== "result") throw new Error("版の復元結果を読み込めませんでした。")
  return result.arrangement
}

export async function prepareProposalsOffThread(request: ProposalPreparationRequest, signal: AbortSignal): Promise<PreparedProposals> {
  const result = await execute(request, signal)
  if (result.type !== "proposals") throw new Error("変更案の結果を読み込めませんでした。")
  return result
}
