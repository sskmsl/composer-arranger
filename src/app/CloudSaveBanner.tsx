import { useState } from "react"
import { useCloudSaveState } from "@/features/sync/cloudSaveState"
import { retryCloudSaves } from "@/features/sync/projectSync"
import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"

export function CloudSaveBanner() {
  const { state, pendingCount } = useCloudSaveState()
  const localSaved = useProjectStore((store) => store.saveStatus === "saved")
  const [busy, setBusy] = useState(false)
  if (state === "idle") return null
  if (state !== "error") return <div role="status" className="px-4 py-1 text-[12px] text-body-muted">
    {state === "sending" ? "変更をクラウドへ送信中…" : "変更をクラウドへ送信しました"}
  </div>
  return <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-300/30 bg-amber-300/10 px-4 py-2 text-[13px] text-body-on-dark">
    <p className="w-full min-w-0 sm:w-auto sm:flex-1">{localSaved ? "この端末には保存済みです。" : ""}{pendingCount ? `${pendingCount}曲分の変更がクラウドに未送信です。` : "クラウドへの保存を確認できませんでした。"}回線が戻ったら再送します。</p>
    <Button variant="dark" disabled={busy} onClick={async () => {
      setBusy(true)
      try { await retryCloudSaves() } finally { setBusy(false) }
    }}>{busy ? "再送中…" : "クラウド保存を再試行"}</Button>
  </div>
}
