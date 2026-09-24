import { useMemo, useState } from "react"
import { clsx } from "clsx"
import { Check, LoaderCircle, Sparkles } from "lucide-react"
import { buildAiPartnerOrchestrationPlan } from "@/ai-arranger/aiPartnerOrchestrator"
import { conciseDirectionText, plainDirectionText } from "@/ai-arranger/directionPresentation"
import {
  buildWholeSongDirectionProgram,
  type WholeSongArrangementDirection,
  type WholeSongDirectionId,
} from "@/ai-arranger/wholeSongDirectionPlan"
import { useProjectStore } from "@/store/useProjectStore"
import { DIRECTION_NAMES } from "./directionNames"
import { Button } from "@/ui/primitives"

const ENERGY_DELTA: Record<WholeSongArrangementDirection["character"], number> = {
  minimal: -8,
  cinematic: 8,
  rhythmic: 5,
  "dark-experimental": 2,
  balanced: 0,
}

/**
 * 全曲アレンジの入口。曲を解析して5つの方向を示し、選んだ方向で全曲アレンジを作る。
 * 作った結果は版として残り、あとはアレンジ相談で細かく詰める。
 */
export function DirectionPicker({
  firstTime,
  onDone,
  onCancel,
}: {
  /** まだ全曲アレンジがない曲(大きく案内する) */
  firstTime: boolean
  onDone?: () => void
  onCancel?: () => void
}) {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const generate = useProjectStore((state) => state.generateDirectionArrangement)
  const [selectedId, setSelectedId] = useState<WholeSongDirectionId | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const program = useMemo(() => {
    const plan = buildAiPartnerOrchestrationPlan(project, selectedSectionId)
    return buildWholeSongDirectionProgram(project, plan.constraints.join("。"))
  }, [project, selectedSectionId])
  const chosen = program.directions.find((direction) => direction.id === (selectedId ?? program.recommendedDirectionId))
    ?? program.directions[0]

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    // 押した直後に「作っています」を描画してから、重い生成を始める
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      generate(DIRECTION_NAMES[chosen.id], `${chosen.title}。${chosen.summary}`, {
        intention: chosen.summary,
        character: chosen.character,
        energyDelta: ENERGY_DELTA[chosen.character],
        surpriseLevel: chosen.character === "dark-experimental" ? 0.6 : 0.15,
      })
      onDone?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "全曲アレンジを作れませんでした。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="direction-picker-heading"
      className={clsx(
        "flex flex-col gap-3 rounded-lg border p-4",
        firstTime ? "border-primary/40 bg-primary/[0.06]" : "border-hairline bg-surface-tile-1",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0">
          <h3 id="direction-picker-heading" className={clsx("font-semibold text-body-on-dark", firstTime ? "text-[17px]" : "text-[14px]")}>
            {firstTime ? "どんな方向で全曲をアレンジしますか？" : "全曲の方向を選び直す"}
          </h3>
          <p className="mt-1 text-[13px] leading-5 text-body-muted">
            主旋律とコードはそのままで、選んだ方向に合うパートを曲全体に足します。
            {firstTime ? "できたらパート構成を見ながら、アレンジ相談で細かく直せます。" : "いまの版は履歴に残るので、いつでも戻せます。"}
          </p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-[13px] text-ink-soft hover:text-body-on-dark">
            閉じる
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label="全曲の方向" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {program.directions.map((direction) => {
          const selected = direction.id === chosen.id
          const recommended = direction.id === program.recommendedDirectionId
          return (
            <button
              key={direction.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setSelectedId(direction.id)}
              className={clsx(
                "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition sm:min-h-24 sm:py-3",
                selected ? "border-primary bg-primary/15" : "border-hairline bg-white/[0.03] hover:bg-white/[0.07]",
              )}
            >
              <span className="flex items-start gap-2">
                <span className="mr-auto text-[14px] font-semibold text-body-on-dark">{DIRECTION_NAMES[direction.id]}</span>
                {selected && <Check size={15} className="shrink-0 text-primary-on-dark" aria-hidden="true" />}
              </span>
              <span className="text-[13px] leading-5 text-body-muted">{conciseDirectionText(plainDirectionText(direction.subtitle), 40)}</span>
              {recommended && (
                <span className="self-start rounded-pill sm:mt-auto bg-emerald-400/12 px-2 py-0.5 text-[12px] text-emerald-200">この曲におすすめ</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void run()} disabled={busy} className="min-h-11">
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {busy ? "全曲を作っています…" : `「${DIRECTION_NAMES[chosen.id]}」で全曲を作る`}
        </Button>
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-body-muted">
          {chosen.id === program.recommendedDirectionId
            ? `おすすめの理由：${conciseDirectionText(plainDirectionText(program.recommendationReason), 70)}`
            : conciseDirectionText(plainDirectionText(chosen.summary), 80)}
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
          {error}
        </p>
      )}
    </section>
  )
}
