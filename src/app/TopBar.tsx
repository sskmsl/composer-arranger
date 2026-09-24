import { hasTempoChanges, songTempoChanges } from "@/core/tempoMap"
import { useProjectStore } from "@/store/useProjectStore"
import { IconButton, Pill, TextInput } from "@/ui/primitives"
import { CircleHelp, House, PanelLeft, PanelRight } from "lucide-react"
import type { MainTab } from "./App"
import { isMelodyGroupTab } from "./melodyTabs"
import { ProjectMenu } from "./ProjectMenu"

/**
 * 主要な画面。主旋律・対旋律・装飾・イントロ・短いフレーズ・聴き比べは、どれも主旋律を
 * 中心にした作業なので「旋律」1つにまとめ、中の切り替えは旋律画面の上部(MelodySubTabs)で行う。
 */
const PRIMARY_TABS: { id: MainTab; label: string; mobileLabel: string }[] = [
  { id: "home", label: "ホーム", mobileLabel: "ホーム" },
  { id: "melody", label: "旋律", mobileLabel: "旋律" },
  { id: "arrangement", label: "アレンジ・書出し", mobileLabel: "アレンジ" },
]

/** 旋律タブの中の画面にいるときも「旋律」を選択中として示す */
function isActivePrimary(primary: MainTab, tab: MainTab): boolean {
  return primary === "melody" ? isMelodyGroupTab(tab) : primary === tab
}

export function TopBar({
  tab,
  onTabChange,
  onToggleLeft,
  onToggleRight,
  onOpenImportGuide,
}: {
  tab: MainTab
  onTabChange: (t: MainTab) => void
  onToggleLeft: () => void
  onToggleRight: () => void
  onOpenImportGuide?: () => void
}) {
  const project = useProjectStore((s) => s.project)
  const updateSongField = useProjectStore((s) => s.updateSongField)
  const hasSidePanels = ["melody", "phrase", "signature", "counter", "decoration"].includes(tab)
  const projectReady = project.sections.length > 0
  const songTempo = hasTempoChanges(project) ? songTempoChanges(project) : []
  const selectTab = (nextTab: MainTab) => onTabChange(nextTab)

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
          onClick={() => selectTab("home")}
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
        {tab !== "home" && <ProjectMenu onOpenImportGuide={onOpenImportGuide} />}

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

      <nav className="grid w-full min-w-0 grid-cols-4 gap-1 lg:hidden" aria-label="主要機能">
        {PRIMARY_TABS.map((t) => (
          <Pill
            key={t.id}
            active={isActivePrimary(t.id, tab)}
            disabled={!projectReady && t.id !== "home"}
            title={!projectReady && t.id !== "home" ? "先にホームで曲を準備してください" : undefined}
            onClick={() => selectTab(t.id)}
            className="min-w-0 !px-1 !py-1.5 !text-[12px]"
          >
            {t.mobileLabel}
          </Pill>
        ))}
      </nav>

      {tab !== "home" && <div className="flex shrink-0 flex-wrap items-center gap-3 text-[13px] text-ink-soft">
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
            // 3桁のテンポ(104等)が上下ボタンに隠れて「10」と切れて見えていたため、幅を広げてボタンを隠す
            className="w-16 !bg-transparent px-1.5 py-0.5 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {songTempo.length > 0 && (
            // テンポが途中で変わる曲。数値を変えると、途中のテンポも同じ比率で変わる
            <span
              className="rounded-pill border border-hairline px-1.5 py-0.5 text-[12px] text-body-muted"
              title={`テンポが途中で変わります: ${[project.song.tempo, ...songTempo.map((change) => change.bpm)].join(" → ")} BPM。数値を変えると途中のテンポも同じ比率で変わります。`}
            >
              可変
            </span>
          )}
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
          <Pill key={t.id} active={isActivePrimary(t.id, tab)} disabled={!projectReady && t.id !== "home"} onClick={() => selectTab(t.id)}>
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
