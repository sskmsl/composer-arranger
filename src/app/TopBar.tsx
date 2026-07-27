import { useProjectStore } from "@/store/useProjectStore"
import { IconButton, Pill, TextInput } from "@/ui/primitives"
import { CircleHelp, PanelLeft, PanelRight } from "lucide-react"
import type { MainTab } from "./App"

const TABS: { id: MainTab; label: string }[] = [
  { id: "melody", label: "Melody" },
  { id: "phrase", label: "Phrase" },
  { id: "arrangement", label: "Arrangement" },
  { id: "audition", label: "Audition" },
]

export function TopBar({
  tab,
  onTabChange,
  onToggleLeft,
  onToggleRight,
}: {
  tab: MainTab
  onTabChange: (t: MainTab) => void
  onToggleLeft: () => void
  onToggleRight: () => void
}) {
  const project = useProjectStore((s) => s.project)
  const updateSongField = useProjectStore((s) => s.updateSongField)

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-hairline bg-surface-black px-3 py-2 lg:h-11 lg:flex-row lg:items-center lg:gap-4 lg:px-4 lg:py-0">
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <IconButton onClick={onToggleLeft} className="lg:hidden" title="左パネルを開閉">
          <PanelLeft size={16} />
        </IconButton>

        <span className="hidden font-display text-[15px] font-semibold tracking-tight text-body-on-dark sm:inline">
          Composer Arranger
        </span>

        <TextInput
          onBlur={(e) => {
            const title = e.currentTarget.value
            useProjectStore.setState((s) => ({ project: { ...s.project, title } }))
            useProjectStore.getState().persist()
          }}
          defaultValue={project.title}
          key={project.projectId}
          className="w-28 min-w-0 flex-1 !bg-transparent !border-transparent text-[13px] hover:!border-hairline sm:w-40 sm:flex-none"
        />

        <nav className="ml-auto flex items-center gap-1.5 lg:hidden">
          {TABS.map((t) => (
            <Pill key={t.id} active={tab === t.id} onClick={() => onTabChange(t.id)} className="!px-2.5 !py-1 !text-[12px]">
              {t.label}
            </Pill>
          ))}
        </nav>

        <IconButton onClick={onToggleRight} className="lg:hidden" title="右パネルを開閉">
          <PanelRight size={16} />
        </IconButton>

        <a
          href="./manual.html"
          target="_blank"
          rel="noreferrer"
          title="操作マニュアルを開く"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body-muted transition hover:bg-white/10 hover:text-body-on-dark active:scale-95 lg:hidden"
        >
          <CircleHelp size={16} />
        </a>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 text-[12px] text-ink-muted-48">
        <label className="flex items-center gap-1">
          Key
          <TextInput
            defaultValue={project.song.key}
            key={`key-${project.projectId}`}
            onBlur={(e) => updateSongField("key", e.currentTarget.value)}
            className="w-14 !bg-transparent px-1.5 py-0.5 text-center"
          />
        </label>
        <label className="flex items-center gap-1">
          Tempo
          <TextInput
            defaultValue={String(project.song.tempo)}
            key={`tempo-${project.projectId}`}
            type="number"
            onBlur={(e) => updateSongField("tempo", Number(e.currentTarget.value) || project.song.tempo)}
            className="w-14 !bg-transparent px-1.5 py-0.5 text-center"
          />
        </label>
        <label className="flex items-center gap-1">
          拍子
          <TextInput
            defaultValue={project.song.timeSignature}
            key={`ts-${project.projectId}`}
            onBlur={(e) => updateSongField("timeSignature", e.currentTarget.value)}
            className="w-12 !bg-transparent px-1.5 py-0.5 text-center"
          />
        </label>
      </div>

      <nav className="hidden shrink-0 items-center gap-1.5 lg:ml-auto lg:flex">
        {TABS.map((t) => (
          <Pill key={t.id} active={tab === t.id} onClick={() => onTabChange(t.id)}>
            {t.label}
          </Pill>
        ))}
        <a
          href="./manual.html"
          target="_blank"
          rel="noreferrer"
          title="操作マニュアルを開く"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body-muted transition hover:bg-white/10 hover:text-body-on-dark active:scale-95"
        >
          <CircleHelp size={16} />
        </a>
      </nav>
    </header>
  )
}
