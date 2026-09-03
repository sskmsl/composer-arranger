import { useProjectStore } from "@/store/useProjectStore"
import { IconButton, Pill, TextInput } from "@/ui/primitives"
import { CircleHelp, House, PanelLeft, PanelRight, SlidersHorizontal } from "lucide-react"
import type { MainTab } from "./App"

const PRIMARY_TABS: { id: MainTab; label: string; mobileLabel: string }[] = [
  { id: "home", label: "ホーム", mobileLabel: "ホーム" },
  { id: "ai-partner", label: "AIで方針", mobileLabel: "方針" },
  { id: "arrangement", label: "結果・書出し", mobileLabel: "結果" },
  { id: "audition", label: "比較試聴", mobileLabel: "試聴" },
]

const DETAIL_TABS: { id: MainTab; label: string; description: string }[] = [
  { id: "melody", label: "主旋律", description: "セクション全体のメロディ" },
  { id: "phrase", label: "短いフレーズ", description: "2〜8小節の着想" },
  { id: "signature", label: "曲の顔", description: "記憶に残る導入フレーズ" },
  { id: "counter", label: "対旋律", description: "主旋律へ応答する第二の線" },
  { id: "decoration", label: "装飾", description: "隙間を生かす短い演出" },
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
  const hasSidePanels = ["melody", "phrase", "signature", "counter", "decoration"].includes(tab)
  const projectReady = project.sections.length > 0

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-hairline bg-surface-black px-3 py-2 lg:h-11 lg:flex-row lg:items-center lg:gap-4 lg:px-4 lg:py-0">
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {hasSidePanels && (
          <IconButton onClick={onToggleLeft} className="lg:hidden" title="曲とセクションを開く">
            <PanelLeft size={16} />
          </IconButton>
        )}

        <button
          type="button"
          onClick={() => onTabChange("home")}
          className={`${tab === "home" ? "inline-flex" : "hidden sm:inline-flex"} items-center gap-2 font-display text-[15px] font-semibold tracking-tight text-body-on-dark hover:text-primary-on-dark`}
          title="ホームへ戻る"
        >
          <House size={14} /> Composer Arranger
        </button>

        {tab !== "home" && (
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
        )}

        {hasSidePanels && (
          <IconButton onClick={onToggleRight} className="lg:hidden" title="詳細設定を開く">
            <PanelRight size={16} />
          </IconButton>
        )}

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

      <nav className="grid w-full min-w-0 grid-cols-5 gap-1 lg:hidden" aria-label="主要機能">
        {PRIMARY_TABS.map((t) => (
          <Pill
            key={t.id}
            active={tab === t.id}
            disabled={!projectReady && t.id !== "home"}
            title={!projectReady && t.id !== "home" ? "先にホームで曲を準備してください" : undefined}
            onClick={() => onTabChange(t.id)}
            className="min-w-0 !px-1 !py-1.5 !text-[11px]"
          >
            {t.mobileLabel}
          </Pill>
        ))}
        {projectReady ? (
          <details className="group relative min-w-0">
            <summary className="flex min-h-7 cursor-pointer list-none items-center justify-center gap-1 rounded-pill border border-hairline px-1 py-1.5 text-[11px] text-body-muted hover:bg-white/10 hover:text-body-on-dark">
              <SlidersHorizontal size={11} /> 調整
            </summary>
            <div className="fixed left-3 right-3 top-[7.25rem] z-[70] rounded-md border border-hairline bg-surface-tile-1 p-1.5 shadow-xl">
              {DETAIL_TABS.map((item) => (
                <button key={item.id} type="button" onClick={() => onTabChange(item.id)} className="flex w-full flex-col rounded-sm px-3 py-2 text-left hover:bg-white/8">
                  <span className="text-[12px] font-medium text-body-on-dark">{item.label}</span>
                  <span className="text-[11px] text-body-muted">{item.description}</span>
                </button>
              ))}
            </div>
          </details>
        ) : (
          <button type="button" disabled className="min-w-0 rounded-pill border border-hairline px-1 py-1.5 text-[11px] text-body-muted opacity-35">
            調整
          </button>
        )}
      </nav>

      {tab !== "home" && <div className="flex shrink-0 flex-wrap items-center gap-3 text-[12px] text-ink-muted-48">
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
      </div>}

      <nav className="hidden shrink-0 items-center gap-1.5 lg:ml-auto lg:flex">
        {PRIMARY_TABS.map((t) => (
          <Pill key={t.id} active={tab === t.id} disabled={!projectReady && t.id !== "home"} onClick={() => onTabChange(t.id)}>
            {t.label}
          </Pill>
        ))}
        <details className={`group relative ${projectReady ? "" : "pointer-events-none opacity-35"}`}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-pill border border-hairline px-3 py-1.5 text-[12px] text-body-muted transition hover:bg-white/10 hover:text-body-on-dark">
            <SlidersHorizontal size={12} /> 個別調整
          </summary>
          <div className="absolute right-0 top-9 z-[70] w-60 rounded-md border border-hairline bg-surface-tile-1 p-1.5 shadow-xl">
            {DETAIL_TABS.map((item) => (
              <button key={item.id} type="button" onClick={() => onTabChange(item.id)} className="flex w-full flex-col rounded-sm px-3 py-2 text-left hover:bg-white/8">
                <span className="text-[12px] font-medium text-body-on-dark">{item.label}</span>
                <span className="text-[11px] text-body-muted">{item.description}</span>
              </button>
            ))}
          </div>
        </details>
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
