import { loadProject as loadStoredProject, prepareLocalAccount, listProjects } from "../src/storage/projectRepository"
import { selectStorageAccount } from "../src/storage/accountScope"
import { CLOUD_SYNC_COMPLETED_EVENT } from "../src/features/sync/projectSync"
import { arrangementResponseFixture } from "../tools/qa/arrangementResponse"
import { preparedProposal } from "../src/features/arrangement/proposalCache"
// CI専用入口。実Appを使い、認証・外部サービスへは接続しない。
import { createRoot } from "react-dom/client"
import { App } from "../src/app/App"
import "../src/index.css"
import { useProjectStore } from "../src/store/useProjectStore"
import { arrangementReviewSong } from "../src/store/arrangementReviewFixtures"
import { riffMeterSong } from "../tools/qa/riffMeterSong"
import { generateFullSongArrangement, finalizeFullSongArrangement } from "../src/melody-engine/arrangementGenerator"
import { guitarRiffDecision } from "../src/melody-engine/guitarRiffDecision"
import { arrangementFromRecipe } from "../src/ai-arranger/arrangementChatAdvice"
import { arrangementForVersion, emptyArrangementChat, recipeFromArrangement } from "../src/core/arrangementChat"
import { generateArrangementOffThread, generateRecipeOffThread, restoreArrangementOffThread, prepareProposalsOffThread } from "../src/features/arrangement/generationClient"

const plain = (value: unknown) => JSON.stringify(value && { ...value as object, createdAt: undefined })
Object.assign(window, { reliability: {
  async seed() {
    useProjectStore.getState().loadProject(arrangementReviewSong("A"))
    return useProjectStore.getState().flushSave()
  },
  async seedArrangedSong() {
    const project = arrangementReviewSong("A")
    project.fullSongArrangement = generateFullSongArrangement(project, { seed: 19 })
    useProjectStore.getState().loadProject(project)
    return useProjectStore.getState().flushSave()
  },
  stored: () => loadStoredProject(useProjectStore.getState().project.projectId),
  refreshAfterSync: () => window.dispatchEvent(new Event(CLOUD_SYNC_COMPLETED_EVENT)),
  async account(owner: string) {
    selectStorageAccount(owner)
    await prepareLocalAccount(owner)
    window.dispatchEvent(new Event(CLOUD_SYNC_COMPLETED_EVENT))
    await useProjectStore.getState().hydrate()
  },
  storedTitles: async () => (await listProjects()).map((project) => project.title),
  async seedProposal() {
    const project = arrangementReviewSong("A")
    project.fullSongArrangement = generateFullSongArrangement(project, { seed: 19 })
    project.arrangementChat = { ...emptyArrangementChat(), messages: [{
      id: "browser-proposal", role: "assistant", createdAt: new Date().toISOString(), text: "変更案です。",
      proposals: [{ id: "browser-candidate", label: "案A", title: "ブラウザ検証の案", summary: "生成結果を確認する",
        points: [], generator: "test", generationBrief: "", recipe: { ...recipeFromArrangement(project.fullSongArrangement), seed: 41 } }],
    }] }
    useProjectStore.getState().loadProject(project)
    return useProjectStore.getState().flushSave()
  },
  async prepareAdvice() {
    const project = useProjectStore.getState().project
    const response = arrangementResponseFixture()
    const result = await prepareProposalsOffThread({ operation: "proposals", project, response,
      userMessage: "全曲の流れを整えて", confirmedConstraints: [], idPrefix: "worker-reply", consultationStatements: ["全曲の流れを整えて"] }, new AbortController().signal)
    useProjectStore.getState().appendArrangementChatMessages([{ id: "worker-reply", role: "assistant", createdAt: new Date().toISOString(), text: "変更案です。", proposals: result.proposals }], [], result.prepared)
    const published = useProjectStore.getState().project
    return { count: result.prepared.length,
      cached: result.prepared.every((item) => preparedProposal(published, item.proposalId) === item.arrangement),
      sameAfterReply: result.prepared.every((item) => {
        const proposal = result.proposals.find((p) => p.id === item.proposalId)!
        return plain(item.arrangement) === plain(arrangementFromRecipe(published, proposal.recipe))
      }),
    }
  },
  state: () => useProjectStore.getState(),
  async responsiveWorker() {
    let ticks = 0
    const timer = window.setInterval(() => { ticks++ }, 10)
    try {
      const arrangement = await generateArrangementOffThread({ project: riffMeterSong("3/4"), options: { seed: 19 } }, new AbortController().signal)
      return { ticks, tracks: arrangement.tracks.length }
    } finally { window.clearInterval(timer) }
  },
  async compareWorkers() {
    const results: Array<{ name: string; same: boolean; diagnosticSame?: boolean }> = []
    for (const meter of ["4/4", "3/4", "6/8"] as const) for (const seed of [19, 41]) {
      const project = meter === "4/4" ? arrangementReviewSong("A") : riffMeterSong(meter)
      const expected = generateFullSongArrangement(project, { seed })
      const actual = await generateArrangementOffThread({ project, options: { seed } }, new AbortController().signal)
      results.push({ name: `${meter}/${seed}`, same: plain(expected) === plain(actual),
        diagnosticSame: JSON.stringify(guitarRiffDecision(expected)) === JSON.stringify(guitarRiffDecision(actual)) })
    }
    const project = arrangementReviewSong("A")
    project.fullSongArrangement = generateFullSongArrangement(project, { seed: 19 })
    const recipe = { ...recipeFromArrangement(project.fullSongArrangement), seed: 41, scopeSectionIds: [project.sections[2].id] }
    const expected = arrangementFromRecipe(project, recipe)
    const actual = await generateRecipeOffThread({ operation: "recipe", project, recipe }, new AbortController().signal)
    results.push({ name: "scoped recipe", same: plain(expected) === plain(actual) })
    useProjectStore.setState({ project })
    useProjectStore.getState().generateDirectionArrangement("first", "", { intention: "" })
    const withHistory = useProjectStore.getState().project
    const versionId = withHistory.arrangementChat!.versions.at(-1)!.id
    const restored = arrangementForVersion(withHistory.arrangementChat!.versions, versionId,
      (r) => generateFullSongArrangement(withHistory, r))
    const finalized = restored ? finalizeFullSongArrangement(withHistory, restored, { refine: false }) : undefined
    const workerRestored = await restoreArrangementOffThread({ operation: "restore", project: withHistory, versionId }, new AbortController().signal)
    results.push({ name: "restore version", same: plain(finalized) === plain(workerRestored) })
    return results
  },
} })
createRoot(document.getElementById("root")!).render(<App />)
