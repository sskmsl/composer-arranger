import { useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { downloadProjectFile } from "@/storage/projectFile"
import { Button } from "@/ui/primitives"

export function StorageRecoveryBanner() {
  const loadError = useProjectStore((s) => s.storageLoadError)
  const status = useProjectStore((s) => s.saveStatus)
  const [busy, setBusy] = useState(false)
  if (!loadError && status !== "error") return null
  return <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-red-400/30 bg-red-400/10 px-4 py-3 text-[13px] text-body-on-dark">
    <p className="min-w-0 flex-1">{loadError
      ? "保存した曲を読み込めませんでした。保存データは削除していません。再試行してください。"
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
  </div>
}
