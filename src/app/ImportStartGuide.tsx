import { createPortal } from "react-dom"
import {
  ArrowRight,
  Check,
  Drum,
  ListChecks,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react"
import type { ComposerProject } from "@/core/project"
import { Button } from "@/ui/primitives"
import { recommendImportNextStep } from "./importStartGuideRecommendation"

function StepCard({
  number,
  title,
  description,
  children,
  complete = false,
  recommended = false,
}: {
  number: number
  title: string
  description: string
  children?: React.ReactNode
  complete?: boolean
  recommended?: boolean
}) {
  return (
    <section className={`rounded-lg border p-3 sm:p-4 ${recommended ? "border-primary/60 bg-primary/8" : "border-hairline bg-white/[0.025]"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${complete ? "bg-emerald-400/15 text-emerald-300" : recommended ? "bg-primary text-on-primary" : "bg-white/8 text-body-muted"}`}>
          {complete ? <Check size={14} /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-body-on-dark">{title}</h3>
            {recommended && <span className="rounded-pill bg-primary/15 px-2 py-0.5 text-[12px] font-medium text-primary-on-dark">おすすめ</span>}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-body-muted">{description}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </section>
  )
}

export function ImportStartGuide({
  project,
  onClose,
  onReview,
  onConsult,
}: {
  project: ComposerProject
  onClose: () => void
  onReview: () => void
  onConsult: (prompt: string) => void
}) {
  const next = recommendImportNextStep(project)

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 p-2 sm:p-5" onClick={onClose}>
      <div className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-lg border border-hairline bg-surface-tile-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-hairline bg-surface-tile-1 px-4 py-3 sm:px-5">
          <div>
            <div className="flex items-center gap-2 text-primary-on-dark">
              <Sparkles size={16} />
              <span className="text-[12px] font-medium uppercase tracking-[0.16em]">開始ガイド</span>
            </div>
            <h2 className="mt-1 text-[17px] font-semibold text-body-on-dark">読み込み完了。次はこの順番だけで大丈夫です</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-body-muted hover:bg-white/10" aria-label="開始ガイドを閉じる">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-3 p-3 sm:p-5">
          <StepCard number={1} complete title="読み込み結果を確認" description="セクション、コード、主旋律、各トラックの役割が意図どおりかを「アレンジ」画面で確認します。推定結果は必要なら後から修正できます。">
            <Button variant="dark" onClick={onReview}><ListChecks size={14} /> アレンジ画面で確認</Button>
          </StepCard>

          <StepCard number={2} title="全曲の方向を選んで作る" description="アレンジ画面で5つの方向から1つを選ぶと、主旋律とコードはそのままで、合うパートを曲全体に足します。">
            <Button variant="secondary" onClick={onReview}>
              <WandSparkles size={14} /> 方向を選ぶ
            </Button>
          </StepCard>

          <StepCard number={3} recommended title={`相談して詰める：${next.title}`} description={next.reason}>
            <Button onClick={() => onConsult(next.prompt)}><Drum size={14} /> この内容でAIに相談 <ArrowRight size={14} /></Button>
          </StepCard>

          <p className="text-center text-[12px] leading-4 text-ink-soft">機能を全部使う必要はありません。このガイドは上部の「曲」メニューの「開始ガイド」から再表示できます。</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
