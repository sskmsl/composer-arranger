import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"
import { AlertTriangle, Info, X } from "lucide-react"

/**
 * Issue #16: 時間単位移行の結果をユーザーへ明示する。
 * - ambiguous: 自動判定できなかったため、変換するかどうかの確認を求める(データはバックアップ済み)
 * - auto-converted: 確信を持って自動変換した旨と倍率を表示する(閉じるだけでよい)
 */
export function TimingMigrationBanner() {
  const notice = useProjectStore((s) => s.timingNotice)
  const confirmTimingConversion = useProjectStore((s) => s.confirmTimingConversion)
  const dismissTimingNotice = useProjectStore((s) => s.dismissTimingNotice)

  if (!notice) return null

  if (notice.kind === "ambiguous") {
    return (
      <div className="flex flex-col gap-2 border-b border-hairline bg-amber-500/10 px-4 py-3 text-[13px] text-body-on-dark sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium">
              拍子({notice.timeSignature})の既存データの時間単位を自動判定できませんでした。
            </p>
            <p className="text-body-muted">{notice.reason} 変換前のデータはバックアップ済みです。</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">
          <Button variant="secondary" onClick={() => confirmTimingConversion(false)}>
            このままにする
          </Button>
          <Button variant="primary" onClick={() => confirmTimingConversion(true)}>
            新しい単位へ変換する
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 border-b border-hairline bg-primary/10 px-4 py-2 text-[13px] text-body-on-dark">
      <div className="flex items-center gap-2">
        <Info size={15} className="shrink-0 text-primary" />
        <span>
          拍子({notice.timeSignature})の既存データを新しい時間単位へ自動変換しました(倍率 ×{notice.factor})。変換前のデータはバックアップ済みです。
        </span>
      </div>
      <button
        type="button"
        onClick={dismissTimingNotice}
        className="shrink-0 rounded-full p-1 text-body-muted transition hover:bg-white/10 hover:text-body-on-dark"
        aria-label="閉じる"
      >
        <X size={14} />
      </button>
    </div>
  )
}
