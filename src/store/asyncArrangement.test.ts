import { beforeEach, expect, it, vi } from "vitest"
import { arrangementReviewSong } from "./arrangementReviewFixtures"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
const runner = vi.hoisted(() => vi.fn())
vi.mock("@/features/arrangement/generationClient", () => ({
  generateArrangementOffThread: runner, restoreArrangementOffThread: vi.fn(),
  isGenerationCancelled: (error: Error) => error.name === "AbortError",
}))
beforeEach(() => { vi.resetModules(); runner.mockReset() })
it("keeps newer edits instead of committing an obsolete generation", async () => {
  const { useProjectStore } = await import("./useProjectStore")
  const project = arrangementReviewSong("A"), arrangement = generateFullSongArrangement(project, { seed: 19 })
  let finish!: (value: typeof arrangement) => void
  runner.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  useProjectStore.setState({ project, history: [], persist: () => {} })
  const promise = useProjectStore.getState().generateDirectionArrangementAsync("label", "brief", { intention: "brief" })
  expect(useProjectStore.getState().arrangementGenerationRunning).toBe(true)
  const edited = { ...project, title: "newer edit" }
  useProjectStore.setState({ project: edited })
  finish(arrangement)
  await expect(promise).rejects.toThrow("曲が変更された")
  expect(useProjectStore.getState().project).toBe(edited)
  expect(useProjectStore.getState().history).toEqual([])
  expect(useProjectStore.getState().arrangementGenerationRunning).toBe(false)
})
it("cancels without applying generated music or adding a generation history entry", async () => {
  const { useProjectStore } = await import("./useProjectStore")
  const project = arrangementReviewSong("A")
  runner.mockImplementation((_request, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("cancel", "AbortError")))
  }))
  useProjectStore.setState({ project, history: [], persist: () => {} })
  const promise = useProjectStore.getState().generateDirectionArrangementAsync("label", "brief", { intention: "brief" })
  const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" })
  useProjectStore.getState().cancelArrangementGeneration()
  await rejected
  expect(useProjectStore.getState().project).toBe(project)
  expect(useProjectStore.getState().history).toEqual([])
  expect(useProjectStore.getState().arrangementGenerationError).toBeNull()
  expect(useProjectStore.getState().arrangementGenerationRunning).toBe(false)
})
it("uses the same generation inputs and commit path as the synchronous API", async () => {
  const { useProjectStore } = await import("./useProjectStore")
  const p = arrangementReviewSong("A")
  const project = { ...p, fullSongArrangement: generateFullSongArrangement(p, { seed: 19 }) }
  useProjectStore.setState({ project, history: [], persist: () => {} })
  useProjectStore.getState().generateDirectionArrangement("label", "brief", { intention: "brief" })
  const expected = useProjectStore.getState().project.fullSongArrangement!
  useProjectStore.setState({ project, history: [] })
  runner.mockImplementation(async ({ project, options }) => generateFullSongArrangement(project, options))
  await useProjectStore.getState().generateDirectionArrangementAsync("label", "brief", { intention: "brief" })
  const actual = useProjectStore.getState().project.fullSongArrangement!
  expect({ ...actual, createdAt: undefined }).toEqual({ ...expected, createdAt: undefined })
  expect(useProjectStore.getState().history).toHaveLength(1)
})
