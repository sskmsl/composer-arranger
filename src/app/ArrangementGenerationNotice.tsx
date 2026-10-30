import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"
export function ArrangementGenerationNotice() {
  const running = useProjectStore((s) => s.arrangementGenerationRunning)
  const error = useProjectStore((s) => s.arrangementGenerationError)
  const cancel = useProjectStore((s) => s.cancelArrangementGeneration)
  if (!running && !error) return null
  if (!running) return <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-2 text-[13px] text-red-200">
    <p>{error}</p><Button variant="dark" onClick={() => useProjectStore.setState({ arrangementGenerationError: null })}>閉じる</Button>
  </div>
  return <div role="status" className="flex flex-wrap items-center gap-3 border-b border-hairline bg-primary/10 px-4 py-2 text-[13px] text-body-on-dark">
    <p>全曲アレンジを作っています。曲を編集した場合、計算中の結果は適用しません。</p>
    <Button variant="dark" onClick={cancel}>作成を中止</Button>
  </div>
}
