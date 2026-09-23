import { useEffect, useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { TopBar } from "./TopBar"
import { LeftPanel } from "./LeftPanel"
import { RightPanel } from "./RightPanel"
import { BottomBar } from "./BottomBar"
import { MelodyWorkspace } from "./MelodyWorkspace"
import { TimingMigrationBanner } from "./TimingMigrationBanner"
import { ArrangementWorkspace } from "./ArrangementWorkspace"
import { AuditionWorkspace } from "./AuditionWorkspace"
import { PhraseWorkspace } from "./PhraseWorkspace"
import { CounterWorkspace } from "./CounterWorkspace"
import { DecorationWorkspace } from "./DecorationWorkspace"
import { SignaturePhraseWorkspace } from "./SignaturePhraseWorkspace"
import { AiPartnerWorkspace } from "./AiPartnerWorkspace"
import { CLOUD_SYNC_COMPLETED_EVENT } from "@/features/sync/projectSync"
import { ImportStartGuide } from "./ImportStartGuide"
import { HomeWorkspace } from "./HomeWorkspace"

export type MainTab =
  | "home"
  | "melody"
  | "phrase"
  | "signature"
  | "counter"
  | "decoration"
  | "ai-partner"
  | "arrangement"
  | "audition"

export function App() {
  const project = useProjectStore((s) => s.project)
  const hydrate = useProjectStore((s) => s.hydrate)
  const hydrated = useProjectStore((s) => s.hydrated)
  const [tab, setTab] = useState<MainTab>("home")
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [importGuideOpen, setImportGuideOpen] = useState(false)
  const [aiPartnerInitialPrompt, setAiPartnerInitialPrompt] = useState<string | null>(null)
  const [returnToAiPartner, setReturnToAiPartner] = useState(false)

  const navigateFromAiPartner = (nextTab: MainTab) => {
    if (nextTab !== "ai-partner") setReturnToAiPartner(true)
    setTab(nextTab)
  }

  const changeTopTab = (nextTab: MainTab) => {
    setReturnToAiPartner(false)
    // 描画時点の project ではなく最新の状態を見る。曲を読み込んだ直後(MIDI取り込み・
    // Chord Generator取り込み・保存した曲を開く)に同じ処理内で呼ばれると、描画時点の
    // project はまだセクション0件のため、読み込んだのにホームへ戻されていた
    const hasSections = useProjectStore.getState().project.sections.length > 0
    setTab(nextTab === "home" || hasSections ? nextTab : "home")
  }

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const refreshAfterCloudSync = () => void hydrate()
    window.addEventListener(CLOUD_SYNC_COMPLETED_EVENT, refreshAfterCloudSync)
    return () => window.removeEventListener(
      CLOUD_SYNC_COMPLETED_EVENT,
      refreshAfterCloudSync,
    )
  }, [hydrate])

  useEffect(() => {
    if (hydrated && project.sections.length === 0 && tab !== "home") {
      setTab("home")
    }
  }, [hydrated, project.sections.length, tab])

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-black text-body-muted">
        読み込み中…
      </div>
    )
  }

  const useBrowserScroll = tab === "arrangement"

  return (
    <div className={`flex flex-col bg-surface-black text-body-on-dark ${useBrowserScroll ? "min-h-dvh overflow-x-clip" : "h-dvh overflow-hidden"}`}>
      <TopBar
        tab={tab}
        onTabChange={changeTopTab}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
      />
      <TimingMigrationBanner />
      <div className={`relative flex min-h-0 flex-1 ${useBrowserScroll ? "overflow-visible" : "overflow-hidden"}`}>
        {returnToAiPartner && tab !== "ai-partner" && (
          <button
            type="button"
            onClick={() => {
              setTab("ai-partner")
              setReturnToAiPartner(false)
            }}
            className="absolute left-1/2 top-2 z-[55] -translate-x-1/2 rounded-pill border border-primary/50 bg-surface-tile-3 px-4 py-2 text-[12px] font-medium text-primary-on-dark shadow-xl hover:bg-primary/15"
          >
            ← AI Partnerの全曲候補一覧へ戻る
          </button>
        )}
        {tab === "home" && <HomeWorkspace onNavigate={changeTopTab} />}
        {tab === "melody" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} onOpenImportGuide={() => setImportGuideOpen(true)} />
            <MelodyWorkspace
              onNavigate={setTab}
              onOpenProjectPanel={() => setLeftOpen(true)}
            />
            <RightPanel open={rightOpen} onClose={() => setRightOpen(false)} />
            {(leftOpen || rightOpen) && (
              <div
                className="absolute inset-0 z-30 bg-black/50 lg:hidden"
                onClick={() => {
                  setLeftOpen(false)
                  setRightOpen(false)
                }}
              />
            )}
          </>
        )}
        {tab === "phrase" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} onOpenImportGuide={() => setImportGuideOpen(true)} />
            <PhraseWorkspace />
            <RightPanel open={rightOpen} onClose={() => setRightOpen(false)} mode="phrase" />
            {(leftOpen || rightOpen) && (
              <div
                className="absolute inset-0 z-30 bg-black/50 lg:hidden"
                onClick={() => {
                  setLeftOpen(false)
                  setRightOpen(false)
                }}
              />
            )}
          </>
        )}
        {tab === "signature" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} onOpenImportGuide={() => setImportGuideOpen(true)} />
            <SignaturePhraseWorkspace />
            <RightPanel
              open={rightOpen}
              onClose={() => setRightOpen(false)}
              mode="signature"
            />
            {(leftOpen || rightOpen) && (
              <div
                className="absolute inset-0 z-30 bg-black/50 lg:hidden"
                onClick={() => {
                  setLeftOpen(false)
                  setRightOpen(false)
                }}
              />
            )}
          </>
        )}
        {tab === "counter" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} onOpenImportGuide={() => setImportGuideOpen(true)} />
            <CounterWorkspace />
            <RightPanel open={rightOpen} onClose={() => setRightOpen(false)} mode="counter" />
            {(leftOpen || rightOpen) && (
              <div
                className="absolute inset-0 z-30 bg-black/50 lg:hidden"
                onClick={() => {
                  setLeftOpen(false)
                  setRightOpen(false)
                }}
              />
            )}
          </>
        )}
        {tab === "decoration" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} onOpenImportGuide={() => setImportGuideOpen(true)} />
            <DecorationWorkspace />
            <RightPanel open={rightOpen} onClose={() => setRightOpen(false)} mode="decoration" />
            {(leftOpen || rightOpen) && (
              <div
                className="absolute inset-0 z-30 bg-black/50 lg:hidden"
                onClick={() => {
                  setLeftOpen(false)
                  setRightOpen(false)
                }}
              />
            )}
          </>
        )}
        <div className={tab === "ai-partner" ? "contents" : "hidden"}>
          <AiPartnerWorkspace
            onNavigate={navigateFromAiPartner}
            initialPrompt={aiPartnerInitialPrompt}
            onInitialPromptConsumed={() => setAiPartnerInitialPrompt(null)}
          />
        </div>
        {tab === "arrangement" && <ArrangementWorkspace onNavigate={setTab} />}
        {tab === "audition" && <AuditionWorkspace />}
      </div>
      {tab !== "home" &&
        tab !== "phrase" &&
        tab !== "signature" &&
        tab !== "counter" &&
        tab !== "decoration" &&
        tab !== "ai-partner" && (
        <BottomBar />
      )}
      {importGuideOpen && project.sourceImport?.type === "midi" && (
        <ImportStartGuide
          project={project}
          onClose={() => setImportGuideOpen(false)}
          onReview={() => {
            setTab("arrangement")
            setLeftOpen(false)
            setRightOpen(false)
            setImportGuideOpen(false)
          }}
          onConsult={(prompt) => {
            setAiPartnerInitialPrompt(prompt)
            setTab("ai-partner")
            setLeftOpen(false)
            setRightOpen(false)
            setImportGuideOpen(false)
          }}
        />
      )}
    </div>
  )
}
