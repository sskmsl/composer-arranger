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
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${complete ? "bg-emerald-400/15 text-emerald-300" : recommended ? "bg-primary text-on-primary" : "bg-white/8 text-body-muted"}`}>
          {complete ? <Check size={14} /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-body-on-dark">{title}</h3>
            {recommended && <span className="rounded-pill bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary-on-dark">おすすめ</span>}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-body-muted">{description}</p>
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
  const trackCount = project.importedArrangement?.tracks.length ?? 0
  const noteCount = project.importedArrangement?.tracks.reduce((sum, track) => sum + track.notes.length, 0) ?? 0

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 p-2 sm:p-5" onClick={onClose}>
      <div className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-lg border border-hairline bg-surface-tile-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-hairline bg-surface-tile-1 px-4 py-3 sm:px-5">
          <div>
            <div className="flex items-center gap-2 text-primary-on-dark">
              <Sparkles size={16} />
              <span className="text-[11px] font-medium uppercase tracking-[0.16em]">Arrangement Start Guide</span>
            </div>
            <h2 className="mt-1 text-[17px] font-semibold text-body-on-dark">読み込み完了。次はこの順番だけで大丈夫です</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-body-muted hover:bg-white/10" aria-label="開始ガイドを閉じる">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-3 p-3 sm:p-5">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/[0.035] p-3 text-[11px] sm:grid-cols-5">
            <div><p className="text-ink-muted-48">Section</p><p className="mt-1 text-[13px] text-body-on-dark">{project.sections.length}</p></div>
            <div><p className="text-ink-muted-48">Imported tracks</p><p className="mt-1 text-[13px] text-body-on-dark">{trackCount}</p></div>
            <div><p className="text-ink-muted-48">Imported notes</p><p className="mt-1 text-[13px] text-body-on-dark">{noteCount}</p></div>
            <div><p className="text-ink-muted-48">Chord confidence</p><p className="mt-1 text-[13px] text-body-on-dark">{Math.round((project.sourceImport?.chordInferenceConfidence ?? 0) * 100)}%</p></div>
            <div><p className="text-ink-muted-48">Key confidence</p><p className="mt-1 text-[13px] text-body-on-dark">{project.sourceImport?.keyInferenceSource === "user-confirmed" ? "確認済み" : `${Math.round((project.sourceImport?.keyInferenceConfidence ?? 0) * 100)}%`}</p></div>
          </div>

          <StepCard number={1} complete title="読み込み結果を確認" description="Section、コード、Melody、各トラックの役割が意図どおりかをArrangementで確認します。推定結果は必要なら後から修正できます。">
            <Button variant="dark" onClick={onReview}><ListChecks size={14} /> Arrangementで確認</Button>
          </StepCard>

          <StepCard number={2} recommended title={`最優先：${next.title}`} description={next.reason}>
            <Button onClick={() => onConsult(next.prompt)}><Drum size={14} /> おすすめをAIに相談 <ArrowRight size={14} /></Button>
          </StepCard>

          <StepCard number={3} title="Directionを選び、実音を生成" description="AIは方向性だけを設計します。納得したDirectionの「この案を生成」を押すと、既存Generatorが音程・リズム・衝突を検証してMIDIを作ります。">
            <Button variant="secondary" onClick={() => onConsult("現在の構成を尊重し、次に着手すべきパートを一つだけ選んで3案を提案して。不要なら音を追加しない案も含めて。")}>
              <WandSparkles size={14} /> AI Partnerを開く
            </Button>
          </StepCard>

          <p className="text-center text-[11px] leading-4 text-ink-muted-48">機能を全部使う必要はありません。このガイドは左パネルの「開始ガイド」から再表示できます。</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
