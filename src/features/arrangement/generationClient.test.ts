import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createEmptyProject } from "@/core/project"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { guitarRiffDecision } from "@/melody-engine/guitarRiffDecision"
import { generateArrangementOffThread } from "./generationClient"
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
}
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal("Worker", FakeWorker) })
afterEach(() => vi.unstubAllGlobals())
it("returns an arrangement and restores its separate ephemeral diagnostic", async () => {
  const project = createEmptyProject("transport")
  const arrangement = generateFullSongArrangement(project, { seed: 19 })
  const promise = generateArrangementOffThread({ project, options: { seed: 19 } }, new AbortController().signal)
  const worker = FakeWorker.instances[0]
  worker.onmessage!({ data: { type: "result", arrangement, decision: { overall: "no-candidate", omissions: [] } } } as MessageEvent)
  const result = await promise
  expect(result).toBe(arrangement)
  expect(guitarRiffDecision(result)?.overall).toBe("no-candidate")
  expect(JSON.stringify(result)).not.toContain("omissions")
  expect(worker.terminate).toHaveBeenCalledOnce()
})
it("terminates cancelled work and does not start an already cancelled request", async () => {
  const project = createEmptyProject("cancel"), controller = new AbortController()
  const promise = generateArrangementOffThread({ project, options: {} }, controller.signal)
  const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" })
  controller.abort()
  await rejected
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  expect(FakeWorker.instances[0].onmessage).toBeNull()
  await expect(generateArrangementOffThread({ project, options: {} }, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  expect(FakeWorker.instances).toHaveLength(1)
})
it("reports worker and transport failures instead of leaving a pending job", async () => {
  const request = { project: createEmptyProject("error"), options: {} }
  const first = generateArrangementOffThread(request, new AbortController().signal)
  FakeWorker.instances[0].onerror!()
  await expect(first).rejects.toThrow("計算を開始できませんでした")
  const second = generateArrangementOffThread(request, new AbortController().signal)
  FakeWorker.instances[1].onmessageerror!()
  await expect(second).rejects.toThrow("結果を読み込めませんでした")
})
