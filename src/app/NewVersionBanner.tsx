import { useEffect, useState } from "react"
import { Info } from "lucide-react"
import { Button } from "@/ui/primitives"
import { BUILD_ID, fetchLatestBuildId, isNewVersionAvailable } from "@/features/version/newVersion"

/**
 * 画面を開いたまま新しい版が公開されたとき、再読み込みを案内する。
 * 古い画面のまま使うと、AIなど新しい版のサーバーと噛み合わず「不正な形式」などになるため。
 */
export function NewVersionBanner() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (BUILD_ID === "dev") return
    let cancelled = false
    const check = () => {
      if (document.visibilityState === "hidden") return
      void fetchLatestBuildId().then((latest) => {
        if (!cancelled && isNewVersionAvailable(BUILD_ID, latest)) setAvailable(true)
      })
    }
    check()
    document.addEventListener("visibilitychange", check)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", check)
    }
  }, [])

  if (!available) return null
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 border-b border-hairline bg-primary/10 px-4 py-2 text-[13px] text-body-on-dark"
    >
      <div className="flex items-center gap-2">
        <Info size={15} className="shrink-0 text-primary-on-dark" />
        <span>新しい版が公開されています。再読み込みすると反映されます。</span>
      </div>
      <Button variant="primary" onClick={() => window.location.reload()}>
        再読み込み
      </Button>
    </div>
  )
}
