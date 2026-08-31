import { ArrowLeft, Plus } from "lucide-react"
import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"

export function EmptySectionState({
  title = "最初のセクションを作りましょう",
  description = "Aメロ、イントロ、サビなど、作曲を始める単位を1つ追加します。",
}: {
  title?: string
  description?: string
}) {
  const addSection = useProjectStore((state) => state.addSection)

  return (
    <main className="flex min-w-0 flex-1 items-center justify-center p-5">
      <section className="w-full max-w-xl rounded-lg border border-hairline bg-surface-tile-1 p-6 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary-on-dark">
          <Plus size={20} />
        </span>
        <h2 className="mt-4 text-[18px] font-semibold text-body-on-dark">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-5 text-body-muted">{description}</p>
        <Button className="mt-5" onClick={() => addSection("Aメロ", "verse", 8)}>
          <Plus size={14} /> Aメロを追加して始める
        </Button>
        <p className="mt-3 flex items-center justify-center gap-1 text-[11px] text-body-muted">
          <ArrowLeft size={11} /> 詳細な種類や長さは左パネルで変更できます
        </p>
      </section>
    </main>
  )
}
