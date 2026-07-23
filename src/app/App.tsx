import { useEffect, useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { TopBar } from "./TopBar"
import { LeftPanel } from "./LeftPanel"
import { RightPanel } from "./RightPanel"
import { BottomBar } from "./BottomBar"
import { MelodyWorkspace } from "./MelodyWorkspace"
import { ComingSoonTab } from "./ComingSoonTab"

export type MainTab = "melody" | "arrangement" | "audition"

export function App() {
  const hydrate = useProjectStore((s) => s.hydrate)
  const hydrated = useProjectStore((s) => s.hydrated)
  const [tab, setTab] = useState<MainTab>("melody")

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
    <div className="flex h-screen flex-col overflow-hidden bg-surface-black text-body-on-dark">
      <TopBar tab={tab} onTabChange={setTab} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tab === "melody" && (
          <>
            <LeftPanel />
            <MelodyWorkspace />
            <RightPanel />
          </>
        )}
        {tab === "arrangement" && <ComingSoonTab name="Arrangement" phase="Phase 4以降" />}
        {tab === "audition" && <ComingSoonTab name="Audition" phase="Phase 3以降" />}
      </div>
      <BottomBar />
    </div>
  )
}
