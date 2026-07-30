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

export type MainTab =
  | "melody"
  | "phrase"
  | "counter"
  | "decoration"
  | "arrangement"
  | "audition"

export function App() {
  const hydrate = useProjectStore((s) => s.hydrate)
  const hydrated = useProjectStore((s) => s.hydrated)
  const [tab, setTab] = useState<MainTab>("melody")
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-black text-body-muted">
        読み込み中…
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-black text-body-on-dark">
      <TopBar
        tab={tab}
        onTabChange={setTab}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
      />
      <TimingMigrationBanner />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {tab === "melody" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
            <MelodyWorkspace />
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
        {tab === "counter" && (
          <>
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
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
            <LeftPanel open={leftOpen} onClose={() => setLeftOpen(false)} />
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
        {tab === "arrangement" && <ArrangementWorkspace />}
        {tab === "audition" && <AuditionWorkspace />}
      </div>
      {tab !== "phrase" && tab !== "counter" && tab !== "decoration" && (
        <BottomBar />
      )}
    </div>
  )
}
