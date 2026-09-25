import { lazy, Suspense, useEffect, useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { TopBar } from "./TopBar"
import { LeftPanel } from "./LeftPanel"
import { RightPanel } from "./RightPanel"
import { BottomBar } from "./BottomBar"
import { TimingMigrationBanner } from "./TimingMigrationBanner"

// 作業画面は開いたときに読み込む(最初の画面=ホームで使わないコードを初回の読み込みから外す)
const MelodyWorkspace = lazy(() => import("./MelodyWorkspace").then((m) => ({ default: m.MelodyWorkspace })))
const ArrangementWorkspace = lazy(() => import("./ArrangementWorkspace").then((m) => ({ default: m.ArrangementWorkspace })))
const AuditionWorkspace = lazy(() => import("./AuditionWorkspace").then((m) => ({ default: m.AuditionWorkspace })))
const PhraseWorkspace = lazy(() => import("./PhraseWorkspace").then((m) => ({ default: m.PhraseWorkspace })))
const CounterWorkspace = lazy(() => import("./CounterWorkspace").then((m) => ({ default: m.CounterWorkspace })))
const DecorationWorkspace = lazy(() => import("./DecorationWorkspace").then((m) => ({ default: m.DecorationWorkspace })))
const SignaturePhraseWorkspace = lazy(() =>
  import("./SignaturePhraseWorkspace").then((m) => ({ default: m.SignaturePhraseWorkspace })),
)

function WorkspaceLoading() {
  return <div className="flex flex-1 items-center justify-center text-[13px] text-body-muted">読み込み中…</div>
}
import { CLOUD_SYNC_COMPLETED_EVENT } from "@/features/sync/projectSync"
import { ImportStartGuide } from "./ImportStartGuide"
import { HomeWorkspace } from "./HomeWorkspace"
import { MelodyColumn } from "./MelodySubTabs"

export type MainTab =
  | "home"
  | "melody"
  | "phrase"
  | "signature"
  | "counter"
  | "decoration"
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
  // 取り込み案内の「相談する」から、アレンジ相談の入力欄へ渡す文面
  const [chatDraft, setChatDraft] = useState<string | null>(null)

  const changeTopTab = (nextTab: MainTab) => {
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
        onOpenImportGuide={() => setImportGuideOpen(true)}
      />
      <TimingMigrationBanner />
      <div className={`relative flex min-h-0 flex-1 ${useBrowserScroll ? "overflow-visible" : "overflow-hidden"}`}>
        <Suspense fallback={<WorkspaceLoading />}>
        {tab === "home" && <HomeWorkspace onNavigate={changeTopTab} />}
        {tab === "melody" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
            <MelodyColumn tab={tab} onChange={setTab}>
              <MelodyWorkspace
                onNavigate={setTab}
                onOpenProjectPanel={() => setLeftOpen(true)}
              />
            </MelodyColumn>
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
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
            <MelodyColumn tab={tab} onChange={setTab}>
              <PhraseWorkspace />
            </MelodyColumn>
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
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
            <MelodyColumn tab={tab} onChange={setTab}>
              <SignaturePhraseWorkspace />
            </MelodyColumn>
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
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
            <MelodyColumn tab={tab} onChange={setTab}>
              <CounterWorkspace onNavigate={setTab} />
            </MelodyColumn>
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
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
            <MelodyColumn tab={tab} onChange={setTab}>
              <DecorationWorkspace />
            </MelodyColumn>
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
        {tab === "arrangement" && (
          <ArrangementWorkspace
            onNavigate={setTab}
            chatDraft={chatDraft}
            onChatDraftConsumed={() => setChatDraft(null)}
          />
        )}
        {tab === "audition" && (
          // 聴き比べは主旋律の中の表示。旋律タブの切り替えを上に出したまま全幅で使う
          <MelodyColumn tab={tab} onChange={setTab}>
            <AuditionWorkspace onNavigate={setTab} />
          </MelodyColumn>
        )}
        </Suspense>
      </div>
      {tab !== "home" &&
        tab !== "arrangement" &&
        tab !== "phrase" &&
        tab !== "signature" &&
        tab !== "counter" &&
        tab !== "decoration" && (
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
            setChatDraft(prompt)
            setTab("arrangement")
            setLeftOpen(false)
            setRightOpen(false)
            setImportGuideOpen(false)
          }}
        />
      )}
    </div>
  )
}
