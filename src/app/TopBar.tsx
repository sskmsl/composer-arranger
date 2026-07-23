import { useProjectStore } from "@/store/useProjectStore"
import { Pill, TextInput } from "@/ui/primitives"
import type { MainTab } from "./App"

const TABS: { id: MainTab; label: string }[] = [
  { id: "melody", label: "Melody" },
  { id: "arrangement", label: "Arrangement" },
  { id: "audition", label: "Audition" },
]

export function TopBar({ tab, onTabChange }: { tab: MainTab; onTabChange: (t: MainTab) => void }) {
  const project = useProjectStore((s) => s.project)
  const updateSongField = useProjectStore((s) => s.updateSongField)

  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-hairline bg-surface-black px-4">
      <span className="font-display text-[15px] font-semibold tracking-tight text-body-on-dark">Composer Arranger</span>

      <TextInput
        onBlur={(e) => {
          const title = e.currentTarget.value
          useProjectStore.setState((s) => ({ project: { ...s.project, title } }))
          useProjectStore.getState().persist()
        }}
        defaultValue={project.title}
        key={project.projectId}
        className="w-40 !bg-transparent !border-transparent text-[13px] hover:!border-hairline"
      />

      <div className="flex items-center gap-3 text-[12px] text-ink-muted-48">
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

      <nav className="ml-auto flex items-center gap-1.5">
        {TABS.map((t) => (
          <Pill key={t.id} active={tab === t.id} onClick={() => onTabChange(t.id)}>
            {t.label}
          </Pill>
        ))}
      </nav>
    </header>
  )
}
