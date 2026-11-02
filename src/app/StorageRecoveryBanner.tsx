import { useEffect, useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { downloadProjectFile } from "@/storage/projectFile"
import { Button } from "@/ui/primitives"

export function StorageRecoveryBanner() {
  const loadError = useProjectStore((s) => s.storageLoadError)
  const status = useProjectStore((s) => s.saveStatus)
  const loadErrorReason = useProjectStore((s) => s.storageLoadErrorReason)
  const unsaved = useProjectStore((s) => s.unsavedProjects)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [hadSaveError, setHadSaveError] = useState(false)
  useEffect(() => {
    if (status === "error") setHadSaveError(true)
    else if (!unsaved.length) setHadSaveError(false)
  }, [status, unsaved.length])
  // 入力のblurによる再試行中も案内を維持し、押している別のボタンを移動させない。
  if (!loadError && status !== "error" && !(hadSaveError && unsaved.length)) return null
  return <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-red-400/30 bg-red-400/10 px-4 py-3 text-[13px] text-body-on-dark">
    <p className="w-full min-w-0 sm:w-auto sm:flex-1">{loadError
      ? loadErrorReason ?? "保存した曲を読み込めませんでした。保存データは削除していません。再試行してください。"
      : "この端末に曲を保存できませんでした。画面の編集内容は残っています。再試行するか、ファイルに保存してください。"}</p>
    <Button variant="dark" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        const store = useProjectStore.getState()
        if (loadError) await store.hydrate()
        else await store.flushSave()
      } finally { setBusy(false) }
    }}>{busy ? "確認中…" : loadError ? "読み込みを再試行" : "保存を再試行"}</Button>
    {!loadError && <Button variant="dark" onClick={() => downloadProjectFile(useProjectStore.getState().project)}>ファイルに保存</Button>}
    {!loadError && unsaved.length > 0 && <>
      <Button variant="dark" aria-expanded={expanded} aria-controls="unsaved-projects" onClick={() => setExpanded(!expanded)}>未保存の曲（{unsaved.length}）</Button>
      {expanded && <ul id="unsaved-projects" aria-label="未保存の曲" className="flex w-full flex-col gap-2">
        {unsaved.map((project) => <li key={project.projectId} className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 break-words">{project.title || "無題の曲"}</span>
          <Button variant="dark" aria-label={`${project.title || "無題の曲"}をファイルに保存`} onClick={() => {
            const latest = useProjectStore.getState().unsavedProjects.find((item) => item.projectId === project.projectId)
            if (latest) downloadProjectFile(latest)
          }}>この曲をファイルに保存</Button>
        </li>)}
      </ul>}
    </>}
  </div>
}
